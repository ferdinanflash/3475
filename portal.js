// Lightweight page bootstrap kept outside index.html.
document.addEventListener("DOMContentLoaded", () => {
    const snowContainer = document.getElementById('snow-container');
    if (snowContainer && !snowContainer.children.length) {
        const flakeCount = 45;
        for (let i = 0; i < flakeCount; i++) {
            const flake = document.createElement('div');
            flake.classList.add('snowflake');
            flake.style.left = Math.random() * 100 + 'vw';
            flake.style.animationDuration = (Math.random() * 6 + 9) + 's';
            flake.style.animationDelay = Math.random() * 12 + 's';
            const size = (Math.random() * 2.5 + 2) + 'px';
            flake.style.width = size;
            flake.style.height = size;
            flake.style.opacity = Math.random() * 0.5 + 0.4;
            snowContainer.appendChild(flake);
        }
    }

    const loginPasswordInput = document.getElementById('input-login-password');
    if (loginPasswordInput) loginPasswordInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitStaffLogin();
    });

    const furnaceEl = document.getElementById('in-furnace');
    if (furnaceEl) {
        furnaceEl.addEventListener('input', () => {
            const badge = document.getElementById('furnace-badge');
            if (badge) setFurnaceBadge(badge, furnaceEl.value);
            updateFurnaceLabel(furnaceEl.value);
            furnaceEl.dataset.touched = '1';
        });
    }

    // Inline errors disappear as soon as the field is edited.
    const formFields = document.getElementById('transfer-form-fields');
    if (formFields) {
        formFields.addEventListener('input', e => { if (e.target && e.target.id) clearFieldError(e.target.id); });
    }
    // Power fields: live thousands separators.
    ['in-power', 'in-heropower', 'in-totalhero'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => formatThousandsInput(el));
    });
    // Errors were written in the old language, so drop them on language change.
    const langSel = document.getElementById('language-select');
    if (langSel) langSel.addEventListener('change', clearAllFieldErrors);

    // Applicant search + status filter.
    const search = document.getElementById('applicant-search');
    if (search) search.addEventListener('input', () => { applicantFilter.q = search.value; renderTable(); });
    document.querySelectorAll('#status-filter .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            applicantFilter.status = chip.dataset.status;
            document.querySelectorAll('#status-filter .filter-chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
            renderTable();
        });
    });
});

function handleSubmitClick() {
    // Validation (including "furnace not touched") is shown inline by submitTransfer().
    submitTransfer();
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js?v=2026-10-12-4').catch(err => console.warn('Service worker registration failed:', err));
    });
}

window.addEventListener('message', event => {
    if (event.data?.type === 'OPEN_APPLICATION_STATUS' && typeof openStatusModal === 'function') {
        openStatusModal();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('application_id') && typeof openStatusModal === 'function') {
        openStatusModal();
        try { history.replaceState({}, document.title, window.location.pathname + window.location.hash); } catch (_) {}
    }
});


// ================= MODAL ACCESSIBILITY =================
// Dialog semantics, focus trap, Esc to close and focus return for every .modal-overlay.
// Purely additive: the existing open/close functions keep toggling the `active` class.
(function () {
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const openers = new Map();
    const isVisible = el => el.getClientRects().length > 0;
    const focusables = root => Array.from(root.querySelectorAll(FOCUSABLE)).filter(isVisible);
    const activeModals = () => Array.from(document.querySelectorAll('.modal-overlay.active'));

    function onOpen(modal, content) {
        if (openers.has(modal)) return;
        openers.set(modal, document.activeElement);
        setTimeout(() => {
            if (content.contains(document.activeElement)) return; // e.g. login already focused its input
            const first = focusables(content).find(el => !el.classList.contains('modal-close')) || focusables(content)[0] || content;
            first.focus({ preventScroll: true });
        }, 30);
    }
    function onClose(modal) {
        if (!openers.has(modal)) return;
        const opener = openers.get(modal);
        openers.delete(modal);
        if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    }

    function init() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            const content = modal.querySelector('.modal-content');
            if (!content) return;
            content.setAttribute('role', 'dialog');
            content.setAttribute('aria-modal', 'true');
            content.tabIndex = -1;
            const heading = content.querySelector('.modal-header h4');
            if (heading) {
                if (!heading.id) heading.id = (modal.id || 'modal') + '-title';
                content.setAttribute('aria-labelledby', heading.id);
            }
            new MutationObserver(() => {
                if (modal.classList.contains('active')) onOpen(modal, content); else onClose(modal);
            }).observe(modal, { attributes: true, attributeFilter: ['class'] });
        });
    }

    document.addEventListener('keydown', e => {
        const open = activeModals();
        if (!open.length) return;
        const modal = open[open.length - 1];
        if (e.key === 'Escape') {
            if (e.target.closest && e.target.closest('#pres-menu')) return;
            const close = modal.querySelector('.modal-close');
            if (close) { e.preventDefault(); close.click(); }
            return;
        }
        if (e.key === 'Tab') {
            const items = focusables(modal.querySelector('.modal-content'));
            if (!items.length) { e.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
        }
    });

    // The status modal had no click-outside handler; the others are handled in script.js.
    document.addEventListener('click', e => {
        if (e.target && e.target.id === 'status-modal') {
            const close = e.target.querySelector('.modal-close');
            if (close) close.click();
        }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
