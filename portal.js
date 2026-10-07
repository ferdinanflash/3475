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
        navigator.serviceWorker.register('sw.js?v=2026-09-14-1').catch(err => console.warn('Service worker registration failed:', err));
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
