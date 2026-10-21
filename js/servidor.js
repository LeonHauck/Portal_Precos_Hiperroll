// Conversa com o servidor: status do formulário, apiRequest(), login/sessão e os caches de pedidos e lixeira.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// ========== STATUS DO PEDIDO EM EDIÇÃO ==========
// Only what the order form shows while it is being filled in: a new or loaded order in the form is
// always a draft. The real status of each order and its timeline live on the server (see
// showStatusHistory), so nothing is kept in this browser.
const statusManager = {
    currentStatus: 'rascunho',

    init() {
        // Left behind by versions that kept the status and its history in the browser.
        try {
            localStorage.removeItem('orderStatus');
            localStorage.removeItem('orderStatusHistory');
        } catch (e) {}
        this.updateUI();
    },

    setStatus(newStatus) {
        this.currentStatus = newStatus;
        this.updateUI();
    },

    updateUI() {
        const chip = document.getElementById('orderStatusChip');
        if (chip) chip.innerHTML = renderStatusChip(this.currentStatus);
    }
};
// ==========================================

// ========== CLIENTE DA API (servidor PHP) ==========
const API_BASE = 'api/index.php';
let apiCsrfToken = '';

// Every call goes through here: sends the session cookie, the CSRF token on writes,
// and turns server errors into Error objects with the server's message.
async function apiRequest(action, { method = 'GET', body = null, query = null, retryOnCsrf = true } = {}) {
    const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
        options.headers['Content-Type'] = 'application/json';
        options.headers['X-CSRF-Token'] = apiCsrfToken;
        options.body = JSON.stringify(body || {});
    }

    const params = new URLSearchParams({ action, ...(query || {}) });
    let response;
    try {
        response = await fetch(`${API_BASE}?${params}`, options);
    } catch (networkError) {
        throw new Error('Não foi possível falar com o servidor. Verifique sua conexão (o portal precisa estar publicado ou rodando com php -S).');
    }

    let data = null;
    try {
        data = await response.json();
    } catch (parseError) {
        data = null;
    }

    if (response.status === 419 && retryOnCsrf) {
        await authManager.refreshSession();
        return apiRequest(action, { method, body, query, retryOnCsrf: false });
    }
    if (response.status === 401 && action !== 'login') {
        authManager.handleSessionExpired();
    }
    if (!response.ok || !data || data.success === false) {
        const error = new Error((data && data.message) || `Erro ${response.status} ao comunicar com o servidor.`);
        error.status = response.status;
        error.code = (data && data.code) || null;
        throw error;
    }
    if (data.csrfToken) apiCsrfToken = data.csrfToken;
    return data;
}

// ========== AUTENTICAÇÃO (sessão no servidor) ==========
const ROLES = Object.freeze({ GESTOR: 'gestor', ADMIN: 'admin', REP: 'representante' });
const ROLE_LABELS = Object.freeze({ gestor: 'Gestor', admin: 'Administrador', representante: 'Representante' });

