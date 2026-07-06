// ================= SUPABASE PUBLIC CONFIGURATION =================
const SUPABASE_URL = 'https://pwqkpeykjyujhnreleax.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cWtwZXlranl1amhucmVsZWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzgxNDgsImV4cCI6MjA5ODgxNDE0OH0.6u2CKOPHcMtVeA2ph0QWTqgtvs-4BQJpsz6v2kCyOEY';
// =================================================================

let supabaseClient = null;
let isAdmin = false;
let transferList = [];
let maxSlots = parseInt(localStorage.getItem('max_slots')) || 35;

document.addEventListener("DOMContentLoaded", () => {
    const maxSlotsInput = document.getElementById('in-max-slots');
    if (maxSlotsInput) maxSlotsInput.value = maxSlots;
    
    // Ambil data info keterangan awal
    loadPresidentInfo();
    loadTransfers();
    setInterval(loadTransfers, 30000); // Polling update otomatis setiap 30 detik
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

// 1. TAMPILKAN DATA KETERANGAN DARI LOCALSTORAGE
function loadPresidentInfo() {
    const president = localStorage.getItem('info_president') || "RARA";
    const alliance = localStorage.getItem('info_alliance') || "IDN";
    const idGame = localStorage.getItem('info_id') || "0828402093";
    
    document.getElementById('val-president').innerText = president;
    document.getElementById('val-alliance').innerText = alliance;
    document.getElementById('val-id').innerText = idGame;
    
    document.getElementById('edit-president').value = president;
    document.getElementById('edit-alliance').value = alliance;
    document.getElementById('edit-id').value = idGame;
}

// 2. TOMBOL ACTION ADMIN: SIMPAN KETERANGAN TERBARU SEMUANYA SEKALIGUS
function savePresidentInfo() {
    if (!isAdmin) return;
    
    const presVal = document.getElementById('edit-president').value.trim();
    const alliVal = document.getElementById('edit-alliance').value.trim();
    const idVal = document.getElementById('edit-id').value.trim();
    
    if (!presVal || !alliVal || !idVal) {
        showToast("All info fields must be filled!", "warning");
        return;
    }
    
    localStorage.setItem('info_president', presVal);
    localStorage.setItem('info_alliance', alliVal);
    localStorage.setItem('info_id', idVal);
    
    showToast("Information saved successfully!", "success");
    loadPresidentInfo();
}

// 3. FUNGSI ADMIN: MENGUBAH JUMLAH SLOT MAKSIMAL
function changeMaxSlots(value) {
    if (!isAdmin) return;
    
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue) || parsedValue < 1) {
        showToast("Invalid slots number!", "warning");
        document.getElementById('in-max-slots').value = maxSlots;
        return;
    }
    
    maxSlots = parsedValue;
    localStorage.setItem('max_slots', maxSlots);
    showToast(`Maximum slots updated to ${maxSlots}`, "success");
    updateCounters();
}

// INPUT DATA TRANSFER INTO DATABASE
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
        document.querySelectorAll('.form-group input').forEach(input => input.value = "");
        loadTransfers();
    } else {
        showToast("Error submitting: " + error.message, "error");
    }
}

// FETCH DATA FROM DATABASE
async function loadTransfers() {
    const client = getSupabase();
    if (!client) return;
    
    try {
        const { data, error } = await client
            .from('player_transfers')
            .select('*')
            .order('id', { ascending: false });
            
        if (error) throw error;
        transferList = data || [];
        updateCounters();
        renderTable();
    } catch (e) {
        console.error("Database failure:", e);
    }
}

// UPDATE JUMLAH COUNTER & LOCK LOGIC
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
    
    // LOGIKA TAMPILAN ELEMEN EDIT KETERANGAN INFO
    const infoValues = document.querySelectorAll('.info-value');
    const infoInputs = document.querySelectorAll('.info-input');
    const saveInfoBtn = document.getElementById('save-info-btn');
    
    if (isAdmin) {
        infoValues.forEach(span => span.style.display = 'none');
        infoInputs.forEach(input => input.style.display = 'inline-block');
        if (saveInfoBtn) saveInfoBtn.style.display = 'inline-block';
    } else {
        infoValues.forEach(span => span.style.display = 'inline-block');
        infoInputs.forEach(input => input.style.display = 'none');
        if (saveInfoBtn) saveInfoBtn.style.display = 'none';
    }
    
    // LOGIKA PENGUNCIAN FORM UTAMA JIKA SLOT TERTERIMA >= MAX SLOTS
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

