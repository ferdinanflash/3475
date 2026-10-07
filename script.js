// ================= SHARED CODE LIVES IN common.js =================
// Supabase credentials, the President-login rules (STAFF_EMAIL_DOMAIN,
// ALLOWED_ADMIN_USERNAMES, usernameToStaffEmail, staffEmailToUsername,
// isPresidentUsername), escapeHtml, sanitizeCsvField, getSupabase, and
// copyToClipboard are all defined once in common.js and shared with res.js.
// Make sure index.html loads common.js BEFORE this file.

// ================= FURNACE LEVEL BADGE (FC1-10 images) =================
function furnaceBadgeHTML(level, withText) {
    const n = parseInt(level, 10);
    if (!Number.isFinite(n) || n < 1 || n > 10) return `FC ${escapeHtml(level)}`;
    const img = `<img class="fc-img" src="furnace/fc-${n}.webp" alt="FC ${n}" title="FC ${n}" width="96" height="96" loading="lazy" decoding="async">`;
    return withText ? `${img}<span class="fc-text">FC ${n}</span>` : img;
}
function setFurnaceBadge(el, level, withText) {
    if (el) el.innerHTML = furnaceBadgeHTML(level, withText);
}
function updateFurnaceLabel(level) {
    const el = document.getElementById('furnace-label');
    if (el) el.textContent = `FC ${parseInt(level, 10) || level}`;
}

// ================= FORM HELPERS: inline errors + number formatting =================
const FORM_FIELD_ORDER = ['in-state', 'in-nickname', 'in-gameid', 'in-alliance', 'in-furnace', 'in-power', 'in-heropower', 'in-totalhero'];
const LOW_SLOT_THRESHOLD = 5;

function setFieldError(id, message) {
    const el = document.getElementById(id);
    const group = el ? el.closest('.form-group') : null;
    if (!group) return;
    let err = group.querySelector('.field-error');
    if (!err) {
        err = document.createElement('small');
        err.className = 'field-error';
        err.id = 'err-' + id;
        err.setAttribute('role', 'alert');
        group.appendChild(err);
    }
    err.textContent = message;
    group.classList.add('has-error');
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', err.id);
}
function clearFieldError(id) {
    const el = document.getElementById(id);
    const group = el ? el.closest('.form-group') : null;
    if (!group || !group.classList.contains('has-error')) return;
    group.classList.remove('has-error');
    const err = group.querySelector('.field-error');
    if (err) err.textContent = '';
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
}
function clearAllFieldErrors() {
    FORM_FIELD_ORDER.forEach(clearFieldError);
}
function focusField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
}

// Live "1,234,567" formatting while typing. Free text such as "1.5M" or "999K+" is left alone.
function formatThousandsInput(el) {
    const raw = el.value;
    if (!/^[\d,\s]*$/.test(raw)) return;
    const caret = el.selectionStart;
    const digitsBefore = raw.slice(0, caret === null ? raw.length : caret).replace(/\D/g, '').length;
    const formatted = raw.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (formatted === raw) return;
    el.value = formatted;
    let pos = 0, seen = 0;
    while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (_) {}
}
// What gets stored: thousands separators removed, so the database keeps the same format as before.
function normalizePowerValue(v) {
    return String(v || '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}
// What gets shown: plain digit strings get separators, free text is untouched.
function formatPowerDisplay(v) {
    const s = String(v === null || v === undefined ? '' : v);
    return /^\d{4,}$/.test(s) ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}

// ================= APPLICANT SEARCH + STATUS FILTER =================
const applicantFilter = { q: '', status: 'all' };
function applicantMatchesFilter(item) {
    if (applicantFilter.status !== 'all' && item.status !== applicantFilter.status) return false;
    const q = applicantFilter.q.trim().toLowerCase();
    if (!q) return true;
    return String(item.nickname || '').toLowerCase().includes(q) || String(item.game_id || '').toLowerCase().includes(q);
}

let isAdmin = false;
let currentStaffUsername = null;
let transferList = [];
let maxSlots = 35; 
let currentSelectedPlayerId = null;

document.addEventListener("DOMContentLoaded", async () => {
    const client = getSupabase();
    if (client) {
        // Restore session from Supabase's own encrypted storage instead of
        // trusting a plain localStorage flag anyone could set by hand.
        const { data: { session } } = await client.auth.getSession();
        applyAuthSession(session);

        // Keep isAdmin in sync if the session refreshes, expires, or the
        // user signs in/out in another tab (or on another page sharing the
        // same Supabase project/account).
        client.auth.onAuthStateChange((_event, session) => {
            applyAuthSession(session);
        });
    }

    loadTransfers();
    setupRealtimeChannels();

    const resetPasswordInput = document.getElementById('reset-password-input');
    if (resetPasswordInput) {
        resetPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmResetTransferPhase();
        });
    }
});

// Applies (or clears) admin UI/state from a Supabase Auth session. This is
// the single source of truth for isAdmin now — never set it directly.
// A session belonging to any staff account NOT in ALLOWED_ADMIN_USERNAMES
// (e.g. one restored from another page's login) is deliberately treated as
// "not admin" here — it's a valid session, just not authorized on this page.
function applyAuthSession(session) {
    const sessionUsername = session ? staffEmailToUsername(session.user.email) : null;
    isAdmin = isPresidentUsername(sessionUsername);
    currentStaffUsername = isAdmin ? sessionUsername : null;
    document.body.classList.toggle('admin-mode', isAdmin);

    refreshAdminBtn();
    if (!isAdmin) { closePresMenu(); closePresidentInfoModal(); }

    updateCounters();
    renderTable();
}

// REALTIME STREAM CHANNELS (auto-sync whenever the database changes)
function setupRealtimeChannels() {
    const client = getSupabase();
    if (!client) return;

    client
        .channel('portal-sync-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'player_transfers' }, () => {
            loadTransfers();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: 'id=eq.1' }, () => {
            loadTransfers();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'footer_settings', filter: 'id=eq.main' }, () => {
            loadFooterInfo();
        })
        .subscribe();
}

// 1. DISPLAY SYSTEM METADATA FROM SUPABASE (state_info etc., from system_settings)
function displaySystemSettings(settings) {
    const raw = settings.state_info || '';
    // Don't wipe what the admin is typing when an unrelated realtime update arrives
    if (raw === stateRaw && stateData && isAdmin) return;
    stateRaw = raw;
    stateData = parseStateInfo(raw);
    renderStateInfo();
}

// ---------- ABOUT OUR STATE: structured content stored as JSON in system_settings.state_info ----------
let stateRaw = null;
let stateData = null;

