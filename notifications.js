// ================= REAL-TIME GUEST NOTIFICATIONS (NO LOGIN) =================
// Mirrors the Reservation Portal's js/app-notifications.js architecture:
//   - ONE Supabase Realtime channel PER tracked application ID (not one
//     shared channel with multiple filters) — each channel has its own
//     simple `id=eq.<id>` filter, which is supported on every Realtime
//     server version (unlike `id=in.(...)`, which silently fails on some).
//   - Native browser/OS notifications via a Service Worker, so an update
//     is visible even if the tab is backgrounded — layered on top of an
//     in-page toast that always fires and needs no permission at all.
//   - Tracked IDs expire after 10 days (matches the Reservation Portal),
//     so this device doesn't keep listening forever on old applications.
//
// An ID ends up tracked in one of two ways:
//   1. Automatically — right after submitTransfer() succeeds, if the
//      "Get Notification?" checkbox was checked. See trackNewApplication(),
//      called from script.js.
//   2. Manually — via the "My Application Status" modal's recovery box,
//      for when localStorage gets cleared (new device, browser reset).
//
// Depends on getSupabase()/escapeHtml() (common.js) and showToast()
// (script.js) — load this file AFTER both:
//   <script src="common.js"></script>
//   <script src="script.js"></script>
//   <script src="notifications.js"></script>

const NOTIF_STORAGE_KEY = 'transfer_ids';                       // [{id, savedAt}]
const NOTIF_PERMISSION_KEY = 'transfer_notifications_enabled';  // 'true' | 'false'
const NOTIF_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;             // 10 days
const NOTIF_TABLE = 'player_transfers';

const trackedChannels = new Map();  // id (string) -> realtime channel
const lastKnownStatus = new Map();  // id (string) -> last seen status

document.addEventListener('DOMContentLoaded', () => {
    cleanupExpiredTrackedIds();
    startAllTrackedRealtime();
    updateNotifCountBadge();
});

// ================= VALIDATION =================
function isValidTransferId(value) {
    return /^\d+$/.test(String(value ?? '').trim());
}

// ================= LOCALSTORAGE: TRACKED ID RECORDS =================
function readTrackedRecords() {
    try {
        const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];

        // Transparently migrates the older plain-number-array format
        // (e.g. [128, 130]) into the {id, savedAt} record format used for
        // 10-day retention tracking.
        return parsed.map(item => {
            if (item && typeof item === 'object' && isValidTransferId(item.id)) {
                return { id: String(item.id), savedAt: Number(item.savedAt) || Date.now() };
            }
            if (isValidTransferId(item)) {
                return { id: String(item), savedAt: Date.now() };
            }
            return null;
        }).filter(Boolean);
    } catch (e) {
        console.error('Failed reading tracked transfer IDs:', e);
        return [];
    }
}

function writeTrackedRecords(records) {
    const unique = new Map();
    records.forEach(item => {
        if (!item || !isValidTransferId(item.id)) return;
        unique.set(String(item.id), { id: String(item.id), savedAt: Number(item.savedAt) || Date.now() });
    });
    const clean = [...unique.values()];
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(clean));
    return clean;
}

function cleanupExpiredTrackedIds() {
    const now = Date.now();
    const records = readTrackedRecords();
    const active = records.filter(r => (now - r.savedAt) < NOTIF_RETENTION_MS);
    const expired = records.filter(r => (now - r.savedAt) >= NOTIF_RETENTION_MS);
    expired.forEach(r => stopRealtimeForId(r.id));
    writeTrackedRecords(active);
    return active;
}

function getTrackedIds() {
    return cleanupExpiredTrackedIds().map(r => Number(r.id));
}

function addTrackedId(id) {
    if (!isValidTransferId(id)) return;
    const records = cleanupExpiredTrackedIds();
    if (!records.some(r => r.id === String(id))) {
        records.push({ id: String(id), savedAt: Date.now() });
        writeTrackedRecords(records);
    }
    updateNotifCountBadge();
    startRealtimeForId(id);
}

function removeTrackedId(id) {
    writeTrackedRecords(readTrackedRecords().filter(r => r.id !== String(id)));
    stopRealtimeForId(id);
    updateNotifCountBadge();
    renderTrackedList();
}

// ================= NATIVE BROWSER/OS NOTIFICATIONS =================
function isNotificationSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

function areNotificationsEnabled() {
    return localStorage.getItem(NOTIF_PERMISSION_KEY) === 'true';
}

