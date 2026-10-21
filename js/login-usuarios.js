// Tema claro/escuro, login, troca de senha e cadastro de usuários.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// ===== Tema Claro / Escuro =====
function applyThemeIcon(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    btn.title = theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro';
}

function initTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    document.documentElement.style.colorScheme = current;
    applyThemeIcon(current);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try { localStorage.setItem('hr_theme', next); } catch (e) { /* localStorage indisponível */ }
    applyThemeIcon(next);
}

window.addEventListener('DOMContentLoaded', initTheme);

// ===== Funções de UI / Autenticação =====
function lockApp() {
    document.body.classList.add('login-locked');
}

function unlockApp() {
    document.body.classList.remove('login-locked');
}

function showLoginModal(message = '') {
    const screen = document.getElementById('loginScreen');
    if (message) {
        showLoginError(message);
    } else {
        const msg = document.getElementById('loginMessage');
        if (msg) msg.textContent = '';
    }
    if (screen) screen.classList.add('active');
    lockApp();
}

function closeLoginModal() {
    const screen = document.getElementById('loginScreen');
    if (screen) screen.classList.remove('active');
    unlockApp();
}

async function loginUser() {
    const u = document.getElementById('loginUsername')?.value.trim();
    const p = document.getElementById('loginPassword')?.value || '';
    const loginButton = document.getElementById('loginUserButton');
    if (loginButton) loginButton.disabled = true;
    try {
        const user = await authManager.login(u, p);
        if (user.mustChangePassword) {
            showChangePasswordModal(true);
            return;
        }
        // Reload so api/data.php delivers the price tables to the new session.
        location.reload();
    } catch (e) {
        showLoginError(e.message || 'Não foi possível entrar. Confira usuário e senha.');
    } finally {
        if (loginButton) loginButton.disabled = false;
    }
}

function showLoginError(message) {
    const msg = document.getElementById('loginMessage');
    if (msg) msg.textContent = message || 'Não foi possível carregar o login.';
}

function bindLoginControls() {
    const loginButton = document.getElementById('loginUserButton');
    const passwordInput = document.getElementById('loginPassword');

    if (loginButton && !loginButton.dataset.bound) {
        loginButton.dataset.bound = 'true';
        loginButton.addEventListener('click', loginUser);
    }
    if (passwordInput && !passwordInput.dataset.bound) {
        passwordInput.dataset.bound = 'true';
        passwordInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') loginUser();
        });
    }
}

window.addEventListener('error', event => {
    if (document.getElementById('loginScreen')) {
        showLoginError(`Erro ao carregar o sistema: ${event.message || 'verifique os arquivos da pasta js/'}`);
    }
});

window.loginUser = loginUser;
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindLoginControls);
} else {
    bindLoginControls();
}

async function logoutUser() {
    await authManager.logout();
    location.reload();
}

// ===== Alterar senha =====
// forced = first access with a temporary password: the modal cannot be dismissed.
function showChangePasswordModal(forced = false) {
    const modal = document.getElementById('changePasswordModal');
    if (!modal) return;
    modal.dataset.forced = forced ? 'true' : 'false';
    ['currentPasswordInput', 'newPasswordInput', 'confirmPasswordInput'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    const subtitle = document.getElementById('changePasswordSubtitle');
    if (subtitle) {
        subtitle.textContent = forced
            ? 'Primeiro acesso: crie uma senha pessoal para continuar.'
            : 'Informe a senha atual e escolha uma nova.';
    }
    ['changePasswordCloseBtn', 'changePasswordCancelBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.hidden = forced;
    });
    const msg = document.getElementById('changePasswordMessage');
    if (msg) msg.textContent = '';
    modal.style.display = 'flex';
    document.getElementById('currentPasswordInput')?.focus();
}

function closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (!modal || modal.dataset.forced === 'true') return;
    modal.style.display = 'none';
}

async function submitChangePassword() {
    const currentPassword = document.getElementById('currentPasswordInput')?.value || '';
    const newPassword = document.getElementById('newPasswordInput')?.value || '';
    const confirmPassword = document.getElementById('confirmPasswordInput')?.value || '';
    const msg = document.getElementById('changePasswordMessage');
    const setMessage = text => { if (msg) msg.textContent = text; };

    if (!currentPassword || !newPassword) {
        setMessage('Preencha a senha atual e a nova senha.');
        return;
    }
    if (newPassword !== confirmPassword) {
        setMessage('A confirmação não confere com a nova senha.');
        return;
    }
    try {
        await apiRequest('changePassword', { method: 'POST', body: { currentPassword, newPassword } });
        alert('Senha alterada com sucesso.');
        location.reload();
    } catch (e) {
        setMessage(e.message);
    }
}

// ===== Usuários (gestor e administrador) =====
async function showUsersModal() {
    const modal = document.getElementById('usersModal');
    if (!modal) return;
    populateNewUserRoleOptions();
    const msg = document.getElementById('usersMessage');
    if (msg) msg.textContent = '';
    modal.style.display = 'flex';
    await refreshUsersTable();
}

function closeUsersModal() {
    const modal = document.getElementById('usersModal');
    if (modal) modal.style.display = 'none';
}