function defaultStateData() {
    return {
        intro: '',
        cards: [
            { icon: '⚔️', cls: 'sc-gold',   title: t('scCoreTitle'),  strong: t('scCoreStrong'),  text: t('scCoreText') },
            { icon: '⚙️', cls: 'sc-amber',  title: t('scRotTitle'),   strong: t('scRotStrong'),   text: t('scRotText') },
            { icon: '🤝', cls: 'sc-teal',   title: t('scUnityTitle'), strong: t('scUnityStrong'), text: t('scUnityText') },
            { icon: '☁️', cls: 'sc-purple', title: t('scEasyTitle'),  strong: t('scEasyStrong'),  text: t('scEasyText') }
        ],
        playTitle: t('playTimeTitle'),
        headers: [t('thAlliance'), 'BT1 Time', 'BT2 Time', 'CJ Time', 'Foundry Time'],
        rows: [
            ['ARX', '13:30', '15:35', '-', '-'],
            ['IDN - By Vote', 'By Vote', '12:00/14:00', '12:00/14:00', '12:00/14:00'],
            ['ZXC', '13:00', '13:00', '20:30', '14:00/19:00'],
            ['VNX', '13:00/19:00', '13:00/19:00', '13:00/19:00', '14:00'],
            ['CAT', '12:30', '14:00', '-', '-']
        ]
    };
}

function parseStateInfo(raw) {
    const data = defaultStateData();
    const text = String(raw || '').trim();
    if (!text) return data;
    try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object' && obj.v === 2) {
            if (typeof obj.intro === 'string') data.intro = obj.intro;
            if (Array.isArray(obj.cards) && obj.cards.length) {
                data.cards = obj.cards.slice(0, 4).map((c, i) => ({
                    icon: c.icon || '', cls: data.cards[i] ? data.cards[i].cls : 'sc-gold',
                    title: c.title || '', strong: c.strong || '', text: c.text || ''
                }));
            }
            if (typeof obj.playTitle === 'string') data.playTitle = obj.playTitle;
            if (Array.isArray(obj.headers) && obj.headers.length === 5) data.headers = obj.headers.map(String);
            if (Array.isArray(obj.rows)) data.rows = obj.rows.map(r => [0,1,2,3,4].map(i => String((r && r[i]) ?? '')));
            return data;
        }
    } catch (e) { /* not JSON: legacy plain text */ }
    data.intro = text;   // legacy plain-text description becomes the intro
    return data;
}

// Render teks multi-baris dari editor (Enter = baris baru). Baris berawalan "-", "•" atau "*"
// ditampilkan sebagai bullet dengan indent gantung; baris kosong menjadi jarak antar paragraf.
function renderMultiline(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => {
        const l = line.trim();
        if (!l) return '<div class="sc-gap"></div>';
        const bullet = /^[-•*]\s+/.test(l);
        return `<div class="sc-line${bullet ? ' sc-bullet' : ''}">${escapeHtml(l)}</div>`;
    }).join('');
}

// ---------- AUTO-TRANSLATE "ABOUT OUR STATE" (display only) ----------
// The text saved in Supabase is never touched. For non-admin viewers the content is translated
// in the browser into the selected language, cached in localStorage, and rendered from a COPY.
// Admin/President always sees and edits the original text. If translation fails, the original is shown.
const STATE_TR_LANG = { en: 'en', id: 'id', cn: 'zh-CN', it: 'it', tl: 'tl' };
// Game terms that must never be machine-translated (kept as written, any letter case)
const STATE_TR_PROTECT = /\b(BT1|BT2|CJ|SvS|Foundry|Strongholds?|State|NAP|ARX|IDN|ZXC|VNX|CAT|Hero|Furnace|Power)\b/gi;
// Forced translations per target language (edit here to add more). Other languages keep the original term.
const STATE_TR_GLOSSARY = [
    { re: /\bTundra Arm League\b/gi, to: { id: 'Liga Perang Tundra' } },
    { re: /\bCastles?\b/gi,          to: { id: 'Kastil' } },
    { re: /\bFoundry\b/gi,           to: { id: 'Tanur' } }
];
let stateTr = null;            // { key, data, changed, status: 'loading'|'done'|'failed' }
let showStateOriginal = false; // viewer toggle

function stateHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function stateTrKey() { return currentLanguage() + '|' + stateHash(String(stateRaw || '')); }

function stateTrCase(src, val) { return (src.length > 1 && src === src.toUpperCase()) ? val.toUpperCase() : val; }
function stateTrProtect(str, tl) {
    const map = [];
    const keep = (m, forced) => { map.push(forced ? stateTrCase(m, forced) : m); return 'ZQ' + (map.length - 1) + 'Z'; };
    let s = str;
    STATE_TR_GLOSSARY.forEach(g => { s = s.replace(g.re, m => keep(m, g.to[tl])); });
    s = s.replace(STATE_TR_PROTECT, m => keep(m));
    return { s, map };
}
function stateTrRestore(str, map) { return str.replace(/ZQ\s?(\d+)\s?Z/gi, (_, i) => map[i] !== undefined ? map[i] : ''); }

async function stateTrFetch(text, tl) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' +
        encodeURIComponent(tl) + '&q=' + encodeURIComponent(text);
    const r = await fetch(url);
    if (!r.ok) throw new Error('translate ' + r.status);
    const j = await r.json();
    return j[0].map(seg => seg[0]).join('');
}

// Translate a list of single-line strings (cached per string in localStorage)
async function stateTrLines(lines, tl) {
    const out = new Map(), todo = [];
    lines.forEach(l => {
        let c = null;
        try { c = localStorage.getItem('3475_tr3:' + tl + ':' + stateHash(l)); } catch (e) {}
        if (c !== null) out.set(l, c); else todo.push(l);
    });
    for (let i = 0; i < todo.length;) {        // chunks of <= ~1200 chars per request
        const chunk = []; let len = 0;
        while (i < todo.length && (chunk.length === 0 || len + todo[i].length < 1200)) { len += todo[i].length + 1; chunk.push(todo[i++]); }
        const prot = chunk.map(x => stateTrProtect(x, tl));
        let res = null;
        try {
            const joined = await stateTrFetch(prot.map(p => p.s).join('\n'), tl);
            const parts = joined.split('\n');
            if (parts.length === chunk.length) res = parts;
        } catch (e) { /* fall through to one-by-one */ }
        if (!res) res = await Promise.all(prot.map(p => stateTrFetch(p.s, tl)));
        chunk.forEach((orig, k) => {
            const val = stateTrRestore(res[k], prot[k].map).trim() || orig;
            out.set(orig, val);
            try { localStorage.setItem('3475_tr3:' + tl + ':' + stateHash(orig), val); } catch (e) {}
        });
    }
    return out;
}