// Roles here only decide what the screen shows; the server re-checks every action.
const authManager = {
    profile: null,
    currentUser: null,
    currentRole: null,

    normalizeUsername(username) {
        return String(username || '').trim().toLowerCase();
    },

    setProfile(user) {
        this.profile = user || null;
        this.currentUser = user ? user.username : null;
        this.currentRole = user ? user.role : null;
    },

    async refreshSession() {
        const data = await apiRequest('session');
        this.setProfile(data.user);
        return data.user;
    },

    async init() {
        try {
            await this.refreshSession();
        } finally {
            this.updateUI();
        }
    },

    async login(username, password) {
        if (!username || !password) throw new Error('Informe usuário e senha.');
        const data = await apiRequest('login', { method: 'POST', body: { username, password } });
        this.setProfile(data.user);
        this.updateUI();
        return data.user;
    },

    async logout() {
        try {
            await apiRequest('logout', { method: 'POST' });
        } catch (e) {
            console.warn('Falha ao encerrar a sessão no servidor:', e);
        }
        this.setProfile(null);
        this.updateUI();
    },

    handleSessionExpired() {
        if (!this.currentUser) return;
        this.setProfile(null);
        this.updateUI();
        showLoginModal('Sua sessão expirou. Faça login novamente.');
    },

    getCurrentUser() {
        return this.currentUser;
    },

    getCurrentUserId() {
        return this.profile ? this.profile.id : null;
    },

    getDisplayName() {
        return this.profile ? this.profile.displayName : '';
    },

    getCurrentUserRole() {
        return String(this.currentRole || '').trim().toLowerCase();
    },

    isGestor() {
        return this.getCurrentUserRole() === ROLES.GESTOR;
    },

    canManageUsers() {
        return [ROLES.GESTOR, ROLES.ADMIN].includes(this.getCurrentUserRole());
    },

    // Gestor edits the price table; admin can import it and look, read-only.
    canViewPricingAdmin() {
        return [ROLES.GESTOR, ROLES.ADMIN].includes(this.getCurrentUserRole());
    },

    mustChangePassword() {
        return Boolean(this.profile && this.profile.mustChangePassword);
    },

    updateUI() {
        const loginBtn = document.getElementById('loginBtn');
        const currentUserDiv = document.getElementById('currentUser');
        const currentUserName = document.getElementById('currentUserName');
        const supervisorBtn = document.getElementById('supervisorBtn');
        const usersBtn = document.getElementById('usersBtn');
        const currentUserRole = document.getElementById('currentUserRole');
        const pricingTabBtn = document.getElementById('btn-tab-pricing');
        if (pricingTabBtn) pricingTabBtn.hidden = !(this.currentUser && this.canViewPricingAdmin());

        if (!loginBtn || !currentUserDiv || !currentUserName || !supervisorBtn) return;

        const loggedIn = Boolean(this.currentUser);
        loginBtn.hidden = loggedIn;
        currentUserDiv.hidden = !loggedIn;
        currentUserName.textContent = loggedIn ? (this.getDisplayName() || this.currentUser) : '--';
        if (currentUserRole) currentUserRole.textContent = loggedIn ? (ROLE_LABELS[this.getCurrentUserRole()] || this.getCurrentUserRole()) : '';
        supervisorBtn.hidden = !(loggedIn && this.isGestor());
        if (usersBtn) usersBtn.hidden = !(loggedIn && this.canManageUsers());
        try {
            if (typeof renderDraftsPanel === 'function') renderDraftsPanel();
        } catch (e) {}
        try {
            if (typeof renderHistoryTab === 'function') renderHistoryTab();
        } catch (e) {}
        try {
            if (typeof updateSupervisorPanel === 'function') updateSupervisorPanel();
        } catch (e) {}
    }
};

const orderManager = {
    meta: {
        createdBy: null,
        createdAt: null
    },

    init() {
        const savedMeta = localStorage.getItem('orderMeta');
        if (savedMeta) {
            try {
                this.meta = JSON.parse(savedMeta);
            } catch (e) {
                this.meta = { createdBy: null, createdAt: null };
            }
        }
    },

    save() {
        localStorage.setItem('orderMeta', JSON.stringify(this.meta));
    },

    ensureCreator(username) {
        if (!this.meta.createdBy && username) {
            this.meta.createdBy = username;
            this.meta.createdAt = new Date().toISOString();
            this.save();
        }
    },

    getCreatorLabel() {
        return this.meta.createdBy || '---';
    },

    getCreatedAtLabel() {
        return this.meta.createdAt ? new Date(this.meta.createdAt).toLocaleString('pt-BR') : '---';
    }
};