// RENDER DATA TO APPLICANTS LIST TABLE
function renderTable() {
    const tbody = document.getElementById('transfer-tbody');
    const thAction = document.getElementById('th-action');
    const resetBtn = document.getElementById('reset-phase-btn');
    
    if (!tbody) return;
    tbody.innerHTML = "";
    thAction.style.display = isAdmin ? "table-cell" : "none";
    
    if (resetBtn) {
        resetBtn.style.display = isAdmin ? "inline-block" : "none";
    }
    
    if (transferList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 7 : 6}" style="text-align:center; color:#94a3b8;">No applications found</td></tr>`;
        return;
    }
    
    transferList.forEach((item, index) => {
        const row = document.createElement('tr');
        let actionCell = "";
        
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
        }
        
        let badgeClass = `badge badge-${item.status.toLowerCase()}`;
        
        // Diubah: Hanya menampilkan From State, Nickname, Game ID, Power, dan Status + Tombol Mata Detail
        row.innerHTML = `
            <td>
                <button class="btn-view-detail" onclick="showDetailPopup(${index})">👁️</button>
            </td>
            ${isAdmin ? actionCell : ''}
            <td>State ${item.transfer_from_state}</td>
            <td><strong>${item.nickname}</strong></td>
            <td>${item.game_id}</td>
            <td>${Number(item.power).toLocaleString()}</td>
            <td><span class="${badgeClass}">${item.status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

// LOGIKA POPUP MODAL UNTUK MENAMPILKAN SEMUA DATA PENDAFTAR SECARA LENGKAP
function showDetailPopup(index) {
    const player = transferList[index];
    if (!player) return;

    document.getElementById('pop-nickname').innerText = `Detail: ${player.nickname}`;
    document.getElementById('pop-state').innerText = `State ${player.transfer_from_state}`;
    document.getElementById('pop-gameid').innerText = player.game_id;
    document.getElementById('pop-alliance').innerText = player.desired_alliance || '-';
    document.getElementById('pop-furnace').innerText = `FC ${player.furnace_level}`;
    document.getElementById('pop-power').innerText = Number(player.power).toLocaleString();
    document.getElementById('pop-heropower').innerText = Number(player.hero_power).toLocaleString();
    document.getElementById('pop-totalhero').innerText = Number(player.total_hero_power).toLocaleString();
    document.getElementById('pop-status').innerText = player.status;

    document.getElementById('detail-modal').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
}

// Tutup popup jika user klik di luar kotak modal info
window.onclick = function(event) {
    const modal = document.getElementById('detail-modal');
    if (event.target === modal) {
        closeDetailModal();
    }
}

// ACTION ADMIN: UPDATE STATUS
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
        console.error("Gagal memperbarui status:", err);
        showToast("Failed to update status: " + err.message, "error");
    }
}

// ACTION ADMIN: DELETE SINGLE RECORD PERMANENTLY
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

// ACTION ADMIN: RESET TRANSFER PHASE
async function resetTransferPhase() {
    if (!isAdmin) {
        showToast("Unauthorized action!", "error");
        return;
    }
    
    const client = getSupabase();
    if (!client) return;
    
    const confirm1 = confirm("⚠️ WARNING: Are you sure you want to RESET the entire Transfer Phase?\nThis action cannot be undone!");
    if (!confirm1) return;
    
    const confirm2 = prompt("Type '3475' to confirm massive deletion:");
    if (confirm2 !== "3475") {
        showToast("Reset canceled. Verification code incorrect.", "warning");
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
        console.error("Gagal melakukan reset phase:", err);
        showToast("Reset failed: " + err.message, "error");
    }
}

// ADMIN MANAGEMENT: LOGIN & LOGOUT
function handleAdminLogin() {
    const btn = document.getElementById('admin-btn');
    const badge = document.getElementById('admin-badge');
    if (!btn) return;
    
    if (!isAdmin) {
        const password = prompt("Enter Password Admin:");
        if (password === "3475") {
            isAdmin = true;
            btn.innerText = "Logout Admin";
            if (badge) badge.style.display = "inline";
            showToast("Welcome Administrator", "success");
        } else {
            showToast("Wrong password!", "error");
            return;
        }
    } else {
        isAdmin = false;
        btn.innerText = "Admin Login";
        if (badge) badge.style.display = "none";
        showToast("Admin Logout", "info");
    }
    updateCounters();
    renderTable();
}

// TOAST NOTIFICATION SYSTEM
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

// DATA REPORT GENERATOR: EXPORT TO CSV
function exportCSV() {
    if (transferList.length === 0) {
        showToast("No data to export", "warning");
        return;
    }
    
    const headers = ["From State", "Nickname", "Game ID", "Desired Alliance", "Furnace", "Power", "Hero Power", "Total Hero Power", "Status"];
    const rows = transferList.map(p => [
        p.transfer_from_state,
        `"${p.nickname}"`,
        `"${p.game_id}"`,
        `"${p.desired_alliance || '-'}"`,
        p.furnace_level,
        p.power,
        p.hero_power,
        p.total_hero_power,
        p.status
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Transfer_Players_Export.csv";
    link.click();
}