async function ensureStateTranslation() {
    if (isAdmin || !stateData || !String(stateRaw || '').trim()) return;
    const key = stateTrKey();
    if (stateTr && stateTr.key === key) return;
    const tl = STATE_TR_LANG[currentLanguage()] || 'en';
    stateTr = { key, data: null, changed: false, status: 'loading' };

    const d = stateData;
    const units = new Set();
    const canTr = s => /\p{L}/u.test(s) && !/^\s*$/.test(s);
    const splitLine = l => { const m = l.match(/^(\s*[-•*]\s+)?([\s\S]*)$/); return [m[1] || '', m[2].trim()]; };
    const collect = str => String(str || '').split(/\r\n?|\n/).forEach(l => { const b = splitLine(l)[1]; if (canTr(b)) units.add(b); });
    collect(d.intro);
    d.cards.forEach(c => { collect(c.title); collect(c.strong); collect(c.text); });
    collect(d.playTitle);
    d.headers.forEach(collect);
    d.rows.forEach(r => r.forEach((cell, ci) => { if (ci > 0) collect(cell); }));   // column 0 = alliance names: never translated

    try {
        const map = await stateTrLines([...units], tl);
        if (!stateTr || stateTr.key !== key) return;           // language/content changed meanwhile
        let changed = false;
        const tr = str => String(str || '').split(/\r\n?|\n/).map(l => {
            const [pre, body] = splitLine(l);
            if (!canTr(body) || !map.has(body)) return l;
            const v = map.get(body); if (v !== body) changed = true;
            return pre + v;
        }).join('\n');
        stateTr.data = {
            intro: tr(d.intro),
            cards: d.cards.map(c => ({ ...c, title: tr(c.title), strong: tr(c.strong), text: tr(c.text) })),
            playTitle: tr(d.playTitle),
            headers: d.headers.map(tr),
            rows: d.rows.map(r => r.map((cell, ci) => ci === 0 ? cell : tr(cell)))
        };
        stateTr.changed = changed;
        stateTr.status = 'done';
    } catch (e) {
        console.warn('Auto-translate failed, showing original text', e);
        if (stateTr && stateTr.key === key) stateTr.status = 'failed';
    }
    if (stateTr && stateTr.key === key) renderStateInfo();
}

function toggleStateOriginal() { showStateOriginal = !showStateOriginal; renderStateInfo(); }

function stateTrNote() {
    if (isAdmin || !stateTr || stateTr.key !== stateTrKey()) return '';
    if (stateTr.status === 'loading') return `<div class="state-tr-note">🌐 ${escapeHtml(t('stateTranslating'))}</div>`;
    if (stateTr.status !== 'done' || !stateTr.changed) return '';
    return `<div class="state-tr-note">🌐 ${escapeHtml(t(showStateOriginal ? 'stateShowingOriginal' : 'stateAutoTranslated'))} ·
        <button type="button" onclick="toggleStateOriginal()">${escapeHtml(t(showStateOriginal ? 'stateShowTranslation' : 'stateShowOriginal'))}</button></div>`;
}