function setNotificationPreference(enabled) {
    localStorage.setItem(NOTIF_PERMISSION_KEY, enabled ? 'true' : 'false');
}

async function requestNotificationPermission() {
    if (!isNotificationSupported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
        return (await Notification.requestPermission()) === 'granted';
    } catch (e) {
        console.warn('Notification permission request failed:', e);
        return false;
    }
}

function statusLabel(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'accepted') return 'Accepted';
    if (s === 'rejected') return 'Rejected';
    if (s === 'waiting') return 'Waiting';
    return String(status || 'Updated');
}

// Uses the Service Worker's showNotification() when available (required
// for OS-level notifications on Android Chrome), falling back to the plain
// Notification() constructor (works on desktop browsers without a SW).
async function showNativeStatusNotification(id, status, nickname) {
    if (!isNotificationSupported() || Notification.permission !== 'granted') return;

    const s = String(status || '').toLowerCase();
    let title = 'Transfer Application Update';
    let body = `Application #${id} is now "${statusLabel(status)}".`;
    if (s === 'accepted') {
        title = 'Application Accepted 🎉';
        body = `${nickname || 'Your application'} has been accepted! Welcome to the state.`;
    } else if (s === 'rejected') {
        title = 'Application Rejected';
        body = `${nickname || 'Your application'} was rejected. Check the portal for details.`;
    }

    const options = {
        body,
        icon: './android-chrome-192x192.png',
        badge: './android-chrome-192x192.png',
        tag: `transfer-${id}`,
        renotify: true,
        data: { application_id: id, status }
    };

    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            if (registration?.showNotification) {
                await registration.showNotification(title, options);
                return;
            }
        }
    } catch (e) {
        console.warn('Service Worker notification failed:', e);
    }

    try { new Notification(title, options); } catch (e) { console.warn('Browser notification failed:', e); }
}

// ================= PER-ID REALTIME CHANNELS =================
// Each tracked application gets its OWN channel (`transfer_application_<id>`)
// with its OWN `id=eq.<id>` filter. Stopping/removing one ID's channel
// never disturbs any other tracked application's stream.
function stopRealtimeForId(id) {
    const key = String(id);
    const client = getSupabase();
    const channel = trackedChannels.get(key);
    if (client && channel) client.removeChannel(channel);
    trackedChannels.delete(key);
    lastKnownStatus.delete(key);
}

async function startRealtimeForId(id) {
    const key = String(id);
    const client = getSupabase();
    if (!client || !isValidTransferId(id) || trackedChannels.has(key)) return;

    try {
        const { data: current, error } = await client
            .from(NOTIF_TABLE)
            .select('id, nickname, status')
            .eq('id', key)
            .maybeSingle();

        if (!error && current) lastKnownStatus.set(key, current.status);

        const channel = client
            .channel(`transfer_application_${key}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: NOTIF_TABLE,
                filter: `id=eq.${key}`
            }, async (payload) => {
                const row = payload.new;
                if (!row) return;

                const previous = lastKnownStatus.has(key) ? lastKnownStatus.get(key) : payload.old?.status;
                lastKnownStatus.set(key, row.status);

                // Ignore UPDATEs that didn't actually change the status
                // (e.g. an admin editing the notes field on this record).
                if (String(previous || '').toLowerCase() === String(row.status || '').toLowerCase()) return;

                // In-page toast — always fires, needs no permission at all.
                const label = row.nickname ? escapeHtml(row.nickname) : `Application #${row.id}`;
                const toastType = row.status === 'Accepted' ? 'success' : row.status === 'Rejected' ? 'error' : 'info';
                if (typeof showToast === 'function') {
                    showToast(`🔔 ${label}: status changed to "${escapeHtml(statusLabel(row.status))}"`, toastType);
                }

                // Native OS/browser notification — only if permission was
                // granted, so it's still visible with the tab backgrounded.
                await showNativeStatusNotification(row.id, row.status, row.nickname);

                if (document.getElementById('status-modal')?.classList.contains('active')) {
                    renderTrackedList();
                }
            })
            .subscribe((status, err) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`[notifications] channel for #${key}:`, status, err);
                }
            });

        trackedChannels.set(key, channel);
    } catch (e) {
        console.error(`Failed to start realtime for application #${key}:`, e);
    }
}

async function startAllTrackedRealtime() {
    for (const id of getTrackedIds()) await startRealtimeForId(id);
}

