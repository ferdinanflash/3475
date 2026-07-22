// ================= SUPABASE PUBLIC CONFIGURATION =================
const SUPABASE_URL = 'https://pwqkpeykjyujhnreleax.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cWtwZXlranl1amhucmVsZWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzgxNDgsImV4cCI6MjA5ODgxNDE0OH0.6u2CKOPHcMtVeA2ph0QWTqgtvs-4BQJpsz6v2kCyOEY';
// =================================================================

let supabaseClient = null;
let isAdmin = false;
let transferList = [];
let maxSlots = 35; 
let currentSelectedPlayerId = null;

document.addEventListener("DOMContentLoaded", () => {
    // Cek status persistent login President
    if (localStorage.getItem("isPresident") === "true") {
        isAdmin = true;
        const btn = document.getElementById('admin-btn');
        const badge = document.getElementById('admin-badge');
        if (btn) btn.innerText = "Logout President";
        if (badge) badge.style.display = "inline";
    }

    loadTransfers();
    setupRealtimeChannels();
});

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

// REALTIME STREAM CHANNELS (Sinkronisasi otomatis saat ada perubahan database)
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
        .subscribe();
}

// 1. TAMPILKAN METADATA SISTEM DARI SUPABASE
function displaySystemSettings(settings) {
    const president = settings.president_name || "RARA";
    const alliance = settings.alliance_name || "IDN";
    const idGame = settings.id_game || "0828402093";
    const stateInfoText = settings.state_info || "Welcome to our State! No profile rules assigned yet.";
    
    document.getElementById('val-president').innerText = president;
    document.getElementById('val-alliance').innerText = alliance;
    
    const valId = document.getElementById('val-id');
    valId.innerText = idGame;
    valId.style.cursor = 'pointer';
    valId.title = 'Click to copy ID';
    valId.onclick = () => copyToClipboard(idGame);
    
    document.getElementById('edit-president').value = president;
    document.getElementById('edit-alliance').value = alliance;
    document.getElementById('edit-id').value = idGame;

    document.getElementById('state-info-text').innerText = stateInfoText;
    document.getElementById('state-info-edit').value = stateInfoText;
}

// POPUP MODAL CONTROL SECTIONS
function openStateModal() {
    document.getElementById('state-info-modal').classList.add('active');
}

function closeStateModal() {
    document.getElementById('state-info-modal').classList.remove('active');
}

// 2. ADMIN ACTION: SIMPAN DESKRIPSI ABOUT OUR STATE
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

// 3. ADMIN ACTION: SIMPAN DATA HEADER PRESIDEN SEKALIGUS
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
            .from('system_settings')
            .update({
                president_name: presVal,
                alliance_name: alliVal,
                id_game: idVal
            })
            .eq('id', 1);

        if (!error) {
            showToast("Information saved to 3475 Server", "success");
            loadTransfers();
        } else {
            throw error;
        }
    } catch (err) {
        console.error("Cloud sync save failure:", err);
        showToast("Database failed saving information: " + err.message, "error");
    }
}

// 4. ADMIN ACTION: MENGUBAH SLOT MAXIMUM QUOTA LIMIT
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

// KIRIM FORM DATA PENDAFTAR BARU
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
    
    if (!state || !nickname || !gameId || !alliance || !furnace || !power || !heroPower || !totalHero) {
        showToast("Please fill all input fields!", "warning");
        return;
    }
    
    const { error } = await client.from('player_transfers').insert({
        transfer_from_state: parseInt(state),
        nickname: nickname,
        game_id: gameId,
        desired_alliance: alliance,
        furnace_level: parseInt(furnace),
        power: parseInt(power),
        hero_power: parseInt(heroPower),
        total_hero_power: parseInt(totalHero),
        status: 'Waiting'
    });
    
    if (!error) {
        showToast("Transfer application sent successfully!", "success");
        document.querySelectorAll('.form-group input').forEach(input => {
            if(input.id !== 'in-max-slots' && !input.classList.contains('info-input')) {
                input.value = "";
            }
        });
        loadTransfers();
    } else {
        showToast("Error submitting: " + error.message, "error");
    }
}

