// ================= SHARED CODE LIVES IN common.js =================
// Supabase credentials, the President-login rules (STAFF_EMAIL_DOMAIN,
// ALLOWED_ADMIN_USERNAMES, usernameToStaffEmail, staffEmailToUsername,
// isPresidentUsername), escapeHtml, sanitizeCsvField, getSupabase, and
// copyToClipboard are all defined once in common.js and shared with res.js.
// Make sure index.html loads common.js BEFORE this file.

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

    const btn = document.getElementById('admin-btn');
    const badge = document.getElementById('admin-badge');
    const specialBtn = document.getElementById('special-notes-btn');

    if (isAdmin) {
        if (btn) btn.innerText = `Logout (${currentStaffUsername.toUpperCase()})`;
        if (badge) badge.style.display = "inline";
        if (specialBtn) specialBtn.style.display = "inline-block";
    } else {
        if (btn) btn.innerText = "President Login";
        if (badge) badge.style.display = "none";
        if (specialBtn) specialBtn.style.display = "none";
    }

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
    const stateInfoText = settings.state_info || "Welcome to our State! No profile rules assigned yet.";
    document.getElementById('state-info-text').innerText = stateInfoText;
    document.getElementById('state-info-edit').value = stateInfoText;
}

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
function applyPresidentDisplay(president, alliance, idGame) {
    document.getElementById('val-president').innerText = president;
    document.getElementById('val-alliance').innerText = alliance;

    const valId = document.getElementById('val-id');
    valId.innerText = idGame;
    valId.style.cursor = 'pointer';
    valId.title = 'Click to copy ID';
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
            showToast("Special Notes saved to server!", "success");
            closeSpecialNotesModal();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed saving special notes:", err);
        showToast("Error saving special notes: " + err.message, "error");
    }
}

// 2. ADMIN ACTION: SAVE THE ABOUT OUR STATE DESCRIPTION
async function saveStateInfo() {
    if (!isAdmin) return;
    
    const textValue = document.getElementById('state-info-edit').value;
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('system_settings')
            .update({ state_info: textValue })
            .eq('id', 1);

        if (!error) {
            showToast("State profile information updated live!", "success");
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Cloud failure update metadata:", err);
        showToast("Failed saving state info text: " + err.message, "error");
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
        showToast("All info fields must be filled!", "warning");
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

            showToast("Information saved to 3475 Server", "success");
            loadFooterInfo();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Cloud sync save failure:", err);
        showToast("Database failed saving information: " + err.message, "error");
    }
}

// 4. ADMIN ACTION: CHANGE THE MAXIMUM SLOT QUOTA LIMIT
async function changeMaxSlots(value) {
    if (!isAdmin) return;
    
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue) || parsedValue < 1) {
        showToast("Invalid slots number!", "warning");
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
            showToast(`Maximum slots updated to ${maxSlots}`, "success");
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed adjusting system limits:", err);
        showToast("Failed to update max slots on server: " + err.message, "error");
        document.getElementById('in-max-slots').value = maxSlots;
    }
}