function stopAllTrackedRealtime() {
    [...trackedChannels.keys()].forEach(stopRealtimeForId);
}

// ================= ENTRY POINTS (called from script.js / the modal) =================
// Called from script.js right after a successful submitTransfer() insert,
// only when the "Get Notification?" checkbox was checked.
async function trackNewApplication(newId) {
    addTrackedId(newId);

    const granted = await requestNotificationPermission();
    setNotificationPreference(granted);

    if (typeof showToast === 'function') {
        showToast(
            granted
                ? `🔔 Notifications enabled for Application #${newId}`
                : `🔔 Tracking Application #${newId} (in-app alerts only — browser notifications weren't granted)`,
            'success'
        );
    }
}

// ================= "MY APPLICATION STATUS" MODAL =================
function openStatusModal() {
    document.getElementById('status-modal')?.classList.add('active');
    renderTrackedList();
}

function closeStatusModal() {
    document.getElementById('status-modal')?.classList.remove('active');
}

// Manual recovery: applicant types in an Application ID (e.g. after
// clearing browser data), we verify it exists, then start tracking it
// again — re-adding it to localStorage and re-activating its own channel.
async function handleCheckStatus() {
    const input = document.getElementById('input-check-transfer-id');
    const rawValue = (input?.value || '').trim();

    if (!isValidTransferId(rawValue)) {
        if (typeof showToast === 'function') showToast('Please enter a valid numeric Application ID.', 'warning');
        return;
    }

    const id = parseInt(rawValue, 10);
    const client = getSupabase();
    if (!client) return;

    const { data, error } = await client
        .from(NOTIF_TABLE)
        .select('id, nickname, status')
        .eq('id', id)
        .maybeSingle();

    if (error || !data) {
        if (typeof showToast === 'function') showToast(`No application found with ID #${id}.`, 'error');
        return;
    }

    lastKnownStatus.set(String(data.id), data.status);
    addTrackedId(data.id);

    const granted = await requestNotificationPermission();
    setNotificationPreference(granted);

    if (input) input.value = '';
    if (typeof showToast === 'function') showToast(`Now tracking Application #${data.id} on this device.`, 'success');
    renderTrackedList();
}

async function renderTrackedList() {
    const container = document.getElementById('tracked-list-container');
    if (!container) return;

    const ids = getTrackedIds();
    if (ids.length === 0) {
        container.innerHTML = `<p class="tracked-empty">No tracked applications on this device yet. Submit the form with "Get Notification?" checked, or recover an ID above.</p>`;
        return;
    }

    container.innerHTML = `<p class="tracked-empty">Loading status…</p>`;

    const client = getSupabase();
    if (!client) return;

    const { data, error } = await client
        .from(NOTIF_TABLE)
        .select('id, nickname, status')
        .in('id', ids);

    if (error) {
        container.innerHTML = `<p class="tracked-empty" style="color:var(--danger);">Failed to load status: ${escapeHtml(error.message)}</p>`;
        return;
    }

    const foundIds = new Set((data || []).map(r => r.id));
    const rows = (data || []).map(item => {
        lastKnownStatus.set(String(item.id), item.status);
        const badgeClass = `badge badge-${(item.status || '').toLowerCase()}`;
        return `
            <div class="tracked-item">
                <div class="tracked-item-info">
                    <strong>#${item.id}</strong>
                    <span>${escapeHtml(item.nickname || '')}</span>
                </div>
                <span class="${badgeClass}">${escapeHtml(item.status || '-')}</span>
                <button class="tracked-remove-btn" onclick="removeTrackedId(${item.id})" title="Stop tracking this ID">✕</button>
            </div>`;
    });

    // A tracked ID the admin deleted still shows up, clearly marked, rather
    // than silently disappearing from the applicant's list.
    ids.filter(id => !foundIds.has(id)).forEach(id => {
        rows.push(`
            <div class="tracked-item tracked-item-missing">
                <div class="tracked-item-info">
                    <strong>#${id}</strong>
                    <span class="tracked-missing-label">Record not found</span>
                </div>
                <button class="tracked-remove-btn" onclick="removeTrackedId(${id})" title="Stop tracking this ID">✕</button>
            </div>`);
    });

    container.innerHTML = rows.join('');
}

function updateNotifCountBadge() {
    const badge = document.getElementById('notif-count-badge');
    if (!badge) return;
    const count = getTrackedIds().length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}