// AMBIL SEMUA DATA KONDISIONAL DARI DATABASE
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

// LOGIKA COUNTER & TOGGLE ELEMENT UNTUK VISUAL ADMIN
function updateCounters() {
    const totalApplicants = transferList.length;
    const acceptedCount = transferList.filter(item => item.status === 'Accepted').length;
    
    document.getElementById('count-total').innerText = totalApplicants;
    document.getElementById('count-accepted').innerText = acceptedCount;
    
    const inputs = document.querySelectorAll('.form-group input');
    const submitBtn = document.getElementById('submit-btn');
    const lockMessage = document.getElementById('lock-message');
    const maxSlotsInput = document.getElementById('in-max-slots');
    
    if (maxSlotsInput) {
        maxSlotsInput.disabled = !isAdmin;
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

// RENDER TABEL APPLICANT LIST (TERMASUK DUKUNGAN KOLOM NOTES ADMIN)
function renderTable() {
    const tbody = document.getElementById('transfer-tbody');
    const thAction = document.getElementById('th-action');
    const thNotes = document.getElementById('th-notes');
    const resetBtn = document.getElementById('reset-phase-btn');
    
    if (!tbody) return;
    tbody.innerHTML = "";
    
    // Toggle visibilitas header khusus admin
    if (thAction) thAction.style.display = isAdmin ? "table-cell" : "none";
    if (thNotes) thNotes.style.display = isAdmin ? "table-cell" : "none";
    
    if (resetBtn) {
        resetBtn.style.display = isAdmin ? "inline-block" : "none";
    }
    
    if (transferList.length === 0) {
        const totalCols = isAdmin ? 7 : 5;
        tbody.innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center; color:#94a3b8;">No applications found</td></tr>`;
        return;
    }
    
    transferList.forEach((item, index) => {
        const row = document.createElement('tr');
        let actionCell = "";
        let notesCell = "";
        
        if (isAdmin) {
            actionCell = `
                <td class="admin-actions">
                    ${item.status === 'Waiting' ? `
                        <button style="background:#22c55e;" onclick="updateStatus(${item.id}, 'Accepted')">Accept</button>
                        <button style="background:#ef4444;" onclick="updateStatus(${item.id}, 'Rejected')">Reject</button>
                    ` : `
                        <button style="background:#475569;" onclick="deleteRecord(${item.id})">Delete</button>
                    `}
                </td>
            `;
            
            const noteText = item.notes ? item.notes : '<span style="color:#64748b; font-style:italic;">None</span>';
            notesCell = `<td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem;" title="${item.notes || ''}">${noteText}</td>`;
        }
        
        let badgeClass = `badge badge-${item.status.toLowerCase()}`;
        
        row.innerHTML = `
            <td>
                <button class="btn-view-detail" onclick="showDetailPopup(${index})">👁️</button>
            </td>
            ${isAdmin ? actionCell : ''}
            <td>State ${item.transfer_from_state}</td>
            <td><strong>${item.nickname}</strong></td>
            <td onclick="copyToClipboard('${item.game_id}')" style="cursor:pointer; font-weight:500;" title="Click to copy ID">${item.game_id} 📋</td>
            ${isAdmin ? notesCell : ''}
            <td><span class="${badgeClass}">${item.status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

// SHOW DETAIL POPUP (TERMASUK EDITOR NOTES ADMIN)
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
    document.getElementById('pop-status').innerText = player.status;

    // Menangani section Admin Notes di modal detail
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

// ADMIN ACTION: SIMPAN RECORD NOTE PENDAFTAR KE SUPABASE
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

function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast(`ID ${text} copied to clipboard!`, "success");
    }).catch(err => {
        console.error('Failed to copy text: ', err);
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

// EVENT DETECTOR MENUTUP JENDELA MODAL BILA LUAR POPUP DI-KLIK
window.onclick = function(event) {
    const detailModal = document.getElementById('detail-modal');
    const stateModal = document.getElementById('state-info-modal');
    if (event.target === detailModal) {
        closeDetailModal();
    }
    if (event.target === stateModal) {
        closeStateModal();
    }
}

// ADMIN ACTION: UPDATE STATUS PENDAFTAR
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

// ADMIN ACTION: HAPUS APPLICANT SINGLE RECORD PERMANEN
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

// ADMIN ACTION: MASSIVE DATA CLEANUP RESET TRANSFER PHASE
async function resetTransferPhase() {
    if (!isAdmin) {
        showToast("Unauthorized action!", "error");
        return;
    }
    
    const client = getSupabase();
    if (!client) return;
    
    const confirm1 = confirm("⚠️ WARNING: Are you sure you want to RESET the entire Transfer Phase?\nThis action cannot be undone!");
    if (!confirm1) return;
    
    const confirm2 = prompt("Enter Admin Password to execute massive wipe:");
    if (!confirm2) return;
    
    const { data: isValid, error: authError } = await client.rpc('verify_admin_code', { input_code: confirm2 });
    
    if (authError || !isValid) {
        showToast("Reset canceled. Verification security check failed.", "warning");
        return;
    }
    
    try {
        const { error } = await client
            .from('player_transfers')
            .delete()
            .neq('id', 0);
            
        if (error) throw error;
        showToast("All transfer records have been cleared!", "success");
        await loadTransfers();
    } catch (err) {
        console.error("Wipe compilation sequence error:", err);
        showToast("Reset failed: " + err.message, "error");
    }
}

// ADMIN MANAGEMENT SYSTEM (LOGIN & LOGOUT METHOD)
async function handleAdminLogin() {
    const btn = document.getElementById('admin-btn');
    const badge = document.getElementById('admin-badge');
    if (!btn) return;
    
    if (!isAdmin) {
        const password = prompt("Enter Password President:");
        if (!password) return;

        const client = getSupabase();
        if (!client) return;

        const { data: isValid, error } = await client.rpc('verify_admin_code', { input_code: password });

        if (error) {
            showToast("Verification transaction error: " + error.message, "error");
            return;
        }

        if (isValid) {
            isAdmin = true;
            
            // Simpan status login ke localStorage
            localStorage.setItem("isPresident", "true");
            
            btn.innerText = "Logout President";
            if (badge) badge.style.display = "inline";
            showToast("Welcome President", "success");
        } else {
            showToast("❌ Wrong password!", "error");
            return;
        }
    } else {
        isAdmin = false;
        
        // Hapus status login dari localStorage
        localStorage.removeItem("isPresident");
        
        btn.innerText = "President Login";
        if (badge) badge.style.display = "none";
        showToast("President Logout", "info");
    }
    updateCounters();
    renderTable();
}

// EXPORT TO EXCEL / CSV CONSOLE GENERATOR (TERMASUK NOTES JIKA LOGGED IN AS ADMIN)
function exportCSV() {
    if (transferList.length === 0) {
        showToast("No data to export", "warning");
        return;
    }
    
    const headers = ["From State", "Nickname", "Game ID", "Desired Alliance", "Furnace", "Power", "Hero Power", "Total Hero Power", "Status"];
    if (isAdmin) headers.push("Admin Notes");

    const rows = transferList.map(p => {
        const row = [
            p.transfer_from_state,
            `"${p.nickname}"`,
            `"${p.game_id}"`,
            `"${p.desired_alliance || '-'}"`,
            p.furnace_level,
            p.power,
            p.hero_power,
            p.total_hero_power,
            p.status
        ];
        if (isAdmin) {
            row.push(`"${(p.notes || '').replace(/"/g, '""')}"`);
        }
        return row;
    });
    
    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Transfer_Players_Export.csv";
    link.click();
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