function renderStateInfo() {
    const view = document.getElementById('state-info-view');
    if (!view) return;
    if (!stateData) stateData = parseStateInfo(stateRaw);
    // Viewers get a translated COPY; stateData (the original, used for editing/saving) is never modified
    const d = (!isAdmin && !showStateOriginal && stateTr && stateTr.key === stateTrKey() && stateTr.data) ? stateTr.data : stateData;
    const esc = escapeHtml;
    const colCls = ['', 'c-bt1', 'c-bt2', 'c-cj', 'c-fo'];
    const saveBtn = document.getElementById('save-state-btn');

    if (isAdmin) {
        if (saveBtn) saveBtn.style.display = 'block';
        view.innerHTML = `
            <div class="se-note">✏️ Edit mode: change any text below, then press Save.</div>
            <label class="se-label">Intro text</label>
            <textarea id="se-intro" class="se-input" rows="3">${esc(d.intro)}</textarea>
            <label class="se-label">Cards</label>
            <div class="se-cards">${d.cards.map((c, i) => `
                <div class="state-card ${c.cls}">
                    <div class="se-row"><input class="se-input se-icon" data-card="${i}" data-f="icon" value="${esc(c.icon)}" maxlength="4" placeholder="🙂">
                    <input class="se-input" data-card="${i}" data-f="title" value="${esc(c.title)}" placeholder="Title"></div>
                    <input class="se-input" data-card="${i}" data-f="strong" value="${esc(c.strong)}" placeholder="Bold text">
                    <textarea class="se-input se-textarea" rows="5" data-card="${i}" data-f="text" placeholder="Description">${esc(c.text)}</textarea>
                </div>`).join('')}
            </div>
            <label class="se-label">Play time table</label>
            <input id="se-playtitle" class="se-input" value="${esc(d.playTitle)}" placeholder="Table title">
            <div class="state-table-wrap"><table class="state-table se-table">
                <thead><tr>${d.headers.map((hd, i) => `<th><input class="se-input" data-h="${i}" value="${esc(hd)}"></th>`).join('')}<th></th></tr></thead>
                <tbody>${d.rows.map((r, ri) => `<tr>${r.map((cell, ci) => `<td class="${colCls[ci]}"><input class="se-input" data-r="${ri}" data-c="${ci}" value="${esc(cell)}"></td>`).join('')}
                    <td><button type="button" class="se-del" title="Delete row" onclick="stateDeleteRow(${ri})">🗑</button></td></tr>`).join('')}
                </tbody></table></div>
            <button type="button" class="btn btn-admin se-add" onclick="stateAddRow()">➕ Add row</button>`;
        return;
    }

    if (saveBtn) saveBtn.style.display = 'none';
    view.innerHTML = `
        ${stateTrNote()}
        ${d.intro ? `<div class="state-intro">${esc(d.intro)}</div>` : ''}
        <div class="state-cards">${d.cards.map(c => `
            <div class="state-card ${c.cls}">
                <div class="sc-head"><span class="sc-icon">${esc(c.icon)}</span><span class="sc-title">${esc(c.title)}</span></div>
                ${c.strong ? `<p class="sc-strong"><strong>${esc(c.strong)}</strong></p>` : ''}
                <div class="sc-text">${renderMultiline(c.text)}</div>
            </div>`).join('')}
        </div>
        <div class="state-playtime-head"><h5>${esc(d.playTitle)}</h5></div>
        <div class="state-table-wrap"><table class="state-table">
            <thead><tr>${d.headers.map(hd => `<th>${esc(hd)}</th>`).join('')}</tr></thead>
            <tbody>${d.rows.map(r => `<tr>${r.map((cell, ci) => `<td class="${colCls[ci]}">${esc(cell).replace(/\//g, '/&#8203;')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        `;
    ensureStateTranslation();
}

// Read the editor fields back into stateData
function collectStateEditor() {
    const view = document.getElementById('state-info-view');
    if (!view || !isAdmin || !view.querySelector('#se-intro')) return;
    const d = stateData;
    d.intro = view.querySelector('#se-intro').value.trim();
    view.querySelectorAll('[data-card]').forEach(el => { d.cards[+el.dataset.card][el.dataset.f] = el.value.trim(); });
    d.playTitle = view.querySelector('#se-playtitle').value.trim();
    view.querySelectorAll('[data-h]').forEach(el => { d.headers[+el.dataset.h] = el.value.trim(); });
    view.querySelectorAll('[data-r]').forEach(el => { d.rows[+el.dataset.r][+el.dataset.c] = el.value.trim(); });
}
function stateAddRow() { collectStateEditor(); stateData.rows.push(['', '', '', '', '']); renderStateInfo(); }
function stateDeleteRow(i) { collectStateEditor(); stateData.rows.splice(i, 1); renderStateInfo(); }

// 1b. DISPLAY PRESIDENT / ALLIANCE / ID GAME FROM footer_settings
// Follows the same pattern as res.js: show the cached localStorage version
// first (so it appears instantly without waiting on the network), then
// overwrite it once the real data comes back from Supabase. This is also
// what keeps this page consistent with res.js now, since both read/write
// from the same table: footer_settings (id = 'main').
function loadFooterInfo() {
    const cachedPresident = localStorage.getItem('cached_president_name');
    const cachedGuild = localStorage.getItem('cached_guild_name');
    const cachedIdGame = localStorage.getItem('cached_id_game');

    if (cachedPresident) applyPresidentDisplay(cachedPresident, cachedGuild || '-', cachedIdGame || '-');

    const client = getSupabase();
    if (!client) return;

    client
        .from('footer_settings')
        .select('president_name, guild_name, id_game')
        .eq('id', 'main')
        .single()
        .then(({ data, error }) => {
            if (error || !data) return;
            const president = data.president_name || "-";
            const guild = data.guild_name || "-";
            const idGame = data.id_game || "-";

            applyPresidentDisplay(president, guild, idGame);

            if (data.president_name) localStorage.setItem('cached_president_name', data.president_name);
            if (data.guild_name) localStorage.setItem('cached_guild_name', data.guild_name);
            if (data.id_game) localStorage.setItem('cached_id_game', data.id_game);
        })
        .catch(err => console.error("Error loading footer info from database:", err));
}

// Helper: apply president/guild/id values to every display element + edit form
// Nilai asli dari database/cache. Jangan pernah membaca ulang dari teks yang tampil di layar
// (bisa berubah karena terjemahan otomatis browser / Google Translate).
let presidentInfoRaw = { president: '', alliance: '', id: '' };

function applyPresidentDisplay(president, alliance, idGame) {
    presidentInfoRaw = { president: String(president ?? ''), alliance: String(alliance ?? ''), id: String(idGame ?? '') };
    document.getElementById('val-president').innerText = president;
    document.getElementById('val-alliance').innerText = alliance;

    const valId = document.getElementById('val-id');
    valId.innerText = idGame;
    valId.style.cursor = 'pointer';
    valId.title = t('clickToCopyId');
    valId.onclick = () => copyToClipboard(idGame);

    document.getElementById('edit-president').value = president === '-' ? '' : president;
    document.getElementById('edit-alliance').value = alliance === '-' ? '' : alliance;
    document.getElementById('edit-id').value = idGame === '-' ? '' : idGame;
}

// POPUP MODAL CONTROL SECTIONS
function openStateModal() {
    document.getElementById('state-info-modal').classList.add('active');
}

function closeStateModal() {
    document.getElementById('state-info-modal').classList.remove('active');
}

// SPECIAL NOTES MODAL CONTROLS (ADMIN ONLY)
function openSpecialNotesModal() {
    if (!isAdmin) return;
    document.getElementById('admin-special-notes-modal').classList.add('active');
    loadSpecialNotes();
}

function closeSpecialNotesModal() {
    document.getElementById('admin-special-notes-modal').classList.remove('active');
}

// LOAD SPECIAL NOTES FROM SYSTEM_SETTINGS
async function loadSpecialNotes() {
    const client = getSupabase();
    if (!client) return;

    try {
        const { data, error } = await client
            .from('system_settings')
            .select('special_notes')
            .eq('id', 1)
            .single();

        if (!error && data) {
            document.getElementById('admin-special-notes-edit').value = data.special_notes || '';
        }
    } catch (err) {
        console.error("Failed loading special notes:", err);
    }
}

// SAVE SPECIAL NOTES TO SYSTEM_SETTINGS ON SUPABASE
async function saveSpecialNotes() {
    if (!isAdmin) return;

    const content = document.getElementById('admin-special-notes-edit').value;
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('system_settings')
            .update({ special_notes: content })
            .eq('id', 1);

        if (!error) {
            showToast(t('specialNotesSaved'), 'success');
            closeSpecialNotesModal();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed saving special notes:", err);
        showToast(`${t('specialNotesSaveFailed')}: ${err.message}`, 'error');
    }
}

// 2. ADMIN ACTION: SAVE THE ABOUT OUR STATE DESCRIPTION
async function saveStateInfo() {
    if (!isAdmin) return;
    
    collectStateEditor();
    const d = stateData;
    const textValue = JSON.stringify({
        v: 2, intro: d.intro,
        cards: d.cards.map(c => ({ icon: c.icon, title: c.title, strong: c.strong, text: c.text })),
        playTitle: d.playTitle, headers: d.headers,
        rows: d.rows.filter(r => r.some(cell => cell !== ''))
    });
    stateRaw = textValue;
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('system_settings')
            .update({ state_info: textValue })
            .eq('id', 1);

        if (!error) {
            showToast(t('stateInfoSaved'), 'success');
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Cloud failure update metadata:", err);
        showToast(`${t('stateInfoSaveFailed')}: ${err.message}`, 'error');
    }
}

// 3. ADMIN ACTION: SAVE PRESIDENT HEADER DATA ALL AT ONCE
// Now writes to footer_settings (id = 'main'), the same table used by
// res.js, so President/Alliance/ID Game stay consistent across both pages.
async function savePresidentInfo() {
    if (!isAdmin) return;
    
    const presVal = document.getElementById('edit-president').value.trim();
    const alliVal = document.getElementById('edit-alliance').value.trim();
    const idVal = document.getElementById('edit-id').value.trim();
    
    if (!presVal || !alliVal || !idVal) {
        showToast(t('infoFieldsRequired'), 'warning');
        return;
    }
    
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('footer_settings')
            .update({
                president_name: presVal,
                guild_name: alliVal,
                id_game: idVal,
                updated_at: new Date().toISOString()
            })
            .eq('id', 'main');

        if (!error) {
            localStorage.setItem('cached_president_name', presVal);
            localStorage.setItem('cached_guild_name', alliVal);
            localStorage.setItem('cached_id_game', idVal);

            showToast(t('infoSaved'), 'success');
            loadFooterInfo();
            closePresidentInfoModal();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Cloud sync save failure:", err);
        showToast(`${t('infoSaveFailed')}: ${err.message}`, 'error');
    }
}

// 4. ADMIN ACTION: CHANGE THE MAXIMUM SLOT QUOTA LIMIT
async function changeMaxSlots(value) {
    if (!isAdmin) return;
    
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue) || parsedValue < 1) {
        showToast(t('invalidSlots'), 'warning');
        document.getElementById('in-max-slots').value = maxSlots;
        return;
    }
    
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('system_settings')
            .update({ max_slots: parsedValue })
            .eq('id', 1);

        if (!error) {
            maxSlots = parsedValue;
            showToast(t('maxSlotsUpdated', { max: maxSlots }), 'success');
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed adjusting system limits:", err);
        showToast(`${t('maxSlotsUpdateFailed')}: ${err.message}`, 'error');
        document.getElementById('in-max-slots').value = maxSlots;
    }
}

