// ================= SHARED CONFIG & UTILITIES =================
// Single source of truth for anything both script.js (Transfer Portal) and
// res.js (Reservation Portal) rely on: Supabase credentials, the
// President-login rules, and small helper functions. Both pages must load
// this file BEFORE their own script:
//   <script src="common.js"></script>
//   <script src="script.js"></script>   (or res.js)
//
// This exists specifically to prevent the two pages from silently drifting
// apart — e.g. one page changing ALLOWED_ADMIN_USERNAMES or escapeHtml()
// without the other being updated to match.

// ================= SUPABASE PUBLIC CONFIGURATION =================
const SUPABASE_URL = 'https://pwqkpeykjyujhnreleax.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cWtwZXlranl1amhucmVsZWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzgxNDgsImV4cCI6MjA5ODgxNDE0OH0.6u2CKOPHcMtVeA2ph0QWTqgtvs-4BQJpsz6v2kCyOEY';
// =================================================================

// Supabase Auth requires an email address, but this app only wants a plain
// username + password. Both pages share the same email domain so accounts
// can be shared across them — but each page still only grants admin access
// to the usernames listed below. A session logged in from one page as any
// OTHER staff account is simply ignored on a page that doesn't allow it —
// it stays a valid session, it just doesn't unlock admin controls there.
const STAFF_EMAIL_DOMAIN = '@3475-staff.internal';
const ALLOWED_ADMIN_USERNAMES = ['president', 'demon', 'phoenix']; // <-- only these usernames get admin access

function usernameToStaffEmail(username) {
    return username.trim().toLowerCase().replace(/\s+/g, '') + STAFF_EMAIL_DOMAIN;
}

function staffEmailToUsername(email) {
    return (email || '').endsWith(STAFF_EMAIL_DOMAIN)
        ? email.slice(0, -STAFF_EMAIL_DOMAIN.length)
        : email;
}

function isPresidentUsername(username) {
    return !!username && ALLOWED_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
}

// ================= SECURITY: HTML ESCAPING =================
// Any data that comes from a user (nickname, game ID, notes, etc.) MUST go
// through this function before being inserted into innerHTML, so it can't
// be used for stored XSS (e.g. a nickname containing <img onerror=...>).
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ================= SHARED SUPABASE CLIENT =================
let supabaseClient = null;
function getSupabase() {
    if (!supabaseClient) {
        if (typeof window.supabase !== 'undefined') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else {
            console.error("Supabase CDN library failed to load");
        }
    }
    return supabaseClient;
}

// ================= CSV FIELD SANITIZATION =================
// Wraps a value for one CSV cell: escapes double quotes properly, and
// guards against CSV/Formula Injection by prefixing an apostrophe if the
// value starts with =, +, -, or @ (these can be executed as a formula in
// Excel/Sheets).
function sanitizeCsvField(value) {
    let str = String(value ?? '-');
    if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
    }
    str = str.replace(/"/g, '""');
    return `"${str}"`;
}

// ================= CLIPBOARD HELPER =================
function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast(`ID ${text} copied to clipboard!`, "success");
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        // Fallback for browsers/contexts where the Clipboard API is blocked
        // (e.g. non-HTTPS pages or older mobile browsers).
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast(`ID ${text} copied!`, "success");
        } catch (e) {
            showToast("Failed to copy ID automatically.", "error");
        }
        document.body.removeChild(textArea);
    });
}