// ========== PEDIDOS (cache local + gravação no servidor) ==========
// Screens read from these in-memory caches synchronously; every change goes to the
// API first and the cache is updated with what the server actually saved.
const orderSubmissionManager = {
    submissions: {},

    setAll(orders) {
        this.submissions = {};
        (orders || []).forEach(order => {
            this.submissions[order.id] = order;
        });
    },

    upsert(order) {
        if (!order) return;
        this.submissions[order.id] = order;
        delete deletedSubmissionsManager.deleted[order.id];
    },

    async saveDraft(draftId, order) {
        const data = await apiRequest('orders.saveDraft', { method: 'POST', body: { id: draftId, order } });
        this.upsert(data.order);
        hiperrollOrderNumberManager.setPreview(data.nextNumber);
        return data.order;
    },

    async submitOrder(draftId, order) {
        const data = await apiRequest('orders.submit', { method: 'POST', body: { id: draftId, order } });
        this.upsert(data.order);
        hiperrollOrderNumberManager.setPreview(data.nextNumber);
        return data.order;
    },

    async approve(submissionIds, supervisorNote = '') {
        const ids = Array.isArray(submissionIds) ? submissionIds : [submissionIds];
        const data = await apiRequest('orders.approve', { method: 'POST', body: { ids, note: supervisorNote } });
        await loadServerData();
        return data;
    },

    async reject(submissionIds, reason, supervisorNote = '') {
        const ids = Array.isArray(submissionIds) ? submissionIds : [submissionIds];
        const data = await apiRequest('orders.reject', { method: 'POST', body: { ids, reason, note: supervisorNote } });
        await loadServerData();
        return data;
    },

    async setSupervisorNote(submissionId, note) {
        const data = await apiRequest('orders.note', { method: 'POST', body: { id: submissionId, note } });
        await loadServerData();
        return data.order;
    },

    async moveToTrash(submissionIds) {
        const ids = Array.isArray(submissionIds) ? submissionIds : [submissionIds];
        const data = await apiRequest('orders.trash', { method: 'POST', body: { ids } });
        await loadServerData();
        return data.trashed;
    },

    async registerBilling(submissionId, billedItemsMap, invoiceDataUrl, invoiceName) {
        const invoice = invoiceDataUrl ? { dataUrl: invoiceDataUrl, name: invoiceName } : null;
        const data = await apiRequest('orders.billing', { method: 'POST', body: { id: submissionId, billed: billedItemsMap, invoice } });
        this.upsert(data.order);
        return data.order;
    },

    getAll() {
        return Object.values(this.submissions);
    },

    getPending() {
        return this.getAll().filter(s => s.status === 'analise');
    },

    getDrafts() {
        return this.getAll().filter(s => s.status === 'rascunho');
    },

    getOwnSubmissions() {
        const userId = authManager.getCurrentUserId();
        return this.getAll().filter(s => s.ownerId === userId);
    },

    calculateMargin(submission) {
        if (!submission || !Array.isArray(submission.cart) || submission.cart.length === 0) return 0;
        return calculateOrderTotals(submission.cart, submission.conditions).margin;
    },

    getById(id) {
        return this.submissions[id] || null;
    },

    getByOrderNumber(orderNumber) {
        return this.getAll().find(s => s.orderNumber === orderNumber);
    }
};

// ========== NÚMERO HIPER ROLL ==========
// The server assigns the definitive number when the order is first saved (so two
// representatives can never get the same one); here we only show the next expected number.
const hiperrollOrderNumberManager = {
    preview: '',

    setPreview(nextNumber) {
        if (nextNumber) this.preview = nextNumber;
    },

    applyToForm() {
        const field = document.getElementById('orderNumberHiperroll');
        if (field) field.value = this.preview;
        updateHeaderInfo();
    }
};

// ========== LIXEIRA ==========
const deletedSubmissionsManager = {
    deleted: {},

    setAll(orders) {
        this.deleted = {};
        (orders || []).forEach(order => {
            this.deleted[order.id] = order;
        });
    },

    getAll() {
        return Object.values(this.deleted).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    },

    getById(id) {
        return this.deleted[id] || null;
    },

    count() {
        return Object.keys(this.deleted).length;
    },

    async restore(submissionId) {
        const data = await apiRequest('orders.restore', { method: 'POST', body: { id: submissionId } });
        orderSubmissionManager.upsert(data.order);
        return data.order;
    },

    async permanentlyDelete(submissionId) {
        await apiRequest('orders.purge', { method: 'POST', body: { id: submissionId } });
        delete this.deleted[submissionId];
    },

    async emptyTrash() {
        const data = await apiRequest('orders.emptyTrash', { method: 'POST' });
        await loadServerData();
        return data;
    }
};

async function loadServerData() {
    const data = await apiRequest('orders.list');
    orderSubmissionManager.setAll(data.orders);
    deletedSubmissionsManager.setAll(data.trash);
    hiperrollOrderNumberManager.setPreview(data.nextNumber);
}

// Only the fields the server accepts are sent; prices come from the cart the user built.
function buildCurrentOrderInput(extraConditions = {}) {
    return {
        clientOrderNumber: document.getElementById('orderNumberClient')?.value.trim() || '',
        clientName: document.getElementById('clientName')?.value.trim() || '',
        representativeName: document.getElementById('representativeName')?.value.trim() || '',
        proposalValidity: normalizeProposalValidity(document.getElementById('proposalValidity')?.value || ''),
        cart: cart.map(item => ({
            codigo: item.codigo,
            descricao: item.descricao,
            fob: item.fob,
            cif: item.cif,
            negotiatedPrice: item.negotiatedPrice,
            unitDiscount: item.unitDiscount,
            weight: item.weight,
            tableMargin: item.tableMargin,
            qty: item.qty,
            uf: item.uf || '',
            cityType: item.cityType || '',
            weightTier: item.weightTier || ''
        })),
        conditions: { ...getCurrentOrderConditions(), ...extraConditions },
        // The server refuses a submit priced on an older table version (see reviewCartPrices).
        pricingVersion: pricingCatalog.version
    };
}

// =========================================================