// SUBMIT NEW APPLICANT FORM DATA
async function submitTransfer() {
    const client = getSupabase();
    if (!client) return;

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn?.disabled) return;
    if (submitBtn) submitBtn.disabled = true;

    try {
        const state = document.getElementById('in-state').value.trim();
        const nickname = document.getElementById('in-nickname').value.trim();
        const gameId = document.getElementById('in-gameid').value.trim();
        const alliance = document.getElementById('in-alliance').value.trim();
        const furnace = document.getElementById('in-furnace').value.trim();
        const power = normalizePowerValue(document.getElementById('in-power').value.trim());
        const heroPower = normalizePowerValue(document.getElementById('in-heropower').value.trim());
        const totalHero = normalizePowerValue(document.getElementById('in-totalhero').value.trim());
        const referrer = document.getElementById('in-referrer').value.trim();

        // Inline, per-field validation (errors appear under each field).
        clearAllFieldErrors();
        const bad = new Set();
        const flag = (id, msg) => { setFieldError(id, msg); bad.add(id); };
        [['in-state', state], ['in-nickname', nickname], ['in-gameid', gameId], ['in-alliance', alliance],
         ['in-power', power], ['in-heropower', heroPower], ['in-totalhero', totalHero]]
            .forEach(([id, val]) => { if (!val) flag(id, t('fieldRequired')); });

        const furnaceEl = document.getElementById('in-furnace');
        if (furnaceEl && furnaceEl.dataset.touched !== '1') flag('in-furnace', t('furnaceTouchRequired'));
        if (gameId && !/^\d+$/.test(gameId)) flag('in-gameid', t('gameIdNumbers'));
        if (power.length > 50) flag('in-power', t('invalidNumbers'));
        if (heroPower.length > 50) flag('in-heropower', t('invalidNumbers'));
        if (totalHero.length > 50) flag('in-totalhero', t('invalidNumbers'));

        const stateNum = parseInt(state, 10);
        const furnaceNum = parseInt(furnace, 10);
        if (state && (!Number.isFinite(stateNum) || stateNum < 0)) flag('in-state', t('invalidNumbers'));
        if (!Number.isFinite(furnaceNum) || furnaceNum < 1 || furnaceNum > 10) flag('in-furnace', t('furnaceRange'));

        if (bad.size) {
            focusField(FORM_FIELD_ORDER.find(id => bad.has(id)));
            return;
        }

        const { data: insertedRow, error } = await client.rpc('submit_transfer_application', {
            p_transfer_from_state: stateNum,
            p_nickname: nickname,
            p_game_id: gameId,
            p_desired_alliance: alliance,
            p_furnace_level: furnaceNum,
            p_power: power,
            p_hero_power: heroPower,
            p_total_hero_power: totalHero,
            p_referrer: referrer || null
        });

        if (error) {
            if (String(error.message || '').includes('REGISTRATION_QUOTA_FULL')) {
                showToast(t('quotaFull'), 'error');
            } else {
                throw error;
            }
            return;
        }

        const application = insertedRow || {};
        showToast(t('submitSuccess'), 'success');

        const notifCheckbox = document.getElementById('in-get-notification');
        if (notifCheckbox?.checked && application.id && typeof trackNewApplication === 'function') {
            trackNewApplication(application.id);
        }

        document.querySelectorAll('#transfer-form-fields input, #transfer-form-fields select').forEach(input => {
            if (input.id !== 'in-max-slots' && input.id !== 'in-furnace') input.value = '';
        });
        clearAllFieldErrors();
        updateFurnaceLabel(1);
        const furnaceReset = document.getElementById('in-furnace');
        if (furnaceReset) {
            furnaceReset.value = '1';
            furnaceReset.dataset.touched = '0';
            const furnaceBadge = document.getElementById('furnace-badge');
            setFurnaceBadge(furnaceBadge, 1);
        }
        const notifCheckboxAfter = document.getElementById('in-get-notification');
        if (notifCheckboxAfter) notifCheckboxAfter.checked = false;
        loadTransfers();
    } catch (error) {
        console.error('Error submitting transfer application:', error);
        showToast(`${t('submitError')}: ${error.message || error}`, 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        updateCounters();
    }
}

// FETCH ALL CURRENT DATA FROM THE DATABASE
async function loadTransfers() {
    const client = getSupabase();
    if (!client) return;
    
    try {
        const { data: settingsData, error: settingsError } = await client
            .from('system_settings')
            .select('*')
            .eq('id', 1)
            .single();
            
        if (!settingsError && settingsData) {
            maxSlots = settingsData.max_slots;
            displaySystemSettings(settingsData);
        }

        loadFooterInfo();

        const { data, error } = await client
            .from('player_transfers')
            .select('*')
            .order('id', { ascending: false });
            
        if (error) throw error;
        transferList = data || [];
        updateCounters();
        renderTable();
    } catch (e) {
        console.error("Database structural access failure:", e);
    }
}

// COUNTER LOGIC & ELEMENT TOGGLES FOR THE ADMIN VIEW
function updateCounters() {
    const totalApplicants = transferList.length;
    const acceptedCount = transferList.filter(item => item.status === 'Accepted').length;
    
    document.getElementById('count-total').innerText = totalApplicants;
    document.getElementById('count-accepted').innerText = acceptedCount;
    const leftEl = document.getElementById('count-left');
    const slotsLeft = Math.max(0, maxSlots - acceptedCount);
    if (leftEl) leftEl.innerText = slotsLeft;
    const leftCard = document.querySelector('.slots-left-card');
    if (leftCard) {
        leftCard.classList.toggle('is-low', slotsLeft > 0 && slotsLeft <= LOW_SLOT_THRESHOLD);
        leftCard.classList.toggle('is-full', slotsLeft === 0);
        if (slotsLeft > 0 && slotsLeft <= LOW_SLOT_THRESHOLD) leftCard.title = t('slotsLow', { n: slotsLeft });
        else leftCard.removeAttribute('title');
    }
    const formFields = document.getElementById('transfer-form-fields');
    if (formFields) formFields.classList.toggle('is-locked', slotsLeft === 0);
    
    // Scoped to #transfer-form-fields only — NOT a page-wide '.form-group'
    // selector, which would also grab (and disable) unrelated inputs like
    // the President Login modal's username/password fields whenever the
    // registration quota is full.
    const inputs = document.querySelectorAll('#transfer-form-fields input, #transfer-form-fields select');
    const submitBtn = document.getElementById('submit-btn');
    const lockMessage = document.getElementById('lock-message');
    const maxSlotsInput = document.getElementById('in-max-slots');
    
    if (maxSlotsInput) {
        maxSlotsInput.disabled = !isAdmin;
        maxSlotsInput.value = maxSlots;
    }
    const maxSlotDisplay = document.getElementById('max-slot-display');
    if (maxSlotDisplay) {
        maxSlotDisplay.innerText = maxSlots;
    }

    // President info is display-only in the header; editing happens in the
    // President Info modal (opened from the crown menu). Only the About Our
    // State view/editor needs re-rendering when the auth state changes.
    renderStateInfo();
    
    if (acceptedCount >= maxSlots) {
        inputs.forEach(input => {
            if (input.id !== 'in-max-slots') input.disabled = true;
        });
        if (submitBtn) submitBtn.disabled = true;
        if (lockMessage) lockMessage.style.display = "flex";
    } else {
        inputs.forEach(input => {
            if (input.id !== 'in-max-slots') input.disabled = false;
        });
        if (submitBtn) submitBtn.disabled = false;
        if (lockMessage) lockMessage.style.display = "none";
    }
}

