// ================= REAL-TIME GUEST NOTIFICATIONS (NO LOGIN) =================
// Lets an applicant who never logs in still get a live toast whenever the
// status of THEIR OWN application(s) changes on this device, using nothing
// but localStorage + a filtered Supabase Realtime subscription.
//
// An ID ends up tracked in one of two ways:
//   1. Automatically — right after submitTransfer() succeeds, if the
//      "Get Notification?" checkbox on the form was checked. See
//      trackNewApplication(), called from script.js.
//   2. Manually — via the "My Application Status" modal's recovery box.
//      If localStorage gets cleared (new device, browser reset, etc.), the
//      applicant re-enters their Application ID to resume notifications.
//
// Depends on getSupabase()/escapeHtml() (common.js) and showToast()
// (script.js) — load this file AFTER both:
//   <script src="common.js"></script>
//   <script src="script.js"></script>
//   <script src="notifications.js"></script>

const NOTIF_STORAGE_KEY = 'transfer_ids'; // JSON array of player_transfers.id
const NOTIF_TABLE = 'player_transfers';

let notifChannel = null;
// Last known status per tracked id, used purely to stop the SAME status
// from popping a second toast (e.g. an admin editing notes triggers an
// UPDATE event too, but that's not a status change).
let trackedStatusCache = {};

document.addEventListener('DOMContentLoaded', () => {
    resubscribeNotificationChannel();
    updateNotifCountBadge();
});

// ================= LOCALSTORAGE HELPERS =================
function getTrackedIds() {
    try {
        const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr)
            ? [...new Set(arr.map(Number).filter(Number.isFinite))]
            : [];
    } catch (e) {
        console.error('Failed reading tracked transfer IDs from localStorage:', e);
        return [];
    }
}

function saveTrackedIds(ids) {
    const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(unique));
    return unique;
}

function addTrackedId(id) {
    const numId = Number(id);
    if (!Number.isFinite(numId)) return;
    const ids = getTrackedIds();
    if (!ids.includes(numId)) {
        ids.push(numId);
        saveTrackedIds(ids);
    }
    updateNotifCountBadge();
    resubscribeNotificationChannel();
}

function removeTrackedId(id) {
    const numId = Number(id);
    saveTrackedIds(getTrackedIds().filter(x => x !== numId));
    delete trackedStatusCache[numId];
    updateNotifCountBadge();
    resubscribeNotificationChannel();
    renderTrackedList();
}

// Called from script.js right after a successful submitTransfer() insert,
// only when the "Get Notification?" checkbox was checked.
function trackNewApplication(newId) {
    addTrackedId(newId);
    if (typeof showToast === 'function') {
        showToast(`🔔 Notifications enabled for Application #${newId}`, 'success');
    }
}

// ================= REALTIME SUBSCRIPTION =================
// Supabase Realtime filters can't be edited on a live channel, so whenever
// the tracked-ID list changes we tear down the old channel and open a new
// one covering exactly the current list.
//
// IMPORTANT: this intentionally does NOT use a single `id=in.(1,2,3)`
// filter. That operator silently fails to deliver events on some Supabase
// Realtime server versions (no error — the subscription just never fires),
// which is exactly the "IDs are tracked but no toast ever appears" bug.
// Instead we bind one `id=eq.<id>` filter per tracked ID on the SAME
// channel — `eq` is the most basic filter and is guaranteed to work.
async function resubscribeNotificationChannel() {
    const client = getSupabase();
    if (!client) return;

    if (notifChannel) {
        // Await the teardown before opening a new channel with the same
        // name — creating the replacement before the old one has fully
        // unsubscribed can make the server silently ignore the new one.
        await client.removeChannel(notifChannel);
        notifChannel = null;
    }

    const ids = getTrackedIds();
    if (ids.length === 0) return; // nothing to listen for

    let builder = client.channel('my-applications-channel');
    ids.forEach(id => {
        builder = builder.on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: NOTIF_TABLE,
            filter: `id=eq.${id}`
        }, (payload) => handleTrackedStatusUpdate(payload));
    });

    notifChannel = builder.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
            console.log('[notifications] listening for status updates on:', ids);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[notifications] realtime subscription failed:', status, err);
        }
    });
}

function handleTrackedStatusUpdate(payload) {
    const row = payload.new;
    if (!row) return;

    const previousStatus = trackedStatusCache[row.id];
    trackedStatusCache[row.id] = row.status;

    // Skip UPDATE events that didn't actually change the status (e.g. an
    // admin editing the notes field on this same record).
    if (previousStatus === row.status) return;

    const label = row.nickname ? escapeHtml(row.nickname) : `Application #${row.id}`;
    const statusText = escapeHtml(row.status || 'Updated');
    const toastType = row.status === 'Accepted' ? 'success'
        : row.status === 'Rejected' ? 'error'
        : 'info';

    if (typeof showToast === 'function') {
        showToast(`🔔 ${label}: status changed to "${statusText}"`, toastType);
    }

    // Keep the modal's list in sync if it's open when the toast fires.
    if (document.getElementById('status-modal')?.classList.contains('active')) {
        renderTrackedList();
    }
}

function updateNotifCountBadge() {
    const badge = document.getElementById('notif-count-badge');
    if (!badge) return;
    const count = getTrackedIds().length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
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
// again — re-adding it to localStorage and re-activating the listener.
async function handleCheckStatus() {
    const input = document.getElementById('input-check-transfer-id');
    const rawValue = (input?.value || '').trim();

    if (!rawValue || !/^\d+$/.test(rawValue)) {
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

    trackedStatusCache[data.id] = data.status;
    addTrackedId(data.id);
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
        trackedStatusCache[item.id] = item.status;
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