function populateNewUserRoleOptions() {
    const select = document.getElementById('newUserRole');
    if (!select) return;
    const isAdmin = authManager.getCurrentUserRole() === ROLES.ADMIN;
    const roles = isAdmin ? [ROLES.REP, ROLES.GESTOR, ROLES.ADMIN] : [ROLES.REP];
    select.innerHTML = roles.map(role => `<option value="${role}">${ROLE_LABELS[role]}</option>`).join('');
    select.disabled = roles.length === 1;
}

function canManageUserAccount(user) {
    if (authManager.getCurrentUserRole() === ROLES.ADMIN) return true;
    return authManager.isGestor() && user.role === ROLES.REP;
}

async function refreshUsersTable() {
    const container = document.getElementById('usersTableContainer');
    if (!container) return;
    container.innerHTML = '<div class="empty-state empty-state--compact">Carregando usuários...</div>';
    try {
        const data = await apiRequest('users.list');
        renderUsersTable(data.users || []);
    } catch (e) {
        container.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
}

function renderUsersTable(users) {
    const container = document.getElementById('usersTableContainer');
    if (!container) return;
    if (users.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum usuário cadastrado.</div>';
        return;
    }
    const isAdmin = authManager.getCurrentUserRole() === ROLES.ADMIN;
    const selfId = authManager.getCurrentUserId();

    const rows = users.map(user => {
        const isSelf = user.id === selfId;
        const manageable = canManageUserAccount(user) && !isSelf;
        const lastLogin = user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca';
        const status = user.active
            ? (user.mustChangePassword ? '<span class="chip chip--warn">Senha provisória</span>' : '<span class="chip chip--approved">Ativo</span>')
            : '<span class="chip">Desativado</span>';
        const roleCell = isAdmin && !isSelf
            ? `<select class="input-sm user-role-select" data-change="changeUserRole" data-id="${user.id}" aria-label="Papel">${Object.values(ROLES).map(role =>
                `<option value="${role}" ${role === user.role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`).join('')}</select>`
            : escapeHtml(ROLE_LABELS[user.role] || user.role);
        const actions = manageable
            ? `<button class="btn btn--ghost btn--sm" data-action="toggleUserActive" data-id="${user.id}" data-active="${!user.active}">${user.active ? 'Desativar' : 'Reativar'}</button>
               <button class="btn btn--ghost btn--sm" data-action="resetUserPassword" data-id="${user.id}" data-name="${escapeHtml(user.displayName)}">${icon('key')}Redefinir senha</button>`
            : (isSelf ? '<span class="muted">Você</span>' : '');
        return `
            <tr class="${user.active ? '' : 'user-row--inactive'}">
                <td><strong>${escapeHtml(user.displayName)}</strong></td>
                <td>${escapeHtml(user.username)}</td>
                <td>${roleCell}</td>
                <td>${status}</td>
                <td>${escapeHtml(lastLogin)}</td>
                <td><div class="users-actions">${actions}</div></td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="table users-table">
            <thead>
                <tr><th>Nome</th><th>Login</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th>Ações</th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function submitNewUser(event) {
    event.preventDefault();
    const msg = document.getElementById('usersMessage');
    const body = {
        displayName: document.getElementById('newUserName')?.value.trim() || '',
        username: document.getElementById('newUserLogin')?.value.trim() || '',
        role: document.getElementById('newUserRole')?.value || ROLES.REP,
        password: document.getElementById('newUserPassword')?.value || ''
    };
    try {
        const data = await apiRequest('users.create', { method: 'POST', body });
        event.target.reset();
        populateNewUserRoleOptions();
        if (msg) {
            msg.textContent = `Usuário ${data.user.username} criado. Passe a senha provisória para ele: no primeiro acesso o sistema pedirá uma senha pessoal.`;
            msg.className = 'modal-msg modal-msg--ok';
        }
        await refreshUsersTable();
    } catch (e) {
        if (msg) {
            msg.textContent = e.message;
            msg.className = 'modal-msg';
        }
    }
}

async function toggleUserActive(userId, active) {
    const ok = confirm(active ? 'Reativar este usuário?' : 'Desativar este usuário? Ele não conseguirá mais entrar, mas os pedidos dele continuam no sistema.');
    if (!ok) return;
    try {
        await apiRequest('users.update', { method: 'POST', body: { id: userId, active } });
        await refreshUsersTable();
    } catch (e) {
        alert(e.message);
    }
}

async function resetUserPassword(userId, displayName) {
    const password = prompt(`Nova senha provisória para ${displayName} (mínimo 8 caracteres).\nNo próximo acesso ele terá que criar uma senha pessoal.`);
    if (!password) return;
    try {
        await apiRequest('users.resetPassword', { method: 'POST', body: { id: userId, password } });
        alert('Senha provisória definida. Informe-a ao usuário.');
        await refreshUsersTable();
    } catch (e) {
        alert(e.message);
    }
}

async function changeUserRole(userId, role) {
    try {
        await apiRequest('users.update', { method: 'POST', body: { id: userId, role } });
    } catch (e) {
        alert(e.message);
    }
    await refreshUsersTable();
}