// RENDER APPLICANT LIST TABLE
function renderTable() {
    const tbody = document.getElementById('transfer-tbody');
    const thAction = document.getElementById('th-action');
    const resetBtn = document.getElementById('reset-phase-btn');
    const mobileList = document.getElementById('mobile-applicants-list');
    
    if (!tbody) return;
    tbody.innerHTML = "";
    if (mobileList) mobileList.innerHTML = "";
    
    if (thAction) thAction.style.display = isAdmin ? "table-cell" : "none";
    
    if (resetBtn) {
        resetBtn.style.display = isAdmin ? "inline-block" : "none";
    }
    
    if (transferList.length === 0) {
        const totalCols = isAdmin ? 6 : 5;
        tbody.innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center; color:#94a3b8; padding:24px;">${escapeHtml(typeof t === 'function' ? t('noApplications') : 'No applications found')}</td></tr>`;
        if (mobileList) mobileList.innerHTML = `<div class="mobile-empty">${escapeHtml(typeof t === 'function' ? t('noApplications') : 'No applications found')}</div>`;
        return;
    }
    
    if (!transferList.some(applicantMatchesFilter)) {
        const totalCols = isAdmin ? 6 : 5;
        const msg = escapeHtml(t('noMatches'));
        tbody.innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center; color:#94a3b8; padding:24px;">${msg}</td></tr>`;
        if (mobileList) mobileList.innerHTML = `<div class="mobile-empty">${msg}</div>`;
        return;
    }

    transferList.forEach((item, index) => {
        if (!applicantMatchesFilter(item)) return;
        const row = document.createElement('tr');
        let actionCell = "";
        let notesCell = "";
        
        if (isAdmin) {
            actionCell = `
                <td class="admin-actions">
                    ${item.status === 'Waiting' ? `
                        <button class="btn-accept" onclick="updateStatus(${item.id}, 'Accepted')">${typeof t === 'function' ? t('accept') : 'Accept'}</button>
                        <button class="btn-reject" onclick="updateStatus(${item.id}, 'Rejected')">${typeof t === 'function' ? t('reject') : 'Reject'}</button>
                    ` : `
                        <button class="btn-delete" onclick="deleteRecord(${item.id})">${typeof t === 'function' ? t('delete') : 'Delete'}</button>
                    `}
                </td>
            `;
            
            
        }
        
        let badgeClass = `badge badge-${item.status.toLowerCase()}`;
        
        row.innerHTML = `
            <td class="col-detail">
                <button class="btn-view-detail" onclick="showDetailPopup(${index})">👁️</button>
            </td>
            ${isAdmin ? actionCell : ''}
            <td class="hide-mobile from-state-cell">${escapeHtml(item.transfer_from_state)}</td>
            <td><strong>${escapeHtml(item.nickname)}</strong></td>
            <td class="game-id-cell" onclick="copyToClipboard(transferList[${index}].game_id)" style="cursor:pointer;" title="${t('clickToCopyId')}">${escapeHtml(item.game_id)} 📋</td>
            <td style="text-align: center;"><span class="${badgeClass}">${escapeHtml(typeof statusLabel === 'function' ? statusLabel(item.status) : item.status)}</span></td>
        `;
        tbody.appendChild(row);

        if (mobileList) {
            const card = document.createElement('div');
            card.className = 'mobile-applicant';
            const statusClass = `badge badge-${item.status.toLowerCase()}`;
            const notes = isAdmin && item.notes ? `<div class="mobile-note">📝 ${escapeHtml(item.notes)}</div>` : '';
            const adminActions = isAdmin ? `<div class="mobile-admin-actions" aria-label="Applicant actions">${item.status === 'Waiting' ? `<button type="button" class="btn btn-accept" onclick="updateStatus(${item.id}, 'Accepted')"><span class="action-icon">✓</span><span>${typeof t === 'function' ? t('accept') : 'Accept'}</span></button><button type="button" class="btn btn-reject" onclick="updateStatus(${item.id}, 'Rejected')"><span class="action-icon">×</span><span>${typeof t === 'function' ? t('reject') : 'Reject'}</span></button>` : `<button type="button" class="btn btn-delete" onclick="deleteRecord(${item.id})"><span class="action-icon">⌫</span><span>${typeof t === 'function' ? t('delete') : 'Delete'}</span></button>`}</div>` : '';
            card.innerHTML = `
                <div class="mobile-applicant-top"><span class="mobile-player">${escapeHtml(item.nickname)}</span><span class="${statusClass}">${escapeHtml(typeof statusLabel === 'function' ? statusLabel(item.status) : item.status)}</span></div>
                <div class="mobile-meta"><span>From ${escapeHtml(item.transfer_from_state)}</span><span>${escapeHtml(item.game_id)}</span><span class="mobile-fc">${furnaceBadgeHTML(item.furnace_level, true)}</span></div>
                ${notes}
                <div class="mobile-actions" aria-label="Applicant information actions"><button type="button" class="btn btn-view-detail" onclick="showDetailPopup(${index})"><span class="action-icon">👁</span><span>${typeof t === 'function' ? t('details') : 'Details'}</span></button><button type="button" class="btn btn-admin btn-copy-id" onclick="copyToClipboard(transferList[${index}].game_id)"><span class="action-icon">▣</span><span>${typeof t === 'function' ? t('copyId') : 'Copy ID'}</span></button></div>
                ${adminActions}
            `;
            mobileList.appendChild(card);
        }
    });
}

// MOBILE APPLICANTS WINDOW
function openApplicantsModal() {
    const card = document.querySelector('.applicants-card');
    if (!card) return;
    card.classList.add('mobile-open');
    document.body.classList.add('applicants-modal-open');
    // Keep the live list current when the window opens.
    renderTable();
}

function closeApplicantsModal() {
    const card = document.querySelector('.applicants-card');
    if (card) card.classList.remove('mobile-open');
    document.body.classList.remove('applicants-modal-open');
}