// SUBMIT NEW APPLICANT FORM DATA
async function submitTransfer() {
    const client = getSupabase();
    if (!client) return;
    
    const acceptedCount = transferList.filter(item => item.status === 'Accepted').length;
    if (acceptedCount >= maxSlots) {
        showToast("Registration is closed. Quota full!", "error");
        return;
    }
    
    const state = document.getElementById('in-state').value.trim();
    const nickname = document.getElementById('in-nickname').value.trim();
    const gameId = document.getElementById('in-gameid').value.trim();
    const alliance = document.getElementById('in-alliance').value.trim();
    const furnace = document.getElementById('in-furnace').value.trim();
    const power = document.getElementById('in-power').value.trim();
    const heroPower = document.getElementById('in-heropower').value.trim();
    const totalHero = document.getElementById('in-totalhero').value.trim();
    const referrer = document.getElementById('in-referrer').value.trim();
    
    if (!state || !nickname || !gameId || !alliance || !furnace || !power || !heroPower || !totalHero) {
        showToast("Please fill all input fields!", "warning");
        return;
    }

    if (!/^\d+$/.test(gameId)) {
        showToast("Game ID must contain numbers only!", "warning");
        return;
    }

    // Parse all numeric fields up front and reject the submission if any of
    // them are not valid non-negative whole numbers, instead of letting
    // NaN silently reach the database.
    const stateNum = parseInt(state, 10);
    const furnaceNum = parseInt(furnace, 10);
    const powerNum = parseInt(power, 10);
    const heroPowerNum = parseInt(heroPower, 10);
    const totalHeroNum = parseInt(totalHero, 10);
    const numericFields = { stateNum, furnaceNum, powerNum, heroPowerNum, totalHeroNum };

    const hasInvalidNumber = Object.values(numericFields).some(n => !Number.isFinite(n) || n < 0);
    if (hasInvalidNumber) {
        showToast("Please enter valid, non-negative numbers for State, Furnace, Power, and Hero Power fields!", "warning");
        return;
    }

    // Furnace Level is a controlled 1-10 dropdown in the UI, but re-check the
    // range here too in case someone bypasses the dropdown via devtools.
    if (furnaceNum < 1 || furnaceNum > 10) {
        showToast("Furnace Level must be between 1 and 10!", "warning");
        return;
    }
    
    const { error } = await client.from('player_transfers').insert({
        transfer_from_state: stateNum,
        nickname: nickname,
        game_id: gameId,
        desired_alliance: alliance,
        furnace_level: furnaceNum,
        power: powerNum,
        hero_power: heroPowerNum,
        total_hero_power: totalHeroNum,
        referrer: referrer || null,
        status: 'Waiting'
    });
    
    if (!error) {
        showToast("Transfer application sent successfully!", "success");
        document.querySelectorAll('#transfer-form-fields input, #transfer-form-fields select').forEach(input => {
            if(input.id !== 'in-max-slots' && !input.classList.contains('info-input')) {
                input.value = "";
            }
        });
        loadTransfers();
    } else {
        showToast("Error submitting: " + error.message, "error");
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
    
    // Scoped to #transfer-form-fields only — NOT a page-wide '.form-group'
    // selector, which would also grab (and disable) unrelated inputs like
    // the President Login modal's username/password fields whenever the
    // registration quota is full.
    const inputs = document.querySelectorAll('#transfer-form-fields input, #transfer-form-fields select');
    const submitBtn = document.getElementById('submit-btn');
    const lockMessage = document.getElementById('lock-message');
    const maxSlotsInput = document.getElementById('in-max-slots');
    const specialNotesBtn = document.getElementById('special-notes-btn');
    
    if (maxSlotsInput) {
        maxSlotsInput.disabled = !isAdmin;
    }

    if (specialNotesBtn) {
        specialNotesBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }
    
    const infoValues = document.querySelectorAll('.info-value');
    const infoInputs = document.querySelectorAll('.info-input');
    const saveInfoBtn = document.getElementById('save-info-btn');
    
    if (isAdmin) {
        infoValues.forEach(span => span.style.display = 'none');
        infoInputs.forEach(input => input.style.display = 'inline-block');
        if (saveInfoBtn) saveInfoBtn.style.display = 'inline-block';
        
        document.getElementById('state-info-text').style.display = 'none';
        document.getElementById('state-info-edit').style.display = 'block';
        document.getElementById('save-state-btn').style.display = 'block';
    } else {
        infoValues.forEach(span => span.style.display = 'inline-block');
        infoInputs.forEach(input => input.style.display = 'none');
        if (saveInfoBtn) saveInfoBtn.style.display = 'none';
        
        document.getElementById('state-info-text').style.display = 'block';
        document.getElementById('state-info-edit').style.display = 'none';
        document.getElementById('save-state-btn').style.display = 'none';
    }
    
    if (acceptedCount >= maxSlots) {
        inputs.forEach(input => {
            if (input.id !== 'in-max-slots' && !input.classList.contains('info-input')) input.disabled = true;
        });
        if (submitBtn) submitBtn.disabled = true;
        if (lockMessage) lockMessage.style.display = "block";
    } else {
        inputs.forEach(input => {
            if (input.id !== 'in-max-slots' && !input.classList.contains('info-input')) input.disabled = false;
        });
        if (submitBtn) submitBtn.disabled = false;
        if (lockMessage) lockMessage.style.display = "none";
    }
}

// RENDER APPLICANT LIST TABLE (INCLUDES ADMIN NOTES & BLACKLIST COLUMNS)
function renderTable() {
    const tbody = document.getElementById('transfer-tbody');
    const thAction = document.getElementById('th-action');
    const thNotes = document.getElementById('th-notes');
    const thBlacklist = document.getElementById('th-blacklist');
    const resetBtn = document.getElementById('reset-phase-btn');
    
    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (thAction) thAction.style.display = isAdmin ? "table-cell" : "none";
    if (thNotes) thNotes.style.display = isAdmin ? "table-cell" : "none";
    if (thBlacklist) thBlacklist.style.display = isAdmin ? "table-cell" : "none";
    
    if (resetBtn) {
        resetBtn.style.display = isAdmin ? "inline-block" : "none";
    }
    
    if (transferList.length === 0) {
        const totalCols = isAdmin ? 8 : 5;
        tbody.innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center; color:#94a3b8;">No applications found</td></tr>`;
        return;
    }
    
    transferList.forEach((item, index) => {
        const row = document.createElement('tr');
        let actionCell = "";
        let notesCell = "";
        let blacklistCell = "";
        
        if (isAdmin) {
            actionCell = `
                <td class="admin-actions">
                    ${item.status === 'Waiting' ? `
                        <button class="btn-accept" onclick="updateStatus(${item.id}, 'Accepted')">Accept</button>
                        <button class="btn-reject" onclick="updateStatus(${item.id}, 'Rejected')">Reject</button>
                    ` : `
                        <button class="btn-delete" onclick="deleteRecord(${item.id})">Delete</button>
                    `}
                </td>
            `;
            
            const noteText = item.notes ? escapeHtml(item.notes) : '<span style="color:#64748b; font-style:italic;">None</span>';
            notesCell = `<td class="admin-extra-col" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem;" title="${escapeHtml(item.notes || '')}">${noteText}</td>`;
            
            const blacklistText = item.blacklist_notes ? escapeHtml(item.blacklist_notes) : '<span style="color:#64748b; font-style:italic;">None</span>';
            blacklistCell = `<td class="admin-extra-col" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; color: #ef4444;" title="${escapeHtml(item.blacklist_notes || '')}">${blacklistText}</td>`;
        }
        
        let badgeClass = `badge badge-${item.status.toLowerCase()}`;
        
        row.innerHTML = `
            <td class="col-detail">
                <button class="btn-view-detail" onclick="showDetailPopup(${index})">👁️</button>
            </td>
            ${isAdmin ? actionCell : ''}
            <td class="hide-mobile">State ${escapeHtml(item.transfer_from_state)}</td>
            <td><strong>${escapeHtml(item.nickname)}</strong></td>
            <td class="game-id-cell" onclick="copyToClipboard(transferList[${index}].game_id)" style="cursor:pointer;" title="Click to copy ID">${escapeHtml(item.game_id)} 📋</td>
            ${isAdmin ? notesCell : ''}
            ${isAdmin ? blacklistCell : ''}
            <td style="text-align: center;"><span class="${badgeClass}">${escapeHtml(item.status)}</span></td>
        `;
        tbody.appendChild(row);
    });
}

// SHOW DETAIL POPUP (INCLUDES ADMIN NOTES & BLACKLIST EDITOR)
function showDetailPopup(index) {
    const player = transferList[index];
    if (!player) return;

    currentSelectedPlayerId = player.id;

    document.getElementById('pop-nickname').innerText = `Detail: ${player.nickname}`;
    document.getElementById('pop-state').innerText = `State ${player.transfer_from_state}`;
    
    const popGameId = document.getElementById('pop-gameid');
    popGameId.innerText = `${player.game_id} 📋`;
    popGameId.style.cursor = 'pointer';
    popGameId.title = 'Click to copy ID';
    popGameId.onclick = () => copyToClipboard(player.game_id);

    document.getElementById('pop-alliance').innerText = player.desired_alliance || '-';
    document.getElementById('pop-furnace').innerText = `FC ${player.furnace_level}`;
    document.getElementById('pop-power').innerText = Number(player.power).toLocaleString();
    document.getElementById('pop-heropower').innerText = Number(player.hero_power).toLocaleString();
    document.getElementById('pop-totalhero').innerText = Number(player.total_hero_power).toLocaleString();
    document.getElementById('pop-referrer').innerText = player.referrer || '-';
    document.getElementById('pop-status').innerText = player.status;

    const notesContainer = document.getElementById('pop-notes-container');
    const notesInput = document.getElementById('pop-notes-input');
    const saveNoteBtn = document.getElementById('pop-notes-save-btn');
    
    const blacklistContainer = document.getElementById('pop-blacklist-container');
    const blacklistInput = document.getElementById('pop-blacklist-input');
    const saveBlacklistBtn = document.getElementById('pop-blacklist-save-btn');

    if (isAdmin) {
        notesContainer.style.display = 'flex';
        notesInput.value = player.notes || '';
        saveNoteBtn.onclick = () => savePlayerNote(player.id);
        
        if (blacklistContainer) {
            blacklistContainer.style.display = 'flex';
            blacklistInput.value = player.blacklist_notes || '';
            saveBlacklistBtn.onclick = () => saveBlacklistNote(player.id);
        }
    } else {
        notesContainer.style.display = 'none';
        if (blacklistContainer) blacklistContainer.style.display = 'none';
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
            showToast("Admin note saved successfully!", "success");
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed to save note:", err);
        showToast("Error saving note: " + err.message, "error");
    }
}

// ADMIN ACTION: SAVE APPLICANT BLACKLIST RECORD TO SUPABASE
async function saveBlacklistNote(playerId) {
    if (!isAdmin || !playerId) return;

    const blacklistText = document.getElementById('pop-blacklist-input').value;
    const client = getSupabase();
    if (!client) return;

    try {
        const { error } = await client
            .from('player_transfers')
            .update({ blacklist_notes: blacklistText })
            .eq('id', playerId);

        if (!error) {
            showToast("Blacklist note saved successfully!", "success");
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Failed to save blacklist note:", err);
        showToast("Error saving blacklist note: " + err.message, "error");
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
        showToast("Unauthorized action!", "error");
        return;
    }
    
    const client = getSupabase();
    if (!client) return;
    
    if (newStatus === 'Accepted') {
        const acceptedCount = transferList.filter(item => item.status === 'Accepted').length;
        if (acceptedCount >= maxSlots) {
            showToast(`Cannot accept! Quota limit (${maxSlots}) has been reached.`, "error");
            return;
        }
    }
    
    const actionText = newStatus.toLowerCase();
    if (!confirm(`Are you sure you want to ${actionText} this player transfer application?`)) {
        return;
    }
    
    try {
        const { error } = await client
            .from('player_transfers')
            .update({ status: newStatus })
            .eq('id', id);
            
        if (error) throw error;
        showToast(`Application ${newStatus} successfully!`, "success");
        await loadTransfers();
    } catch (err) {
        console.error("Failed altering column parameters:", err);
        showToast("Failed to update status: " + err.message, "error");
    }
}

// ADMIN ACTION: PERMANENTLY DELETE A SINGLE APPLICANT RECORD
async function deleteRecord(id) {
    if (!isAdmin) return;
    if (!confirm("Delete this record permanently?")) return;
    
    const client = getSupabase();
    if (!client) return;
    
    try {
        const { error } = await client.from('player_transfers').delete().eq('id', id);
        if (error) throw error;
        showToast("Record deleted successfully.", "success");
        await loadTransfers();
    } catch (err) {
        showToast("Delete failed: " + err.message, "error");
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

    if (!confirm("⚠️ WARNING: Are you sure you want to RESET the entire Transfer Phase?\nThis action cannot be undone!")) {
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
        showToast("Please enter the admin password!", "warning");
        return;
    }

    const client = getSupabase();
    if (!client) return;

    const confirmBtn = document.getElementById('reset-password-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerText = 'Verifying...';
    }

    try {
        const { data: isValid, error: authError } = await client.rpc('verify_admin_code', { input_code: password });

        if (authError || !isValid) {
            showToast("Reset canceled. Verification security check failed.", "warning");
            return;
        }

        const { error } = await client
            .from('player_transfers')
            .delete()
            .neq('id', 0);

        if (error) throw error;

        showToast("All transfer records have been cleared!", "success");
        closeResetPasswordModal();
        await loadTransfers();
    } catch (err) {
        console.error("Wipe compilation sequence error:", err);
        showToast("Reset failed: " + err.message, "error");
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = '⚠️ Confirm Wipe';
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
        handleStaffLogout();
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
        showToast("Please enter both username and password!", "warning");
        return;
    }

    // This page is President-only — don't even attempt a sign-in for any
    // other staff username, so a valid staff password never accidentally
    // opens a real session here.
    if (!isPresidentUsername(username)) {
        showToast("This page is for the President account only.", "error");
        return;
    }

    const submitBtn = document.getElementById('login-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Signing in...';
    }

    const { data, error } = await client.auth.signInWithPassword({
        email: usernameToStaffEmail(username),
        password
    });

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = '🔐 Login';
    }

    if (error) {
        showToast("Login failed: incorrect username or password", "error");
        return;
    }

    applyAuthSession(data.session);
    closeLoginModal();
    showToast("Welcome back, President!", "success");
}

async function handleStaffLogout() {
    const client = getSupabase();
    if (client) {
        await client.auth.signOut();
    }
    applyAuthSession(null);
    showToast("President Logout", "info");
}

// EXPORT TO EXCEL / CSV
function exportCSV() {
    if (transferList.length === 0) {
        showToast("No data to export", "warning");
        return;
    }
    
    const headers = ["From State", "Nickname", "Game ID", "Desired Alliance", "Furnace", "Power", "Hero Power", "Total Hero Power", "Referrer", "Status"];
    if (isAdmin) {
        headers.push("Admin Notes");
        headers.push("Blacklist Notes");
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
            row.push(sanitizeCsvField(p.blacklist_notes || ''));
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
