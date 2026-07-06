// ================= SUPABASE PUBLIC CONFIGURATION =================
const SUPABASE_URL = 'https://pwqkpeykjyujhnreleax.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cWtwZXlranl1amhucmVsZWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzgxNDgsImV4cCI6MjA5ODgxNDE0OH0.6u2CKOPHcMtVeA2ph0QWTqgtvs-4BQJpsz6v2kCyOEY'; 
// =================================================================

let supabaseClient = null;
let isAdmin = false;
let transferList = [];

document.addEventListener("DOMContentLoaded", () => {
    loadTransfers();
    setInterval(loadTransfers, 30000); // Polling update otomatis tiap 30 detik
});

function getSupabase() {
    if (!supabaseClient) {
        if (typeof window.supabase !== 'undefined') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else {
            console.error("Supabase CDN failed to load");
        }
    }
    return supabaseClient;
}

// 1. INPUT DATA TRANSFER
async function submitTransfer() {
    const client = getSupabase();
    if (!client) return;

    const state = document.getElementById('in-state').value.trim();
    const nickname = document.getElementById('in-nickname').value.trim();
    const gameId = document.getElementById('in-gameid').value.trim();
    const furnace = document.getElementById('in-furnace').value.trim();
    const power = document.getElementById('in-power').value.trim();
    const heroPower = document.getElementById('in-heropower').value.trim();
    const totalHero = document.getElementById('in-totalhero').value.trim();

    // Validasi basic
    if(!state || !nickname || !gameId || !furnace || !power || !heroPower || !totalHero) {
        showToast("Please fill all input fields!", "warning");
        return;
    }

    const { error } = await client.from('player_transfers').insert({
        transfer_from_state: parseInt(state),
        nickname: nickname,
        game_id: gameId,
        furnace_level: parseInt(furnace),
        power: parseInt(power),
        hero_power: parseInt(heroPower),
        total_hero_power: parseInt(totalHero),
        status: 'Waiting'
    });

    if (!error) {
        showToast("Transfer application sent successfully!", "success");
        // Reset form
        document.querySelectorAll('.form-group input').forEach(input => input.value = "");
        loadTransfers();
    } else {
        showToast("Error submitting: " + error.message, "error");
    }
}

// 2. LOAD DATA DARI DATABASE
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
        renderTable();
    } catch (e) {
        console.error("Database failure:", e);
    }
}

// 3. TAMPILKAN KE TABEL
function renderTable() {
    const tbody = document.getElementById('transfer-tbody');
    const thAction = document.getElementById('th-action');
    if (!tbody) return;

    tbody.innerHTML = "";
    thAction.style.display = isAdmin ? "table-cell" : "none";

    if (transferList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 9 : 8}" style="text-align:center; color:#94a3b8;">No applications found</td></tr>`;
        return;
    }

    transferList.forEach(item => {
        const row = document.createElement('tr');
        
        // Kolom khusus Admin Action
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

        row.innerHTML = `
            ${isAdmin ? actionCell : ''}
            <td>State ${item.transfer_from_state}</td>
            <td><strong>${item.nickname}</strong></td>
            <td>${item.game_id}</td>
            <td>FC ${item.furnace_level}</td>
            <td>${Number(item.power).toLocaleString()}</td>
            <td>${Number(item.hero_power).toLocaleString()}</td>
            <td>${Number(item.total_hero_power).toLocaleString()}</td>
            <td><span class="${badgeClass}">${item.status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

// 4. ACTION ADMIN: UPDATE STATUS (ACCEPT / REJECT)
async function updateStatus(id, newStatus) {
    if(!isAdmin) return;
    const client = getSupabase();
    if (!client) return;

    const { error } = await client.from('player_transfers').update({ status: newStatus }).eq('id', id);
    if (!error) {
        showToast(`Application ${newStatus}!`, "success");
        loadTransfers();
    } else {
        showToast("Update failed.", "error");
    }
}

// 5. ACTION ADMIN: HAPUS REKORD
async function deleteRecord(id) {
    if(!isAdmin || !confirm("Delete this record permanently?")) return;
    const client = getSupabase();
    if (!client) return;

    const { error } = await client.from('player_transfers').delete().eq('id', id);
    if (!error) {
        showToast("Record deleted.", "success");
        loadTransfers();
    }
}

// 6. LOGIN ADMIN
function handleAdminLogin() {
    const btn = document.getElementById('admin-btn');
    const badge = document.getElementById('admin-badge');

    if (!isAdmin) {
        const password = prompt("Enter Password Admin:");
        if (password === "3475") { // Password sama
            isAdmin = true;
            btn.innerText = "Logout Admin";
            badge.style.display = "inline";
            showToast("Welcome Administrator", "success");
        } else {
            showToast("Wrong password!", "error");
            return;
        }
    } else {
        isAdmin = false;
        btn.innerText = "Admin Login";
        badge.style.display = "none";
        showToast("Admin Logout", "info");
    }
    renderTable();
}

// 7. TOAST NOTIFICATION SYSTEM
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
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// 8. EXPORT CSV DATA
function exportCSV() {
    if (transferList.length === 0) {
        showToast("No data to export", "warning");
        return;
    }
    const headers = ["From State", "Nickname", "Game ID", "Furnace", "Power", "Hero Power", "Total Hero Power", "Status"];
    const rows = transferList.map(p => [
        p.transfer_from_state, `"${p.nickname}"`, `"${p.game_id}"`, p.furnace_level, p.power, p.hero_power, p.total_hero_power, p.status
    ]);
    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Transfer_Players_Export.csv";
    link.click();
}