// SHOW DETAIL POPUP
function showDetailPopup(index) {
    const player = transferList[index];
    if (!player) return;

    currentSelectedPlayerId = player.id;

    document.getElementById('pop-nickname').innerText = `${t('detailPrefix')}: ${player.nickname}`;
    document.getElementById('pop-state').innerText = `${t('statePrefix')} ${player.transfer_from_state}`;
    
    const popGameId = document.getElementById('pop-gameid');
    popGameId.innerText = String(player.game_id);   // ikon 📋 sudah ditambahkan CSS (.game-id-detail::after); jangan diduplikasi di sini
    popGameId.style.cursor = 'pointer';
    popGameId.title = t('clickToCopyId');
    popGameId.onclick = () => copyToClipboard(player.game_id);

    document.getElementById('pop-alliance').innerText = player.desired_alliance || '-';
    setFurnaceBadge(document.getElementById('pop-furnace'), player.furnace_level, true);
    document.getElementById('pop-power').innerText = formatPowerDisplay(player.power);
    document.getElementById('pop-heropower').innerText = formatPowerDisplay(player.hero_power);
    document.getElementById('pop-totalhero').innerText = formatPowerDisplay(player.total_hero_power);
    document.getElementById('pop-referrer').innerText = player.referrer || '-';
    document.getElementById('pop-status').innerText = typeof statusLabel === 'function' ? statusLabel(player.status) : player.status;
    const statusPill = document.getElementById('pop-status-pill');
    if (statusPill) {
        statusPill.innerText = typeof statusLabel === 'function' ? statusLabel(player.status) : player.status;
        statusPill.className = `modal-status-pill modal-status-${String(player.status).toLowerCase()}`;
    }

    const notesContainer = document.getElementById('pop-notes-container');
    const notesInput = document.getElementById('pop-notes-input');
    const saveNoteBtn = document.getElementById('pop-notes-save-btn');
    
    if (isAdmin) {
        notesContainer.style.display = 'flex';
        notesInput.value = player.notes || '';
        saveNoteBtn.onclick = () => savePlayerNote(player.id);
        
    } else {
        notesContainer.style.display = 'none';
    }

    document.getElementById('detail-modal').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
    currentSelectedPlayerId = null;
}

// ADMIN ACTION: SAVE APPLICANT NOTE RECORD TO SUPABASE
async function savePlayerNote(playerId) {
    if (!isAdmin || !playerId) return;

    const noteText = document.getElementById('pop-notes-input').value;
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('player_transfers')
            .update({ notes: noteText })
            .eq('id', playerId);

        if (!error) {
            showToast(t('adminNoteSaved'), 'success');
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed to save note:", err);
        showToast(`${t('adminNoteSaveFailed')}: ${err.message}`, 'error');
    }
}

// EVENT LISTENER: CLOSE MODAL WINDOW WHEN CLICKING OUTSIDE THE POPUP
window.onclick = function(event) {
    const detailModal = document.getElementById('detail-modal');
    const stateModal = document.getElementById('state-info-modal');
    const specialModal = document.getElementById('admin-special-notes-modal');
    const loginModal = document.getElementById('login-modal');
    const resetPasswordModal = document.getElementById('reset-password-modal');

    if (event.target === detailModal) closeDetailModal();
    if (event.target === stateModal) closeStateModal();
    if (event.target === specialModal) closeSpecialNotesModal();
    if (event.target === loginModal) closeLoginModal();
    if (event.target === resetPasswordModal) closeResetPasswordModal();
}

// ADMIN ACTION: UPDATE APPLICANT STATUS
async function updateStatus(id, newStatus) {
    if (!isAdmin) {
        showToast(t('unauthorized'), 'error');
        return;
    }
    const client = getSupabase();
    if (!client) return;

    const actionText = newStatus.toLowerCase();
    const actionLabel = newStatus === 'Accepted' ? t('acceptVerb') : t('rejectVerb');
    if (!confirm(t('confirmStatus', { action: actionLabel }))) return;

    try {
        let error = null;
        if (newStatus === 'Accepted') {
            const result = await client.rpc('accept_transfer_application', { p_transfer_id: id });
            error = result.error;
            if (error && String(error.message || '').includes('QUOTA_FULL')) {
                showToast(t('quotaReached', { max: maxSlots }), 'error');
                return;
            }
        } else {
            const result = await client.from('player_transfers').update({ status: newStatus }).eq('id', id);
            error = result.error;
        }
        if (error) throw error;
        const statusLabelText = typeof statusLabel === 'function' ? statusLabel(newStatus) : newStatus;
        showToast(t('applicationStatusSuccess', { status: statusLabelText }), 'success');
        await loadTransfers();
    } catch (err) {
        console.error('Failed altering application status:', err);
        showToast(`${t('statusUpdateFailed')}: ${err.message || err}`, 'error');
    }
}

// ADMIN ACTION: PERMANENTLY DELETE A SINGLE APPLICANT RECORD
async function deleteRecord(id) {
    if (!isAdmin) return;
    const player = transferList.find(p => p.id === id);
    const playerName = player ? player.nickname : 'this applicant';
    if (!confirm(t('confirmDelete', { name: playerName }))) return;
    
    const client = getSupabase();
    if (!client) return;
    
    try {
        const { error } = await client.from('player_transfers').delete().eq('id', id);
        if (error) throw error;
        showToast(t('recordDeleted'), 'success');
        await loadTransfers();
    } catch (err) {
        showToast(`${t('deleteFailed')}: ${err.message}`, 'error');
    }
}

// ADMIN ACTION: MASSIVE DATA CLEANUP — RESET TRANSFER PHASE
// The destructive wipe itself still requires a second admin password,
// verified server-side via the verify_admin_code RPC. That password is now
// entered through a proper modal (masked <input type="password">) instead
// of the browser's plain-text prompt(), for both a safer look-over-your-
// shoulder posture and visual consistency with the rest of the app's UI.
function resetTransferPhase() {
    if (!isAdmin) {
        showToast("Unauthorized action!", "error");
        return;
    }

    const totalRecords = transferList.length;
    if (!confirm(t('confirmReset', { count: totalRecords }))) {
        return;
    }

    const passwordInput = document.getElementById('reset-password-input');
    if (passwordInput) passwordInput.value = '';
    document.getElementById('reset-password-modal').classList.add('active');
    if (passwordInput) passwordInput.focus();
}

function closeResetPasswordModal() {
    document.getElementById('reset-password-modal').classList.remove('active');
}

async function confirmResetTransferPhase() {
    const passwordInput = document.getElementById('reset-password-input');
    const password = passwordInput ? passwordInput.value : '';

    if (!password) {
        showToast(t('adminPasswordRequired'), 'warning');
        return;
    }

    const client = getSupabase();
    if (!client) return;

    const confirmBtn = document.getElementById('reset-password-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerText = t('verifying');
    }

    try {
        const { data: isValid, error: authError } = await client.rpc('verify_admin_code', { input_code: password });

        if (authError || !isValid) {
            showToast(t('resetVerificationFailed'), 'warning');
            return;
        }

        const { error } = await client
            .from('player_transfers')
            .delete()
            .neq('id', 0);

        if (error) throw error;

        showToast(t('allRecordsCleared'), 'success');
        closeResetPasswordModal();
        await loadTransfers();
    } catch (err) {
        console.error("Wipe compilation sequence error:", err);
        showToast(`${t('resetFailed')}: ${err.message}`, 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = t('deleteAllRecords');
        }
    }
}

// ADMIN MANAGEMENT SYSTEM (LOGIN & LOGOUT METHOD)
// Real authentication now happens on Supabase's servers via
// auth.signInWithPassword, which returns a verified session token. Access to
// write endpoints (player_transfers, system_settings) must be enforced with
// Row Level Security policies tied to auth.role() = 'authenticated' — this
// client-side isAdmin flag is only used to show/hide UI, never to authorize
// writes.
function handleAdminLogin() {
    if (isAdmin) {
        togglePresMenu();
        return;
    }
    const userInput = document.getElementById('input-login-username');
    const passInput = document.getElementById('input-login-password');
    if (userInput) userInput.value = '';
    if (passInput) passInput.value = '';
    document.getElementById('login-modal').classList.add('active');
    if (userInput) userInput.focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').classList.remove('active');
}

async function submitStaffLogin() {
    const client = getSupabase();
    if (!client) return;

    const username = document.getElementById('input-login-username').value.trim();
    const password = document.getElementById('input-login-password').value;

    if (!username || !password) {
        showToast(t('loginFieldsRequired'), 'warning');
        return;
    }

    // This page is President-only — don't even attempt a sign-in for any
    // other staff username, so a valid staff password never accidentally
    // opens a real session here.
    if (!isPresidentUsername(username)) {
        showToast(t('presidentOnly'), 'error');
        return;
    }

    const submitBtn = document.getElementById('login-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = t('signingIn');
    }

    const { data, error } = await client.auth.signInWithPassword({
        email: usernameToStaffEmail(username),
        password
    });

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = t('login');
    }

    if (error) {
        showToast(t('loginFailed'), 'error');
        return;
    }

    applyAuthSession(data.session);
    closeLoginModal();
    showToast(t('welcomePresident'), 'success');
}

async function handleStaffLogout() {
    const client = getSupabase();
    if (client) {
        await client.auth.signOut();
    }
    applyAuthSession(null);
    showToast(t('presidentLogout'), 'info');
}

// ================= PRESIDENT MENU (crown dropdown) =================
// After President login the crown button becomes a dropdown that gathers every
// President action in one place: Applicants List, Special Notes, President
// Info, About Our State and Logout.
function refreshAdminBtn() {
    const btn = document.getElementById('admin-btn');
    if (!btn) return;
    if (isAdmin) {
        btn.innerText = `👑 ${String(currentStaffUsername || '').toUpperCase()} ▾`;
        btn.title = t('presidentMenuTitle');
    } else {
        btn.innerText = '👑';
        btn.title = typeof t === 'function' ? t('presidentLoginShort') : 'President Login';
        btn.setAttribute('aria-expanded', 'false');
    }
}

function togglePresMenu() {
    const menu = document.getElementById('pres-menu');
    if (!menu) return;
    if (menu.classList.contains('open')) closePresMenu();
    else openPresMenu();
}

function openPresMenu() {
    const menu = document.getElementById('pres-menu');
    const btn = document.getElementById('admin-btn');
    if (!menu || !isAdmin) return;
    menu.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
}

function closePresMenu(returnFocus) {
    const menu = document.getElementById('pres-menu');
    const btn = document.getElementById('admin-btn');
    if (!menu) return;
    menu.classList.remove('open');
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        if (returnFocus) btn.focus();
    }
}

function presMenuAction(action) {
    closePresMenu();
    if (!isAdmin) return;
    switch (action) {
        case 'applicants': openApplicantList(); break;
        case 'notes': openSpecialNotesModal(); break;
        case 'info': openPresidentInfoModal(); break;
        case 'state': openStateModal(); break;
        case 'logout': handleStaffLogout(); break;
    }
}

// Phones: the list opens as its full-screen window (same one as "View
// Applicants"). Wider screens already show the list on the page, so jump to it.
function openApplicantList() {
    if (window.matchMedia('(max-width: 600px)').matches) {
        openApplicantsModal();
        return;
    }
    const card = document.querySelector('.applicants-card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('pm-flash');
    void card.offsetWidth;
    card.classList.add('pm-flash');
    setTimeout(() => card.classList.remove('pm-flash'), 1600);
}

// PRESIDENT INFO EDITOR MODAL
function openPresidentInfoModal() {
    if (!isAdmin) return;
    const fill = (inputId, raw) => {
        const v = String(raw || '').trim();
        const input = document.getElementById(inputId);
        if (input) input.value = (v === '-' || v === '...') ? '' : v;
    };
    fill('edit-president', presidentInfoRaw.president);
    fill('edit-alliance', presidentInfoRaw.alliance);
    fill('edit-id', presidentInfoRaw.id);
    document.getElementById('president-info-modal').classList.add('active');
    document.getElementById('edit-president')?.focus();
}

function closePresidentInfoModal() {
    const modal = document.getElementById('president-info-modal');
    if (modal) modal.classList.remove('active');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('pres-menu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target)) closePresMenu();
});

document.addEventListener('keydown', (e) => {
    const menu = document.getElementById('pres-menu');
    if (!menu || !menu.classList.contains('open')) return;
    if (e.key === 'Escape') { closePresMenu(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(menu.querySelectorAll('.pres-menu-item'));
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        items[next].focus();
    }
});

// EXPORT TO EXCEL / CSV
function exportCSV() {
    if (transferList.length === 0) {
        showToast(t('noDataExport'), 'warning');
        return;
    }
    
    const headers = ["From State", "Nickname", "Game ID", "Desired Alliance", "Furnace", "Power", "Hero Power", "Total Hero Power", "Referrer", "Status"];
    if (isAdmin) {
        headers.push("Admin Notes");
    }

    const rows = transferList.map(p => {
        const row = [
            sanitizeCsvField(p.transfer_from_state),
            sanitizeCsvField(p.nickname),
            sanitizeCsvField(p.game_id),
            sanitizeCsvField(p.desired_alliance || '-'),
            sanitizeCsvField(p.furnace_level),
            sanitizeCsvField(p.power),
            sanitizeCsvField(p.hero_power),
            sanitizeCsvField(p.total_hero_power),
            sanitizeCsvField(p.referrer || '-'),
            sanitizeCsvField(p.status)
        ];
        if (isAdmin) {
            row.push(sanitizeCsvField(p.notes || ''));
        }
        return row;
    });
    
    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Transfer_Players_Export.csv";
    a.click();
}

// POPUP NOTIFICATION TOAST
function showToast(message, type = 'info') {
    if (typeof translateDynamicMessage === 'function') message = translateDynamicMessage(message);
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    
    if (type === 'success') toast.style.borderLeftColor = '#22c55e';
    if (type === 'error') toast.style.borderLeftColor = '#ef4444';
    if (type === 'warning') toast.style.borderLeftColor = '#f59e0b';
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
