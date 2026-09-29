// script.js

function parseCSV(csv, delimiter = ';') {
    const lines = csv.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/"/g, '')));
}

const productsData = [];
const freightData = {};
const costsData = {};
const cart = []; // Store order items
let currentOrderMargin = 0;
let activeDraftId = null;

console.log('[Portal Hiperroll] script_v5.js loaded');

// ===== Regras de precificação e margem (fonte única para tela, rascunho, supervisor e PDF) =====
const PRICING_RULES = Object.freeze({
    MIN_ORDER_MARGIN: 10,
    TARGET_MARGIN: 15,
    EARLY_PAYMENT_DISCOUNT: 2,
    FOB_FREIGHT_DISCOUNT: 3,
    MIN_JUSTIFICATION_LENGTH: 10
});

function getMarginStatus(margin, minMargin = PRICING_RULES.MIN_ORDER_MARGIN) {
    if (margin >= PRICING_RULES.TARGET_MARGIN) {
        return { label: 'Verde', color: '#15803d', description: 'Margem segura' };
    }
    if (margin >= minMargin) {
        return { label: 'Amarelo', color: '#b45309', description: 'Margem de atenção' };
    }
    return { label: 'Vermelho', color: '#c53030', description: 'Abaixo da margem mínima' };
}

// Percentages are stored with each order so a later rule change never rewrites
// what was already submitted; missing values (older orders) fall back to today's rules.
function normalizeOrderConditions(conditions) {
    const c = conditions || {};
    const toPercent = (value, fallback) => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
        manualDiscount: toPercent(c.manualDiscount, 0),
        contract: toPercent(c.contract, 0),
        earlyPayment: Boolean(c.earlyPayment),
        fobFreight: Boolean(c.fobFreight),
        earlyPaymentPercent: toPercent(c.earlyPaymentPercent, PRICING_RULES.EARLY_PAYMENT_DISCOUNT),
        fobFreightPercent: toPercent(c.fobFreightPercent, PRICING_RULES.FOB_FREIGHT_DISCOUNT),
        minMargin: toPercent(c.minMargin, PRICING_RULES.MIN_ORDER_MARGIN),
        lowMarginJustification: String(c.lowMarginJustification || '').trim()
    };
}

function getOrderDiscountPercent(conditions) {
    const c = normalizeOrderConditions(conditions);
    return c.manualDiscount
        + (c.earlyPayment ? c.earlyPaymentPercent : 0)
        + (c.fobFreight ? c.fobFreightPercent : 0);
}

// Margin is value-weighted on the net price (after discounts). The contract %
// grosses up the invoice but is passed back to the client, so it doesn't count as margin.
function calculateOrderTotals(items, conditions) {
    const c = normalizeOrderConditions(conditions);
    const discountPercent = getOrderDiscountPercent(c);
    const discountFactor = Math.max(1 - discountPercent / 100, 0);
    const contractFactor = 1 + c.contract / 100;

    const totals = { totalQty: 0, totalWeight: 0, totalFob: 0, totalGross: 0, totalNet: 0, totalInvoice: 0 };
    const lines = (Array.isArray(items) ? items : []).map(item => {
        const qty = parseFloat(item.qty) || 0;
        const fobUnit = parseFloat(item.fob) || 0;
        const negotiatedUnit = Math.max(parseFloat(item.negotiatedPrice || item.cif) || 0, 0);
        const netUnit = negotiatedUnit * discountFactor;
        const invoiceUnit = netUnit * contractFactor;
        const marginPercent = netUnit > 0 ? ((netUnit - fobUnit) / netUnit) * 100 : 0;

        totals.totalQty += qty;
        totals.totalWeight += (parseFloat(item.weight) || 0) * qty;
        totals.totalFob += fobUnit * qty;
        totals.totalGross += negotiatedUnit * qty;
        totals.totalNet += netUnit * qty;
        totals.totalInvoice += invoiceUnit * qty;

        return { item, qty, fobUnit, negotiatedUnit, netUnit, invoiceUnit, marginPercent, subtotal: invoiceUnit * qty };
    });

    const margin = totals.totalNet > 0 ? ((totals.totalNet - totals.totalFob) / totals.totalNet) * 100 : 0;
    return {
        ...totals,
        conditions: c,
        discountPercent,
        lines,
        margin,
        belowMinimum: lines.length > 0 && margin < c.minMargin,
        status: getMarginStatus(margin, c.minMargin)
    };
}

function describeOrderDiscounts(conditions) {
    const c = normalizeOrderConditions(conditions);
    const parts = [];
    if (c.manualDiscount > 0) parts.push(`Desconto manual ${c.manualDiscount.toFixed(2)}%`);
    if (c.earlyPayment) parts.push(`Pagamento antecipado ${c.earlyPaymentPercent.toFixed(2)}%`);
    if (c.fobFreight) parts.push(`Frete FOB ${c.fobFreightPercent.toFixed(2)}%`);
    return parts;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Shared block shown to the supervisor (details, actions, history): discounts,
// real margin and the low-margin justification when present.
function renderOrderConditionsSummary(submission) {
    const totals = calculateOrderTotals(submission?.cart, submission?.conditions);
    const c = totals.conditions;
    const discounts = describeOrderDiscounts(c);
    const discountsHtml = discounts.length
        ? discounts.map(d => `<span class="condition-chip">${escapeHtml(d)}</span>`).join('')
        : '<span class="condition-chip condition-chip--muted">Sem descontos de pedido</span>';
    const contractHtml = c.contract > 0
        ? `<span class="condition-chip condition-chip--muted">Contrato +${c.contract.toFixed(2)}%</span>`
        : '';

    const justificationHtml = totals.belowMinimum
        ? `<div class="low-margin-alert">
                <strong>⚠️ Margem abaixo do mínimo de ${c.minMargin.toFixed(0)}%</strong>
                <div>${c.lowMarginJustification
                    ? `Justificativa do representante: <em>${escapeHtml(c.lowMarginJustification)}</em>`
                    : 'Nenhuma justificativa registrada.'}</div>
            </div>`
        : '';

    return `
        <div class="order-conditions-summary">
            <div class="order-conditions-row">
                <span class="order-conditions-label">Condições:</span>
                ${discountsHtml}${contractHtml}
            </div>
            <div class="order-conditions-row">
                <span class="order-conditions-label">Desconto total:</span>
                <strong>${totals.discountPercent.toFixed(2)}%</strong>
                <span class="order-conditions-label" style="margin-left:12px;">Margem do pedido:</span>
                <strong style="color:${totals.status.color};">${totals.margin.toFixed(2)}% (${totals.status.label})</strong>
            </div>
            ${justificationHtml}
        </div>
    `;
}

function setLoadedOrderReference(reference = '') {
    const input = document.getElementById('loadedDraftNumber');
    if (input) {
        input.value = reference || '';
    }
    updateHeaderInfo();
}

// ========== SISTEMA DE STATUS E HISTÓRICO ==========
const statusManager = {
    currentStatus: 'rascunho',
    history: [],
    
    // Inicializa o status e carrega do localStorage se existir
    init() {
        const saved = localStorage.getItem('orderStatus');
        const savedHistory = localStorage.getItem('orderStatusHistory');

        if (saved) {
            this.currentStatus = saved;
        }
        
        if (savedHistory) {
            try {
                this.history = JSON.parse(savedHistory);
            } catch (e) {
                this.history = [];
            }
        }
        
        // Se não há histórico, cria o primeiro registro
        if (this.history.length === 0) {
            this.addHistoryEntry(this.currentStatus, 'Sistema iniciado', null);
        }
        
        this.updateUI();
    },
    
    // Adiciona entrada no histórico
    addHistoryEntry(newStatus, reason = '', userName = null) {
        const entry = {
            timestamp: new Date().toISOString(),
            statusAnterior: this.currentStatus,
            statusNovo: newStatus,
            razao: reason,
            usuario: userName || 'Sistema',
            dataFormatada: new Date().toLocaleString('pt-BR')
        };
        
        this.history.push(entry);
        this.save();
    },
    
    // Muda o status e registra no histórico
    changeStatus(newStatus) {
        if (!['rascunho', 'analise', 'aprovado', 'rejeitado'].includes(newStatus)) return;
        const user = (typeof authManager !== 'undefined') ? authManager.getCurrentUser() : null;
        const userRole = (typeof authManager !== 'undefined') ? authManager.getCurrentUserRole() : null;
        if (!user) {
            alert('Faça login para alterar o status do pedido.');
            showLoginModal();
            return;
        }

        // Todos os usuários autenticados podem definir Rascunho ou Em Análise
        if (['rascunho', 'analise'].includes(newStatus)) {
            if (newStatus !== this.currentStatus) {
                orderManager.ensureCreator(user);
                // Alteração temporária do seletor/visual não deve criar entrada no histórico.
                // Histórico será criado apenas ao salvar/enviar (saveDraft / submitOrder).
                this.currentStatus = newStatus;
                this.updateUI();
                updateSupervisorPanel();
            }
            return;
        }

        if (!authManager.isGestor()) {
            alert('Somente o gestor pode aprovar ou rejeitar pedidos.');
            return;
        }

        if (newStatus !== this.currentStatus) {
            orderManager.ensureCreator(user);
            this.addHistoryEntry(newStatus, '', user);
            this.currentStatus = newStatus;
            this.updateUI();
            updateSupervisorPanel();
        }
    },
    
    // Atualiza a UI com o status atual
    updateUI() {
        const statusSelect = document.getElementById('orderStatus');
        const statusDisplay = document.getElementById('statusDisplay');
        
        if (statusSelect) {
            statusSelect.value = this.currentStatus;
        }
        
        // Aplicar cores baseado no status
        const colors = {
            'rascunho': { bg: '#fef3c7', text: '#92400e', icon: '📝' },
            'analise': { bg: '#dbeafe', text: '#0c4a6e', icon: '🔍' },
            'aprovado': { bg: '#dcfce7', text: '#15803d', icon: '✅' },
            'rejeitado': { bg: '#fee2e2', text: '#b91c1c', icon: '❌' }
        };
        
        const color = colors[this.currentStatus];
        
        if (statusSelect) {
            statusSelect.style.background = color.bg;
            statusSelect.style.color = color.text;
            statusSelect.style.fontWeight = '600';
            statusSelect.style.border = `2px solid ${color.text}`;
            const isGestor = typeof authManager !== 'undefined' && authManager.isGestor();
            Array.from(statusSelect.options).forEach(opt => {
                if (['aprovado', 'rejeitado'].includes(opt.value) && !isGestor) {
                    opt.disabled = true;
                    opt.style.color = '#999';
                } else {
                    opt.disabled = false;
                    opt.style.color = '';
                }
            });
        }
    },
    
    // Salva no localStorage
    save() {
        localStorage.setItem('orderStatus', this.currentStatus);
        localStorage.setItem('orderStatusHistory', JSON.stringify(this.history));
    },
    
    // Retorna o histórico formatado para exibição
    getFormattedHistory() {
        return this.history.map(entry => ({
            ...entry,
            labelStatus: {
                'rascunho': 'Rascunho',
                'analise': 'Em Análise',
                'aprovado': 'Aprovado',
                'rejeitado': 'Rejeitado'
            }[entry.statusNovo] || entry.statusNovo
        }));
    }
};
// ==========================================

// ========== CLIENTE DA API (servidor PHP) ==========
const API_BASE = 'api/index.php';
let apiCsrfToken = '';

// Every call goes through here: sends the session cookie, the CSRF token on writes,
// and turns server errors into Error objects with the server's message.
async function apiRequest(action, { method = 'GET', body = null, retryOnCsrf = true } = {}) {
    const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
        options.headers['Content-Type'] = 'application/json';
        options.headers['X-CSRF-Token'] = apiCsrfToken;
        options.body = JSON.stringify(body || {});
    }

    let response;
    try {
        response = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, options);
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
        return apiRequest(action, { method, body, retryOnCsrf: false });
    }
    if (response.status === 401 && action !== 'login') {
        authManager.handleSessionExpired();
    }
    if (!response.ok || !data || data.success === false) {
        const error = new Error((data && data.message) || `Erro ${response.status} ao comunicar com o servidor.`);
        error.status = response.status;
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

    mustChangePassword() {
        return Boolean(this.profile && this.profile.mustChangePassword);
    },

    updateUI() {
        const loginBtn = document.getElementById('loginBtn');
        const currentUserDiv = document.getElementById('currentUser');
        const currentUserName = document.getElementById('currentUserName');
        const supervisorBtn = document.getElementById('supervisorBtn');
        const usersBtn = document.getElementById('usersBtn');

        if (!loginBtn || !currentUserDiv || !currentUserName || !supervisorBtn) return;

        if (this.currentUser) {
            loginBtn.style.display = 'none';
            currentUserDiv.style.display = 'flex';
            currentUserName.textContent = `${this.getDisplayName() || this.currentUser} (${ROLE_LABELS[this.getCurrentUserRole()] || this.getCurrentUserRole()})`;
            supervisorBtn.style.display = this.isGestor() ? 'inline-flex' : 'none';
            if (usersBtn) usersBtn.style.display = this.canManageUsers() ? 'inline-flex' : 'none';
        } else {
            loginBtn.style.display = 'inline-block';
            currentUserDiv.style.display = 'none';
            currentUserName.textContent = '--';
            supervisorBtn.style.display = 'none';
            if (usersBtn) usersBtn.style.display = 'none';
        }
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
            qty: item.qty
        })),
        conditions: { ...getCurrentOrderConditions(), ...extraConditions }
    };
}

// =========================================================

async function init() {
    orderManager.init();
    statusManager.init();

    applyPricingRuleLabels();
    const marginThresholdEl = document.getElementById('marginThreshold');
    if (marginThresholdEl) marginThresholdEl.textContent = PRICING_RULES.MIN_ORDER_MARGIN;

    try {
        await authManager.init();
    } catch (e) {
        showLoginModal(e.message);
        return;
    }

    if (!authManager.getCurrentUser()) {
        showLoginModal();
        return;
    }
    if (authManager.mustChangePassword()) {
        showLoginModal();
        showChangePasswordModal(true);
        return;
    }

    // api/data.php only delivers the price tables to a logged-in session, so a session
    // created after the page loaded needs one reload. The flag prevents a reload loop.
    if (window.PORTAL_DATA_LOCKED !== false || typeof PRODUTOS_CSV === 'undefined') {
        if (!sessionStorage.getItem('hr_data_reload')) {
            sessionStorage.setItem('hr_data_reload', '1');
            location.reload();
        } else {
            sessionStorage.removeItem('hr_data_reload');
            showLoginModal('Não foi possível carregar as tabelas de preço. Recarregue a página.');
        }
        return;
    }
    sessionStorage.removeItem('hr_data_reload');

    // 1. Parse Products
    const prodRows = parseCSV(PRODUTOS_CSV);
    prodRows.forEach((row, index) => {
        if (index === 0) return; // Skip headers
        if (row.length < 10) return;
        
        const codigo = row[4]?.trim() || "";
        const descricao = row[5]?.trim() || "";

        // Filter out header-like rows from the CSV
        if (!codigo || !descricao ||
            codigo.toLowerCase().includes("cd") || 
            codigo.toLowerCase().includes("cod") ||
            descricao.toLowerCase().includes("descrio") ||
            descricao.toLowerCase().includes("descricao") ||
            descricao.toLowerCase() === "produto") {
            return;
        }

        const rawWeight = parseFloat(row[18]?.replace(',', '.')) || 0;
        
        // Skip zeroed products
        if (rawWeight === 0) return;

        productsData.push({
            categoria: row[0],
            subcat: row[1],
            codigo: codigo,
            descricao: descricao,
            peso: rawWeight,
            weightRaw: rawWeight, // Guardando valor bruto para cálculos
            ncm: row[20],
            originalRow: row
        });
    });

    // 2. Parse Costs (Blendas)
    const costRows = parseCSV(BLENDAS_CSV);
    costRows.forEach(row => {
        if (row.length < 13) return;
        const category = row[1]?.toLowerCase().trim();
        
        // Colunas: C(2)=Custo Prod, D(3)=Desp Com, E(4)=Desp Adm, M(12)=100% NF
        const custoBase = parseFloat(row[2]?.replace(',', '.')) || 0;
        const despCom = parseFloat(row[3]?.replace(',', '.')) || 0;
        const despAdm = parseFloat(row[4]?.replace(',', '.')) || 0;
        let price100 = parseFloat(row[12]?.replace(',', '.')) || parseFloat(row[12]?.replace('R$', '').replace('.', '').replace(',', '.')) || 0;
        
        if (category && price100 > 0) {
            price100 += 0.02; // Ajuste solicitado de R$ 0,02 no valor base
            
            const totalCostsWithoutFreight = custoBase + despCom + despAdm;
            const divisor = totalCostsWithoutFreight / price100;

            if (!costsData[category] || price100 > costsData[category].price100) {
                costsData[category] = {
                    price100: price100,
                    custoBase: custoBase,
                    despCom: despCom,
                    despAdm: despAdm,
                    divisor: divisor
                };
            }
        }
    });

    // 3. Parse Freight
    const freightRows = parseCSV(FRETE_CSV);
    let currentUF = '';
    let ufEntryCount = 0; // Para identificar a primeira entrada de cada UF

    freightRows.forEach(row => {
        if (row[0]?.includes('UF')) return;
        if (row[0]?.length === 2) {
            if (currentUF !== row[0]) {
                currentUF = row[0];
                ufEntryCount = 0; // Reset para novo UF
            }
            
            if (!freightData[currentUF]) freightData[currentUF] = {};
            
            const city = (row[1] || '').toLowerCase();
            const isInterior = city.includes('interior');
            const isFluvial = city.includes('fluvial');
            
            // Lógica: Se for a primeira entrada do UF E não for interior/fluvial, tratamos como CAPITAL
            // Ou se o nome contiver explicitamente a capital
            let type = 'Interior';
            if (isFluvial) {
                type = 'Fluvial';
            } else if (isInterior) {
                type = 'Interior';
            } else if (ufEntryCount === 0 || city.includes('capital') || city.includes('metropolitana')) {
                type = 'Capital';
            }
            
            freightData[currentUF][type] = {
                tier1: parseFloat(row[2]?.replace(',', '.')) || 0,
                tier2: parseFloat(row[3]?.replace(',', '.')) || 0
            };

            ufEntryCount++;
        }
    });

    // Populate UF select
    const stateSelect = document.getElementById('stateSelect');
    Object.keys(freightData).sort().forEach(uf => {
        const opt = document.createElement('option');
        opt.value = uf;
        opt.textContent = uf;
        stateSelect.appendChild(opt);
    });

    // Event Listeners
    document.getElementById('productSearch').addEventListener('input', updateResults);
    document.getElementById('stateSelect').addEventListener('change', updateResults);
    document.getElementById('cityType').addEventListener('change', updateResults);
    document.getElementById('weightTier').addEventListener('change', updateResults);

    try {
        await loadServerData();
    } catch (e) {
        alert(`Não foi possível carregar os pedidos do servidor: ${e.message}`);
    }

    hiperrollOrderNumberManager.applyToForm();
    const representativeInput = document.getElementById('representativeName');
    if (representativeInput && !representativeInput.value) {
        representativeInput.value = authManager.getDisplayName();
    }

    closeLoginModal();
    authManager.updateUI();
    updateTrashBadge();
}

function getCategoryMatch(product) {
    const desc = product.descricao.toLowerCase();
    const cat = product.categoria.toLowerCase();
    
    if (desc.includes('estrela')) return 'bobina estrela (cx branca)';
    if (desc.includes('freezer')) return 'bobina freezer';
    if (desc.includes('forração')) return 'bobina forração';
    if (desc.includes('sacola') && desc.includes('azul')) return 'sacola azul lisa';
    if (desc.includes('sacola') && desc.includes('verde')) return 'sacola verde impressa';
    if (desc.includes('sacola') && desc.includes('branca')) return 'sacola branca impressa';
    if (desc.includes('saco para lixo') && desc.includes('azul')) return 'saco para lixo dobrado azul';
    if (desc.includes('saco para lixo') && desc.includes('preto')) return 'saco para lixo dobrado preto';
    if (desc.includes('saco para lixo')) return 'saco para lixo';
    if (desc.includes('fundo reto')) return 'fundo reto';
    
    // Default fallback based on category column
    if (cat.includes('bobina')) return 'bobina estrela (cx branca)';
    if (cat.includes('sacola')) return 'sacola branca impressa';
    if (cat.includes('corte solda md')) return 'corte solda md';
    if (cat.includes('corte solda bd')) return 'corte solda bd';
    
    return 'fundo reto'; // Default
}

// Cria uma versão resumida da descrição para impressão em PDF
function summarizeDescription(desc, maxChars = 36) {
    if (!desc) return '';
    let s = desc.toString().toLowerCase();

    const replacements = {
        'saco para lixo': 'sxl',
        'bobina': 'bob',
        'sacola': 'sacl',
        'preta': 'prt',
        'branca': 'brc',
        'azul': 'azl',
        'forração': 'forr',
        'forracao': 'forr',
        'estrela': 'estr',
        'freezer': 'frz',
        'corte': 'crt',
        'solda': 'sld',
        'lisa': 'lsa',
        'impressa': 'imp',
        'hiper': 'hp',
        'economica': 'econ',
        'ec': 'econ',
        'pic': 'PIC'
    };

    // Substituir termos maiores primeiro
    Object.keys(replacements).sort((a,b) => b.length - a.length).forEach(key => {
        const val = replacements[key];
        s = s.replace(new RegExp('\\b' + key + '\\b', 'gi'), val);
    });

    // Remover múltiplos espaços e cortar se necessário
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > maxChars) {
        s = s.slice(0, maxChars - 1).trim() + '…';
    }

    // Manter em maiúsculas as siglas comuns (PIC, etc.) e capitalizar inicial
    s = s.split(' ').map(token => token === 'PIC' || token === 'hp' ? token.toUpperCase() : token).join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function updateResults() {
    let searchTerm = document.getElementById('productSearch').value.toLowerCase().trim();
    const uf = document.getElementById('stateSelect').value;
    const cityType = document.getElementById('cityType').value;
    const weightTier = document.getElementById('weightTier').value;
    const container = document.getElementById('resultsContainer');

    if (!uf) {
        container.innerHTML = '<div class="empty-state">Por favor, selecione um estado para ver os preços CIF.</div>';
        return;
    }

    // Lógica de busca melhorada
    const keywords = searchTerm.split(' ').filter(k => k.length > 0).map(k => {
        return k.endsWith('s') && k.length > 3 ? k.slice(0, -1) : k;
    });

    const filtered = productsData.filter(p => {
        if (keywords.length === 0) return true; // MOSTRAR TODOS se a busca estiver vazia
        
        const fullText = `${p.descricao} ${p.codigo} ${p.categoria} ${p.subcat}`.toLowerCase();
        return keywords.every(key => fullText.includes(key));
    }); // Limite removido para mostrar todos os itens

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Cód / Descrição</th>
                    <th>Peso (Kg)</th>
                    <th>Frete (FOB)</th>
                    <th>Preço (CIF)</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
    `;

    filtered.forEach((p, idx) => {
        const catKey = getCategoryMatch(p);
        const costInfo = costsData[catKey] || { price100: 0, divisor: 0.625 };
        
        const basePricePerKg = costInfo.price100;
        const fobPrice = basePricePerKg * p.weightRaw;
        
        const fData = freightData[uf] ? freightData[uf][cityType] : null;
        const rate = fData ? fData[weightTier] : 0;
        
        // CÁLCULO CIF DE ALTA PRECISÃO (Summing freight to base cost first)
        const divisor = costInfo.divisor || 0.625;
        const totalCostPerKg = costInfo.custoBase + costInfo.despCom + costInfo.despAdm + rate;
        const cifPricePerKg = totalCostPerKg / divisor;
        const cifPrice = cifPricePerKg * p.weightRaw;

        const freightCost = rate * p.weightRaw;
        
        // Formatando para exibir na tela (o toFixed(2) já arredonda 93.778 para 93.78)
        const cifDisplay = cifPrice.toFixed(2);

               html += `
            <tr>
                <td>
                    <div style="font-weight:600">${p.codigo}</div>
                    <div style="font-size:0.85rem; color:#6b7280">${p.descricao}</div>
                </td>
                <td>${p.peso.toFixed(3)}</td>
                <td class="price-tag price-fob">R$&nbsp;${fobPrice.toFixed(2)}</td>
                <td class="price-tag price-cif">R$&nbsp;${cifDisplay}</td>
                <td class="col-action">
                    <button onclick="addToCart('${p.codigo}', ${fobPrice}, ${cifPrice}, ${p.weightRaw})">
                        ➕ Adicionar
                    </button>
                </td>
            </tr>
        `;

    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function addToCart(codigo, fob, cif, weight) {
    const p = productsData.find(item => item.codigo === codigo);
    if (!p) return;

    const currentUser = authManager.getCurrentUser();
    orderManager.ensureCreator(currentUser);

    const existing = cart.find(item => item.codigo === codigo);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({
            codigo: p.codigo,
            descricao: p.descricao,
            fob: fob,
            cif: cif, // Preço CIF original (referência)
            negotiatedPrice: cif,
            unitDiscount: 0,
            weight: weight,
            qty: 1
        });
    }
    updateOrderTable();
}

function getCurrentOrderConditions() {
    return normalizeOrderConditions({
        manualDiscount: document.getElementById('orderDiscount')?.value,
        contract: document.getElementById('orderContract')?.value,
        earlyPayment: document.getElementById('orderEarlyPayment')?.checked,
        fobFreight: document.getElementById('orderFobFreight')?.checked
    });
}

function setCurrentOrderConditions(conditions) {
    const c = normalizeOrderConditions(conditions);
    const discountInput = document.getElementById('orderDiscount');
    const contractInput = document.getElementById('orderContract');
    const earlyPaymentInput = document.getElementById('orderEarlyPayment');
    const fobFreightInput = document.getElementById('orderFobFreight');
    if (discountInput) discountInput.value = c.manualDiscount;
    if (contractInput) contractInput.value = c.contract;
    if (earlyPaymentInput) earlyPaymentInput.checked = c.earlyPayment;
    if (fobFreightInput) fobFreightInput.checked = c.fobFreight;
}

function applyPricingRuleLabels() {
    document.querySelectorAll('[data-pricing-rule]').forEach(el => {
        const value = PRICING_RULES[el.dataset.pricingRule];
        if (value !== undefined) el.textContent = `${value}%`;
    });
}

function renderOrderDiscountBreakdown(totals) {
    const el = document.getElementById('orderDiscountBreakdown');
    if (!el) return;
    const parts = describeOrderDiscounts(totals.conditions);
    el.innerHTML = parts.length
        ? `Desconto total aplicado: <strong>${totals.discountPercent.toFixed(2)}%</strong> <span>(${parts.map(escapeHtml).join(' + ')})</span>`
        : 'Nenhum desconto de pedido aplicado.';

    const warning = document.getElementById('orderMinMarginWarning');
    if (warning) {
        warning.hidden = !totals.belowMinimum;
        warning.textContent = totals.belowMinimum
            ? `⚠️ Margem do pedido abaixo do mínimo de ${totals.conditions.minMargin}%. O envio exigirá uma justificativa e será sinalizado ao supervisor.`
            : '';
    }
}

function updateOrderTable() {
    const container = document.getElementById('orderTableContainer');
    const summaryDiv = document.getElementById('orderSummary');

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum item no pedido.</div>';
        summaryDiv.style.display = 'none';
        return;
    }

    summaryDiv.style.display = 'block';

    const totals = calculateOrderTotals(cart, getCurrentOrderConditions());

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Cód / Descrição</th>
                    <th>Qtd</th>
                    <th>Peso Total</th>
                    <th>FOB Unit.</th>
                    <th>CIF Unit.</th>
                    <th>Desconto Unit.</th>
                    <th>Preço Negociado</th>
                    <th title="Margem sobre o preço líquido, já considerando os descontos do pedido">Margem Líq. (%)</th>
                    <th>Subtotal</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
    `;

    totals.lines.forEach((line, idx) => {
        const item = line.item;
        const subWeight = item.weight * item.qty;
        const negotiatedPrice = line.negotiatedUnit;
        const unitDiscount = Math.max(item.unitDiscount || 0, 0);
        const itemMarginPercent = line.marginPercent;
        const subCifWithDiscountContract = line.subtotal;

        html += `
            <tr>
                <td>
                    <div style="font-weight:600">${item.codigo}</div>
                    <div style="font-size:0.85rem; color:#6b7280">${item.descricao}</div>
                </td>
                <td style="text-align: center;">
                    <input type="number" value="${item.qty}" min="1" style="width: 60px; padding: 5px;" onchange="updateCartQty(${idx}, this.value)">
                    <span class="print-value">${item.qty}</span>
                </td>
                <td>${subWeight.toFixed(3)}&nbsp;Kg</td>
                <td>R$&nbsp;${item.fob.toFixed(2)}</td>
                <td>R$&nbsp;${item.cif.toFixed(2)}</td>
                <td>
                          <input type="number" step="0.01" min="0" value="${unitDiscount.toFixed(2)}" 
                              onchange="updateUnitDiscount(${idx}, this.value)"
                           title="Desconto unitário em reais" style="width: 90px; padding: 5px;">
                    <span class="print-value">R$&nbsp;${unitDiscount.toFixed(2)}</span>
                </td>
                <td>
                          <input type="number" step="0.01" min="0" value="${negotiatedPrice.toFixed(2)}" 
                              onchange="updateNegotiatedPrice(${idx}, this.value)"
                           title="Preço negociado unitário" style="width: 100px; padding: 5px;">
                    <span class="print-value">R$&nbsp;${negotiatedPrice.toFixed(2)}</span>
                </td>
                <td style="text-align: center;">
                    <span style="color: ${getMarginStatus(itemMarginPercent, totals.conditions.minMargin).color}">
                        ${itemMarginPercent.toFixed(2)}%
                    </span>
                </td>
                <td class="price-tag">R$&nbsp;${subCifWithDiscountContract.toFixed(2)}</td>
                <td class="col-action">
                    <button onclick="removeFromCart(${idx})" class="btn-icon-remove" title="Remover item">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    document.getElementById('totalWeight').textContent = totals.totalWeight.toFixed(3);
    document.getElementById('totalFob').textContent = totals.totalFob.toFixed(2);
    document.getElementById('totalCif').textContent = totals.totalInvoice.toFixed(2);

    const printDiscountEl = document.getElementById('printDiscount');
    const printContractEl = document.getElementById('printContract');
    if (printDiscountEl) printDiscountEl.textContent = totals.discountPercent.toFixed(2) + '%';
    if (printContractEl) printContractEl.textContent = totals.conditions.contract.toFixed(2) + '%';

    const marginPercentageElement = document.getElementById('marginPercentage');
    marginPercentageElement.textContent = totals.margin.toFixed(2) + '%';
    marginPercentageElement.style.color = totals.status.color;
    currentOrderMargin = totals.margin;

    const totalsPriceContainer = document.getElementById('totalsPriceContainer');
    totalsPriceContainer.classList.remove('margin-alert', 'margin-warning', 'margin-good');
    const statusClass = { Verde: 'margin-good', Amarelo: 'margin-warning', Vermelho: 'margin-alert' }[totals.status.label];
    totalsPriceContainer.classList.add(statusClass);

    renderOrderDiscountBreakdown(totals);
}

// Atualiza o desconto unitário e recalcula os valores do item
function updateUnitDiscount(idx, discountValue) {
    const value = Math.max(parseFloat(discountValue) || 0, 0);
    cart[idx].unitDiscount = value;
    cart[idx].negotiatedPrice = Math.max(cart[idx].cif - value, 0);
    updateOrderTable();
}

// Atualiza o preço negociado unitário e recalcula o desconto equivalente
function updateNegotiatedPrice(idx, priceValue) {
    const value = Math.max(parseFloat(priceValue) || 0, 0);
    cart[idx].negotiatedPrice = value;
    cart[idx].unitDiscount = Math.max(cart[idx].cif - value, 0);
    updateOrderTable();
}

function updateCartQty(idx, qty) {
    cart[idx].qty = parseInt(qty) || 1;
    updateOrderTable();
}

function removeFromCart(idx) {
    cart.splice(idx, 1);
    updateOrderTable();
}

function normalizeProposalValidity(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const digitsOnly = raw.replace(/\D+/g, '');
    if (!digitsOnly) return raw;

    const parsed = Number.parseInt(digitsOnly, 10);
    if (!Number.isFinite(parsed)) return raw;

    return `dias ${parsed}`;
}

function formatProposalValidityInput(input) {
    if (!input) return;
    const formatted = normalizeProposalValidity(input.value);
    input.value = formatted;
}

function updateHeaderInfo() {
    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '---';
    const dateStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    const headerOrderNumberEl = document.getElementById('headerOrderNumber');
    const headerOrderDateEl = document.getElementById('headerOrderDate');
    
    const displayNumber = orderNumberHiperroll;
    
    if (headerOrderNumberEl) headerOrderNumberEl.textContent = displayNumber;
    if (headerOrderDateEl) headerOrderDateEl.textContent = dateStr;
}

window.onload = init;

function formatCurrency(value) {
    return `R$ ${value.toFixed(2)}`;
}

function formatNumber(value, decimals = 2) {
    return value.toFixed(decimals);
}

function createPdfExportNode() {
    const pricing = calculateOrderTotals(cart, getCurrentOrderConditions());
    const discount = pricing.discountPercent;
    const contract = pricing.conditions.contract;
    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '---';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '---';
    const loadedDraftNumber = document.getElementById('loadedDraftNumber')?.value.trim() || '';
    const orderNumber = loadedDraftNumber || orderNumberClient || orderNumberHiperroll;
    const clientName = document.getElementById('clientName')?.value.trim() || '---';
    const representativeName = document.getElementById('representativeName')?.value.trim() || '---';
    const proposalValidity = normalizeProposalValidity(document.getElementById('proposalValidity')?.value || '');
    const dateStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    const totalWeight = pricing.totalWeight;
    const totalFob = pricing.totalFob;
    const totalCif = pricing.totalInvoice;
    let rowsHtml = '';

    pricing.lines.forEach(line => {
        const item = line.item;
        const subWeight = item.weight * item.qty;
        const negotiatedPrice = line.negotiatedUnit;
        const unitDiscount = Math.max(item.unitDiscount || 0, 0);
        const subtotal = line.subtotal;
        const marginPercent = line.marginPercent;

        const shortDesc = summarizeDescription(item.descricao || '', 36);
        rowsHtml += `
            <tr>
                <td class="pdf-code">${item.codigo}</td>
                <td title="${item.descricao}">${shortDesc}</td>
                <td style="text-align:center">${item.qty}</td>
                <td>${subWeight.toFixed(3)}</td>
                <td>${formatCurrency(item.fob)}</td>
                <td>${formatCurrency(item.cif)}</td>
                <td>${formatCurrency(unitDiscount)}</td>
                <td>${formatCurrency(negotiatedPrice)}</td>
                <td>${marginPercent.toFixed(2)}%</td>
                <td>${formatCurrency(subtotal)}</td>
            </tr>
        `;
    });

    const averageMargin = pricing.margin;
    const pdfConditions = describeOrderDiscounts(pricing.conditions);

    // Totais adicionais solicitados
    const totalProducts = cart.length;
    const totalQuantity = cart.reduce((sum, item) => sum + (item.qty || 0), 0);
    const totalNegotiatedNoAdjust = cart.reduce((sum, item) => {
        const negotiatedPrice = Math.max(item.negotiatedPrice || item.cif, 0);
        return sum + (negotiatedPrice * (item.qty || 0));
    }, 0);
    const totalDiscounts = cart.reduce((sum, item) => {
        const unitDiscount = Math.max(item.unitDiscount || 0, 0);
        return sum + (unitDiscount * (item.qty || 0));
    }, 0);
    const totalSavings = totalNegotiatedNoAdjust - totalCif; // quanto se economiza considerando o subtotal final
    const totalSubtotal = totalCif; // já considera desconto/contrato aplicados no cálculo acima

    const pdfNode = document.createElement('div');
    pdfNode.className = 'pdf-export';
    pdfNode.style.background = '#ffffff';
    pdfNode.style.color = '#0f172a';
    pdfNode.innerHTML = `
        <style>
            .pdf-export { font-family: 'Helvetica Neue', Arial, sans-serif; color: #0f172a; }
            .pdf-brand { color: #E31E24; font-weight: 800; }
            .pdf-export .pdf-card { border-radius: 6px; overflow: hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
            .pdf-export table { width:100%; border-collapse: collapse; table-layout: fixed; font-family: inherit; }
            .pdf-export th, .pdf-export td { padding:6px 8px; border-bottom: 1px solid #e9f0f6; vertical-align: middle; word-break: break-word; font-size: 10px; }
            .pdf-export thead th { background: linear-gradient(180deg,#f8fafc,#eef6fb); font-weight:700; text-transform: uppercase; font-size:10px; color:#213547; }
            .pdf-export tbody tr td { color: #0f172a; }
            .pdf-export .pdf-code { font-weight:700; font-size:11px; }
            .pdf-header { display:flex; gap:16px; align-items:center; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #eef6fb; }
            .pdf-logo-wrapper { width:84px; height:84px; flex-shrink:0; background: linear-gradient(135deg,#E31E24 0%, #0054A6 100%); border-radius:16px; display:flex; align-items:center; justify-content:center; }
            .pdf-logo-image { max-width:70px; max-height:70px; object-fit:contain; }
            .pdf-title h1 { margin:0; font-size:20px; color:#0b1220; }
            .pdf-title p { margin:2px 0; font-weight:700; background: linear-gradient(90deg,#E31E24 0%, #0054A6 100%); -webkit-background-clip: text; color: transparent; }
            .pdf-meta { margin-left: auto; text-align:right; font-size:12px; color:#0b1220; }
            .pdf-summary { display:grid; grid-template-columns: repeat(2, minmax(160px,1fr)); gap:10px; margin-bottom:12px; page-break-inside: avoid; break-inside: avoid; }
            .pdf-summary .summary-row { background:#fbfdff; border:1px solid #eef6fb; padding:8px 10px; border-radius:6px; }
            .pdf-totals { margin-top:12px; padding:12px; border-radius:8px; background:#fff; border:1px solid #e6eef6; page-break-inside: avoid; break-inside: avoid; }
            .pdf-totals .col { display:flex; justify-content:space-between; gap:12px; margin-bottom:6px; font-size:12px; }
            .pdf-totals .col strong { color:#0b1220; }
            .pdf-totals .total-highlight { font-size:1.02rem; font-weight:700; color: #E31E24; }
            .pdf-export .pdf-card { page-break-inside: avoid; break-inside: avoid; }
            .pdf-header { page-break-inside: avoid; break-inside: avoid; }
        </style>
        <div class="pdf-header">
            <div class="pdf-logo-wrapper">
                <img class="pdf-logo-image" src="logo.png" alt="Hiper Roll Logo">
            </div>
            <div class="pdf-title">
                <h1>Pedido de Preços</h1>
                <p class="pdf-brand">Hiperroll • Portal de Preços</p>
            </div>
            <div class="pdf-meta">
                <div><strong>Pedido nº:</strong> ${orderNumber}</div>
                <div><strong>Data:</strong> ${dateStr}</div>
            </div>
        </div>

        <div class="pdf-metadata" style="display:grid; gap: 8px; margin-bottom: 18px; padding: 12px 14px; border: 1px solid #d8e1e8; background:#f8fafc;">
            <div style="display:flex; justify-content:space-between; gap:10px;"><span style="color:#475569">Pedido Hiper Roll:</span> <strong style="color:#E31E24; font-size:1.1rem;">${orderNumberHiperroll}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:10px;"><span style="color:#475569">Pedido Cliente:</span> <strong>${orderNumberClient !== '---' ? orderNumberClient : '(Não informado)'}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:10px;"><span style="color:#475569">Cliente:</span> <strong>${clientName}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:10px;"><span style="color:#475569">Representante:</span> <strong>${representativeName}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:10px;"><span style="color:#475569">Validade:</span> <strong>${proposalValidity}</strong></div>
            <div style="display:flex; justify-content:space-between; gap:10px;"><span style="color:#475569">Status do Pedido:</span> <strong>${{
                'rascunho': '📝 Rascunho',
                'analise': '🔍 Em Análise',
                'aprovado': '✅ Aprovado'
            }[statusManager.currentStatus] || 'Desconhecido'}</strong></div>
        </div>

        <div class="pdf-summary" style="display:grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; padding: 12px 14px; border: 1px solid #d8e1e8; background:#f8fafc;">
            <div class="summary-row"><span>Desconto Pedido:</span> <strong>${discount.toFixed(2)}%</strong></div>
            <div class="summary-row"><span>Contrato:</span> <strong>${contract.toFixed(2)}%</strong></div>
            <div class="summary-row" style="grid-column: 1 / -1;"><span>Condições comerciais:</span> <strong>${pdfConditions.length ? escapeHtml(pdfConditions.join(' • ')) : 'Nenhuma'}</strong></div>
            <div class="summary-row"><span>Peso Total:</span> <strong>${totalWeight.toFixed(3)} Kg</strong></div>
            <div class="summary-row"><span>Total FOB:</span> <strong>${formatCurrency(totalFob)}</strong></div>
            <div class="summary-row"><span>Total CIF:</span> <strong>${formatCurrency(totalCif)}</strong></div>
            <div class="summary-row"><span>Margem do Pedido:</span> <strong>${averageMargin.toFixed(2)}%</strong></div>
        </div>

        <div class="pdf-table card">
            <table>
                <colgroup>
                    <col style="width:8%">
                    <col style="width:36%">
                    <col style="width:5%">
                    <col style="width:7%">
                    <col style="width:8%">
                    <col style="width:8%">
                    <col style="width:7%">
                    <col style="width:8%">
                    <col style="width:5%">
                    <col style="width:8%">
                </colgroup>
                <thead>
                    <tr>
                        <th>Cód</th>
                        <th>Descrição</th>
                        <th>Qtd</th>
                        <th>Peso</th>
                        <th>FOB Unit.</th>
                        <th>CIF Unit.</th>
                        <th>Desc. Unit.</th>
                        <th>Preço Neg.</th>
                        <th>Margem</th>
                        <th>Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>

        <div class="pdf-totals pdf-card">
            <div style="padding:12px 14px;">
                <div class="col"><div>Produtos (itens distintos):</div><div><strong>${totalProducts}</strong></div></div>
                <div class="col"><div>Quantidade total (QTD):</div><div><strong>${totalQuantity}</strong></div></div>
                <div class="col"><div>Valor negociado (sem desconto/contrato):</div><div><strong>${formatCurrency(totalNegotiatedNoAdjust)}</strong></div></div>
                <div class="col"><div>Total descontos aplicados (R$):</div><div><strong>${formatCurrency(totalDiscounts)}</strong></div></div>
                <div class="col"><div>Valor Total (subtotal com desconto/contrato):</div><div class="total-highlight">${formatCurrency(totalSubtotal)}</div></div>
                <div class="col"><div>Savings (negociado - subtotal):</div><div><strong>${formatCurrency(totalSavings)}</strong></div></div>
            </div>
        </div>
    `;

    return pdfNode;
}

// Print metadata: populate header date
let pdfPrintFallbackActive = false;

function populatePrintMeta() {
    const d = new Date();
    const dateStr = d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const headerOrderDateEl = document.getElementById('headerOrderDate');
    if (headerOrderDateEl) headerOrderDateEl.textContent = dateStr;
}

function enablePdfPrintFallback(pdfNode) {
    const style = document.createElement('style');
    style.id = 'print-export-style';
    style.textContent = `
        body.print-export-active > :not(.pdf-export):not(style#print-export-style) {
            display: none !important;
        }

        body.print-export-active {
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
        }

        .pdf-export {
            display: block !important;
            visibility: visible !important;
        }

        .pdf-export * {
            color: #0f172a !important;
        }
    `;

    document.head.appendChild(style);
    document.body.classList.add('print-export-active');
    window.__pdfExportNode = pdfNode;
    pdfPrintFallbackActive = true;
}

function cleanupPdfPrintFallback() {
    if (window.__pdfExportNode && window.__pdfExportNode.parentNode) {
        window.__pdfExportNode.remove();
    }

    const style = document.getElementById('print-export-style');
    if (style) {
        style.remove();
    }

    document.body.classList.remove('print-export-active');
    window.__pdfExportNode = null;
    pdfPrintFallbackActive = false;
}

window.onbeforeprint = () => populatePrintMeta();
window.onafterprint = () => {
    if (pdfPrintFallbackActive) {
        cleanupPdfPrintFallback();
    }
};

function exportPdfControlled() {
    populatePrintMeta();
    updateOrderTable();

    const pdfNode = createPdfExportNode();
    document.body.appendChild(pdfNode);

    const opt = {
        margin:       [10, 10, 10, 10], // mm
        filename:     'pedido_hiperroll.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    // Provide visual feedback by disabling the button
    const btn = document.querySelector('.btn-export');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Gerando PDF...';
    }

    // Delay briefly to allow DOM updates/styles to apply
    setTimeout(() => {
        try {
            if (typeof html2pdf === 'undefined') {
                throw new Error('html2pdf not available');
            }

            html2pdf().set(opt).from(pdfNode).save().then(() => {
                document.body.removeChild(pdfNode);
                if (btn) { btn.disabled = false; btn.textContent = '🖨️ Exportar Pedido (PDF)'; }
            }).catch((err) => {
                console.error('html2pdf error:', err);
                if (btn) { btn.disabled = false; btn.textContent = '🖨️ Exportar Pedido (PDF)'; }
                enablePdfPrintFallback(pdfNode);
                window.print();
            });
        } catch (e) {
            console.warn('Export fallback, reason:', e.message);
            if (btn) { btn.disabled = false; btn.textContent = '🖨️ Exportar Pedido (PDF)'; }
            enablePdfPrintFallback(pdfNode);
            window.print();
        }
    }, 250);
}
// ========== FUNÇÕES DE STATUS E HISTÓRICO ==========

function changeOrderStatus(newStatus) {
    statusManager.changeStatus(newStatus);
}

function showStatusHistory() {
    const modal = document.getElementById('statusHistoryModal');
    const historyList = document.getElementById('statusHistoryList');
    
    const history = statusManager.getFormattedHistory();
    
    if (history.length === 0) {
        historyList.innerHTML = '<div style="padding: 10px; text-align: center; color: #999;">Nenhum histórico disponível</div>';
    } else {
        let html = '';
        const sortedHistory = [...history].reverse();
        sortedHistory.forEach((entry, idx) => {
            const isFirst = idx === 0;
            const statusIcon = {
                'rascunho': '📝',
                'analise': '🔍',
                'aprovado': '✅',
                'rejeitado': '❌'
            }[entry.statusNovo] || '•';
            
            const bgColor = {
                'rascunho': '#fef3c7',
                'analise': '#dbeafe',
                'aprovado': '#dcfce7',
                'rejeitado': '#fee2e2'
            }[entry.statusNovo] || '#f3f4f6';
            
            html += `
                <div style="padding: 12px; border-bottom: 1px solid #eee; background: ${bgColor}; margin-bottom: 8px; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 1rem;">
                                ${statusIcon} ${entry.labelStatus}
                            </div>
                            <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
                                ${entry.dataFormatada}
                            </div>
                            ${entry.usuario && entry.usuario !== 'Sistema' ? `
                                <div style="font-size: 0.85rem; color: #666;">
                                    Usuário: <strong>${entry.usuario}</strong>
                                </div>
                            ` : ''}
                            ${entry.razao ? `
                                <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
                                    Motivo: <em>${entry.razao}</em>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        historyList.innerHTML = html;
    }
    
    modal.style.display = 'flex';
}

function closeStatusHistory() {
    const modal = document.getElementById('statusHistoryModal');
    modal.style.display = 'none';
}

// The browser downloads the file directly; the session cookie authorizes it (gestor/admin only).
function exportPortalBackup() {
    if (!authManager.canManageUsers()) {
        alert('Somente o gestor ou o administrador podem baixar o backup.');
        return;
    }
    window.location.href = `${API_BASE}?action=backup.export`;
}

window.exportPortalBackup = exportPortalBackup;

// Fechar modal ao clicar fora
window.addEventListener('load', function() {
    const modal = document.getElementById('statusHistoryModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeStatusHistory();
            }
        });
    }
});

// ===== Tema Claro / Escuro =====
function applyThemeIcon(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
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
        if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
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
    if (msg) {
        msg.style.display = 'block';
        msg.textContent = message || 'Não foi possível carregar o login.';
    }
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
        showLoginError(`Erro ao carregar o sistema: ${event.message || 'verifique o arquivo script_v5.js'}`);
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
        if (btn) btn.style.display = forced ? 'none' : '';
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
    container.innerHTML = '<div class="empty-state">Carregando usuários...</div>';
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
        const lastLogin = user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pt-BR') : 'Nunca';
        const status = user.active
            ? (user.mustChangePassword ? '<span class="user-status user-status--pending">Senha provisória</span>' : '<span class="user-status user-status--active">Ativo</span>')
            : '<span class="user-status user-status--inactive">Desativado</span>';
        const roleCell = isAdmin && !isSelf
            ? `<select class="user-role-select" onchange="changeUserRole(${user.id}, this.value)">${Object.values(ROLES).map(role =>
                `<option value="${role}" ${role === user.role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`).join('')}</select>`
            : escapeHtml(ROLE_LABELS[user.role] || user.role);
        const actions = manageable
            ? `<button class="btn-modal btn-modal-ghost btn-sm" onclick="toggleUserActive(${user.id}, ${!user.active})">${user.active ? 'Desativar' : 'Reativar'}</button>
               <button class="btn-modal btn-modal-ghost btn-sm" onclick="resetUserPassword(${user.id}, ${escapeHtml(JSON.stringify(user.displayName))})">Redefinir senha</button>`
            : (isSelf ? '<span class="user-self-note">Você</span>' : '');
        return `
            <tr class="${user.active ? '' : 'user-row--inactive'}">
                <td><strong>${escapeHtml(user.displayName)}</strong></td>
                <td>${escapeHtml(user.username)}</td>
                <td>${roleCell}</td>
                <td>${status}</td>
                <td>${escapeHtml(lastLogin)}</td>
                <td class="users-actions">${actions}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="users-table">
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
            msg.textContent = `✓ Usuário ${data.user.username} criado. Passe a senha provisória para ele: no primeiro acesso o sistema pedirá uma senha pessoal.`;
            msg.style.color = 'var(--success)';
        }
        await refreshUsersTable();
    } catch (e) {
        if (msg) {
            msg.textContent = e.message;
            msg.style.color = '';
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

function getCurrentUserDrafts() {
    if (!authManager.getCurrentUser()) return [];

    return orderSubmissionManager.getOwnSubmissions()
        .filter(submission => submission.status === 'rascunho')
        .sort((a, b) => new Date(b.savedAt || b.submittedAt || 0) - new Date(a.savedAt || a.submittedAt || 0));
}

function renderDraftsPanel() {
    const panel = document.getElementById('draftsPanelContent');
    const badge = document.getElementById('draftsPanelBadge');
    if (!panel) return;

    const drafts = getCurrentUserDrafts();
    if (badge) {
        badge.textContent = `${drafts.length} rascunho(s)`;
    }

    if (drafts.length === 0) {
        panel.innerHTML = '<div style="padding:14px; border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; color:#64748b; text-align:center;">Nenhum rascunho salvo ainda. Quando você salvar o pedido atual, ele aparecerá aqui para continuar ou enviar.</div>';
        return;
    }

    panel.innerHTML = drafts.map(draft => {
        const isActive = draft.id === activeDraftId;
        const savedDate = draft.savedAt ? new Date(draft.savedAt).toLocaleString('pt-BR') : '---';
        const itemCount = (draft.cart || []).reduce((sum, item) => sum + (item.qty || 0), 0);
        const orderNumber = draft.orderNumber || '(Sem número)';
        const clientName = draft.clientName || '(Não informado)';
        const averageMargin = orderSubmissionManager.calculateMargin(draft);
        const marginStatus = getMarginStatus(averageMargin);
        // Build collapsible items table HTML (show first 3 rows, hide rest)
        let visibleRows = '';
        let hiddenRows = '';
        if (draft.cart && draft.cart.length) {
            draft.cart.forEach((item, idx) => {
                const qty = item.qty || 0;
                const unit = parseFloat(item.negotiatedPrice || item.cif || 0) || 0;
                const subtotal = unit * qty;
                const shortDesc = (item.descricao || '').replace(/"/g, '');
                const rowHtml = `<tr><td>${item.codigo}</td><td>${shortDesc}</td><td style="width:70px; text-align:center">${qty}</td><td style="width:120px; text-align:right">R$ ${unit.toFixed(2)}</td><td style="width:120px; text-align:right">R$ ${subtotal.toFixed(2)}</td></tr>`;
                if (idx < 3) visibleRows += rowHtml; else hiddenRows += rowHtml;
            });

            const hiddenSection = hiddenRows ? `<tbody id="draftHidden_${draft.id}" class="draft-hidden-rows">${hiddenRows}</tbody>` : '';

            itemsHtml = `
                <table class="draft-items-table">
                    <thead>
                        <tr>
                            <th style="width:12%">Cód</th>
                            <th>Descrição</th>
                            <th style="width:70px; text-align:center">Qtd</th>
                            <th style="width:120px; text-align:right">Valor Unit.</th>
                            <th style="width:120px; text-align:right">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visibleRows}
                    </tbody>
                    ${hiddenSection}
                </table>
                <div class="draft-items-total">Total c/ condições: R$ ${calculateOrderTotals(draft.cart, draft.conditions).totalInvoice.toFixed(2)}</div>
            `;
        } else {
            itemsHtml = '<div style="margin-top:10px; color:#64748b;">Sem itens no rascunho.</div>';
        }

        // Toggle button (only if there are hidden rows)
        const toggleBtn = (hiddenRows) ? `<button class="draft-toggle-btn" id="draftToggle_${draft.id}" onclick="toggleDraftItems('${draft.id}')">+</button>` : '';

        return `
            <div class="draft-card ${isActive ? 'active' : ''}">
                <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div class="draft-card-title">${orderNumber}</div>
                        ${toggleBtn}
                    </div>
                    <div class="draft-card-meta">Cliente: <strong>${clientName}</strong></div>
                    <div class="draft-card-meta">Itens: <strong>${itemCount}</strong> • Salvo em: <strong>${savedDate}</strong></div>
                    <div class="draft-card-meta">Margem: <strong style="color:${marginStatus.color};">${averageMargin.toFixed(2)}%</strong> <span style="color:${marginStatus.color}; font-weight:700;">${marginStatus.label}</span></div>
                    ${itemsHtml}
                </div>
                <div class="draft-card-actions">
                    <button class="btn-load" onclick="loadDraftToCurrentOrder('${draft.id}', true)">Carregar</button>
                    <button class="btn-send" onclick="prepareDraftForSubmission('${draft.id}')">Enviar</button>
                    <button class="btn-delete" onclick="deleteSubmission('${draft.id}')">Excluir</button>
                    <button class="btn-load" onclick="showDraftModal('${draft.id}')" style="background:#64748b; margin-left:6px;">Ver</button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleDraftItems(draftId) {
    const hidden = document.getElementById('draftHidden_' + draftId);
    const btn = document.getElementById('draftToggle_' + draftId);
    if (!hidden || !btn) return;
    if (hidden.style.display === 'none' || hidden.style.display === '') {
        hidden.style.display = 'table-row-group';
        btn.textContent = '−';
    } else {
        hidden.style.display = 'none';
        btn.textContent = '+';
    }
}

function showDraftModal(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    // Remove existing modal if present
    const existing = document.getElementById('draftModalBackdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'draftModalBackdrop';
    backdrop.className = 'draft-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'draft-modal';

    let itemsHtml = '<table class="draft-items-table"><thead><tr><th>Cód</th><th>Descrição</th><th>Qtd</th><th>Valor Unit.</th><th>Subtotal</th></tr></thead><tbody>';
    (submission.cart || []).forEach(item => {
        const qty = item.qty || 0;
        const unit = parseFloat(item.negotiatedPrice || item.cif || 0) || 0;
        const subtotal = unit * qty;
        itemsHtml += `<tr><td>${item.codigo}</td><td>${(item.descricao||'').replace(/"/g,'')}</td><td style="text-align:center">${qty}</td><td style="text-align:right">R$ ${unit.toFixed(2)}</td><td style="text-align:right">R$ ${subtotal.toFixed(2)}</td></tr>`;
    });
    itemsHtml += `</tbody></table><div class="draft-items-total">Total c/ condições: R$ ${calculateOrderTotals(submission.cart, submission.conditions).totalInvoice.toFixed(2)}</div>`;

    let invoicesHtml = '';
    if (submission.invoices && submission.invoices.length) {
        invoicesHtml = '<div style="margin-top:12px;"><strong>Notas Fiscais anexadas:</strong><div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">';
        submission.invoices.forEach((inv, idx) => {
            const name = inv.name || `NF_${idx+1}`;
            const href = inv.data || '';
            invoicesHtml += `<a class="invoice-link" href="${href}" download="${name}_${submission.orderNumber || ''}">${name}</a>`;
        });
        invoicesHtml += '</div></div>';
    }

    modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"><h3>Pedido: ${submission.orderNumber || '(Sem número)'}</h3><button onclick="document.getElementById('draftModalBackdrop').remove()" style="background:none; border:none; font-size:20px; cursor:pointer;">✕</button></div>
        <div><strong>Cliente:</strong> ${submission.clientName || '(Não informado)'}</div>
        <div style="margin-top:10px;">${itemsHtml}</div>
        ${invoicesHtml}
        <div style="margin-top:14px; display:flex; justify-content:flex-end;"><button onclick="document.getElementById('draftModalBackdrop').remove()" style="padding:8px 12px; background:#ccc; border:none; border-radius:6px; cursor:pointer;">Fechar</button></div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}

function populateSubmitOrderDraftSelection() {
    const select = document.getElementById('submitDraftSelect');
    if (!select) return;

    const drafts = getCurrentUserDrafts();
    const currentValue = activeDraftId && drafts.some(draft => draft.id === activeDraftId) ? activeDraftId : '';

    select.innerHTML = '<option value="__new__">Enviar como novo pedido</option>' + drafts.map(draft => {
        const label = `${draft.orderNumber || '(Sem número)'} • ${draft.clientName || '(Não informado)'}`;
        return `<option value="${draft.id}" ${currentValue === draft.id ? 'selected' : ''}>${label}</option>`;
    }).join('');

    if (currentValue) {
        select.value = currentValue;
    } else {
        select.value = '__new__';
    }
}

function prepareDraftForSubmission(submissionId) {
    loadDraftToCurrentOrder(submissionId, true);
    const select = document.getElementById('submitDraftSelect');
    if (select) {
        select.value = submissionId;
    }
    setTimeout(() => showSubmitOrderModal(), 60);
}

// ===== Funções de Submissão de Pedidos =====
function showSubmitOrderModal() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de enviar.');
        return;
    }

    populateSubmitOrderDraftSelection();

    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '';
    
    // Usar número do cliente se preenchido, senão usar Hiper Roll
    const orderNumber = orderNumberClient || orderNumberHiperroll;
    
    if (!orderNumber) {
        alert('Insira um número de pedido antes de enviar.');
        return;
    }

    const clientName = document.getElementById('clientName')?.value.trim() || '';
    const submitOrderNumber = document.getElementById('submitOrderNumber');
    const submitClientName = document.getElementById('submitClientName');
    const submitItemCount = document.getElementById('submitItemCount');
    const submitTotalCif = document.getElementById('submitTotalCif');

    if (submitOrderNumber) submitOrderNumber.textContent = orderNumber;
    if (submitClientName) submitClientName.textContent = clientName || '(Não informado)';
    if (submitItemCount) submitItemCount.textContent = cart.length;

    const totals = calculateOrderTotals(cart, getCurrentOrderConditions());
    if (submitTotalCif) submitTotalCif.textContent = `R$ ${totals.totalInvoice.toFixed(2)}`;

    const discountParts = describeOrderDiscounts(totals.conditions);
    const submitDiscounts = document.getElementById('submitDiscounts');
    if (submitDiscounts) {
        submitDiscounts.textContent = discountParts.length
            ? `${totals.discountPercent.toFixed(2)}% (${discountParts.join(' + ')})`
            : 'Nenhum';
    }

    const submitMargin = document.getElementById('submitMargin');
    if (submitMargin) submitMargin.textContent = `${totals.margin.toFixed(2)}% (${totals.status.label})`;

    const summaryBox = document.getElementById('submitSummaryBox');
    const summaryTitle = document.getElementById('submitSummaryTitle');
    if (summaryBox) summaryBox.classList.toggle('is-warning', totals.belowMinimum);
    if (summaryTitle) {
        summaryTitle.textContent = totals.belowMinimum
            ? `⚠️ Margem abaixo do mínimo de ${totals.conditions.minMargin}%`
            : '✓ Pedido está pronto para envio';
    }

    const lowMarginBlock = document.getElementById('submitLowMarginBlock');
    const justificationInput = document.getElementById('submitLowMarginJustification');
    if (lowMarginBlock) lowMarginBlock.hidden = !totals.belowMinimum;
    if (justificationInput && !totals.belowMinimum) justificationInput.value = '';

    const modal = document.getElementById('submitOrderModal');
    if (modal) modal.style.display = 'flex';
}

function closeSubmitOrderModal() {
    const modal = document.getElementById('submitOrderModal');
    if (modal) modal.style.display = 'none';
    const msg = document.getElementById('submitOrderMessage');
    if (msg) msg.textContent = '';
}

async function submitOrder() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de enviar.');
        return;
    }

    const selectedDraftValue = document.getElementById('submitDraftSelect')?.value || '';
    const draftIdToUse = selectedDraftValue && selectedDraftValue !== '__new__' ? selectedDraftValue : null;
    const msg = document.getElementById('submitOrderMessage');
    const submitButton = document.querySelector('#submitOrderModal .btn-modal-danger');
    if (submitButton) submitButton.disabled = true;

    try {
        const order = await orderSubmissionManager.submitOrder(draftIdToUse, buildCurrentOrderInput({
            lowMarginJustification: document.getElementById('submitLowMarginJustification')?.value || ''
        }));

        try {
            statusManager.addHistoryEntry('analise', 'Enviado para análise', authManager.getCurrentUser());
            statusManager.currentStatus = 'analise';
            statusManager.updateUI();
        } catch (e) {
            console.warn('Não foi possível registrar histórico de envio:', e);
        }

        closeSubmitOrderModal();
        resetCurrentOrderForm();
        alert(`Pedido ${order.orderNumber} enviado com sucesso! Aguardando aprovação do gestor.`);
        const historySearchInput = document.getElementById('historySearchInput');
        if (historySearchInput) historySearchInput.value = '';
        switchTab('tab-history');
        setTimeout(() => highlightHistoryCard(order.id), 250);
    } catch (e) {
        if (msg) {
            msg.textContent = e.message;
            msg.style.color = '#b91c1c';
        }
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function resetCurrentOrderForm() {
    activeDraftId = null;
    setLoadedOrderReference('');
    cart.length = 0;
    updateOrderTable();
    ['orderNumberClient', 'clientName', 'proposalValidity'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    const representativeInput = document.getElementById('representativeName');
    if (representativeInput) representativeInput.value = authManager.getDisplayName();
    setCurrentOrderConditions(null);
    const justificationInput = document.getElementById('submitLowMarginJustification');
    if (justificationInput) justificationInput.value = '';
    hiperrollOrderNumberManager.applyToForm();
    renderDraftsPanel();
}

async function saveDraftCurrentOrder() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de salvar o rascunho.');
        return;
    }

    try {
        const order = await orderSubmissionManager.saveDraft(activeDraftId, buildCurrentOrderInput());
        activeDraftId = order.id;
        const hiperrollField = document.getElementById('orderNumberHiperroll');
        if (hiperrollField) hiperrollField.value = order.hiperrollNumber;
        setLoadedOrderReference(order.orderNumber);
        updateHeaderInfo();
        renderDraftsPanel();
        renderHistoryTab();
        try {
            statusManager.addHistoryEntry('rascunho', 'Rascunho salvo', authManager.getCurrentUser());
            statusManager.currentStatus = 'rascunho';
            statusManager.updateUI();
        } catch (e) {
            console.warn('Não foi possível registrar histórico do rascunho:', e);
        }
        alert(`Rascunho ${order.orderNumber} salvo com sucesso. Ele já está disponível no painel de rascunhos.`);
    } catch (e) {
        alert(e.message);
    }
}

function loadDraftToCurrentOrder(submissionId, silent = false) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        alert('Rascunho não encontrado.');
        return;
    }

    activeDraftId = submissionId;
    setLoadedOrderReference(submission.orderNumber || '');
    const hiperrollField = document.getElementById('orderNumberHiperroll');
    if (hiperrollField) hiperrollField.value = submission.hiperrollNumber || '';
    document.getElementById('orderNumberClient').value = submission.clientOrderNumber || '';
    document.getElementById('clientName').value = submission.clientName || '';
    document.getElementById('representativeName').value = submission.representativeName || '';
    document.getElementById('proposalValidity').value = submission.proposalValidity || '';
    setCurrentOrderConditions(submission.conditions);
    cart.length = 0;
    (Array.isArray(submission.cart) ? submission.cart : []).forEach(item => cart.push(JSON.parse(JSON.stringify(item))));
    updateOrderTable();
    updateHeaderInfo();
    renderDraftsPanel();
    closeOrderHistoryModal();
    if (!silent) {
        alert('Rascunho carregado. Edite o pedido ou envie quando estiver pronto.');
    }
}

function repeatOrder(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        alert('Pedido não encontrado.');
        return;
    }

    activeDraftId = null;
    setLoadedOrderReference('');
    hiperrollOrderNumberManager.applyToForm();
    document.getElementById('orderNumberClient').value = submission.clientOrderNumber || '';
    document.getElementById('clientName').value = submission.clientName || '';
    document.getElementById('representativeName').value = submission.representativeName || authManager.getDisplayName();
    document.getElementById('proposalValidity').value = normalizeProposalValidity(submission.proposalValidity || '');
    setCurrentOrderConditions(submission.conditions);
    cart.length = 0;
    (Array.isArray(submission.cart) ? submission.cart : []).forEach(item => cart.push(JSON.parse(JSON.stringify(item))));
    updateOrderTable();
    renderDraftsPanel();
    closeOrderHistoryModal();
    switchTab('tab-order');
    alert('Pedido repetido como novo pedido. Ajuste os dados se necessário e envie novamente.');
}

function showOrderHistoryModal() {
    switchTab('tab-history');
    renderHistoryTab();
}

function highlightHistoryCard(submissionId) {
    const card = document.getElementById(`historyCard_${submissionId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('history-card-highlight');
    setTimeout(() => card.classList.remove('history-card-highlight'), 5000);
}

function closeOrderHistoryModal() {
    const modal = document.getElementById('orderHistoryModal');
    if (modal) modal.style.display = 'none';
}

function afterOrdersChanged() {
    renderDraftsPanel();
    renderHistoryTab();
    updateTrashBadge();
    updateSupervisorPanel();
}

// Other users change orders too (e.g. the gestor approving), so the list can be refreshed on demand.
async function reloadOrders() {
    try {
        await loadServerData();
        afterOrdersChanged();
    } catch (e) {
        alert(e.message);
    }
}

async function deleteSubmission(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        alert('Pedido não encontrado.');
        return;
    }

    let confirmMsg = 'Deseja realmente excluir este pedido? Ele ficará na Lixeira e poderá ser restaurado.';
    if (submission.status === 'analise') {
        confirmMsg += '\n\n⚠️ Este pedido está em análise: ele continua visível para o gestor dar andamento.';
    } else if (submission.status === 'aprovado') {
        confirmMsg += '\n\n⚠️ Este pedido já foi aprovado: ele continua visível para o gestor, para rastreamento.';
    }
    if (!confirm(confirmMsg)) return;

    try {
        await orderSubmissionManager.moveToTrash(submissionId);
        if (activeDraftId === submissionId) {
            activeDraftId = null;
        }
        afterOrdersChanged();
        alert('Pedido movido para a Lixeira.');
        showOrderHistoryModal();
    } catch (e) {
        alert(e.message);
    }
}

async function deleteSelectedSubmissions() {
    const selected = Array.from(document.querySelectorAll('.history-selection-checkbox:checked')).map(input => input.value);
    if (selected.length === 0) {
        alert('Selecione ao menos um pedido para excluir.');
        return;
    }
    if (!confirm(`Deseja mover os ${selected.length} pedido(s) selecionado(s) para a Lixeira?`)) return;

    try {
        const count = await orderSubmissionManager.moveToTrash(selected);
        afterOrdersChanged();
        alert(`${count} pedido(s) movido(s) para a Lixeira.`);
        showOrderHistoryModal();
    } catch (e) {
        alert(e.message);
    }
}

// ========== FUNÇÕES DE GERENCIAMENTO DE LIXEIRA ==========
function showTrashModal() {
    const deletedSubmissions = deletedSubmissionsManager.getAll();
    
    if (deletedSubmissions.length === 0) {
        alert('Nenhum pedido foi excluído ainda.');
        return;
    }

    let html = `
    <div style="max-height: 600px; overflow-y: auto;">
    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
        <thead style="position: sticky; top: 0; background: var(--card-bg);">
            <tr style="background: var(--surface-2); border-bottom: 2px solid var(--border); color: var(--text);">
                <th style="padding: 10px; text-align: center; width: 30px;"></th>
                <th style="padding: 10px; text-align: left;">Nº Pedido</th>
                <th style="padding: 10px; text-align: left;">Cliente</th>
                <th style="padding: 10px; text-align: left;">Status</th>
                <th style="padding: 10px; text-align: left;">Faturamento</th>
                <th style="padding: 10px; text-align: left;">Excluído em</th>
                <th style="padding: 10px; text-align: left;">Excluído por</th>
                <th style="padding: 10px; text-align: center;">Ações</th>
            </tr>
        </thead>
        <tbody>
    `;

    deletedSubmissions.forEach(deletion => {
        const deletedDate = new Date(deletion.deletedAt).toLocaleString('pt-BR');
        const status = {
            'rascunho': '📝 Rascunho',
            'analise': '🔍 Em Análise',
            'aprovado': '✅ Aprovado',
            'rejeitado': '❌ Rejeitado'
        }[deletion.status] || deletion.status;
        
        // Determinar status de faturamento
        let billingBadge = '---';
        if (deletion.billedQuantities && Object.keys(deletion.billedQuantities).length > 0) {
            // Verificar se é completo ou parcial
            let totalPedido = 0;
            let totalFaturado = 0;
            (Array.isArray(deletion.cart) ? deletion.cart : []).forEach(item => {
                totalPedido += item.qty || 0;
                totalFaturado += deletion.billedQuantities[item.codigo] || 0;
            });
            
            if (totalFaturado === totalPedido) {
                billingBadge = '✅ Completo';
            } else {
                billingBadge = '📦 Parcial';
            }
        }

        html += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; text-align: center;">
                    <button onclick="toggleTrashDetails('${deletion.id}')" class="trash-expand-btn" data-id="${deletion.id}" style="background: none; border: none; cursor: pointer; font-size: 1rem; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">▶</button>
                </td>
                <td style="padding: 10px;"><strong>${deletion.orderNumber || '---'}</strong></td>
                <td style="padding: 10px;">${deletion.clientName || '---'}</td>
                <td style="padding: 10px;">${status}</td>
                <td style="padding: 10px;">${billingBadge}</td>
                <td style="padding: 10px;">${deletedDate}</td>
                <td style="padding: 10px;">${deletion.deletedBy || 'Sistema'}</td>
                <td style="padding: 10px; text-align: center;">
                    <button onclick="restoreSubmission('${deletion.id}')" style="background: #059669; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; margin-right: 6px;">↩️ Restaurar</button>
                    <button onclick="permanentlyDeleteSubmission('${deletion.id}')" style="background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">🗑️ Deletar</button>
                </td>
            </tr>
            <tr id="trash-details-${deletion.id}" style="display: none; background: #f9fafb;">
                <td colspan="7" style="padding: 20px; border-bottom: 2px solid #e5e7eb;">
                    <div id="trash-details-content-${deletion.id}"></div>
                </td>
            </tr>
        `;
    });

    html += `
        </tbody>
    </table>
    </div>
    `;

    const trashContent = document.getElementById('trashContent');
    if (trashContent) {
        trashContent.innerHTML = html;
        document.getElementById('trashModal').style.display = 'flex';
    }
}

function toggleTrashDetails(deletionId) {
    const detailsRow = document.getElementById(`trash-details-${deletionId}`);
    const deletion = deletedSubmissionsManager.getById(deletionId);
    
    if (!detailsRow) return;
    
    const btn = document.querySelector(`[data-id="${deletionId}"]`);
    
    if (detailsRow.style.display === 'none') {
        // Expandir
        detailsRow.style.display = 'table-row';
        renderTrashDetails(deletionId, deletion);
        
        // Mudar o ícone
        if (btn) {
            btn.textContent = '▼';
        }
    } else {
        // Colapsar
        detailsRow.style.display = 'none';
        
        // Mudar o ícone de volta
        if (btn) {
            btn.textContent = '▶';
        }
    }
}

function renderTrashDetails(deletionId, deletion) {
    const contentDiv = document.getElementById(`trash-details-content-${deletionId}`);
    if (!contentDiv || !deletion || !deletion.cart) return;

    let html = `
        <div>
            <h4 style="margin: 0 0 15px; color: var(--text); font-size: 1rem;">
                📦 Produtos do Pedido ${deletion.orderNumber}
            </h4>

            <div style="background: var(--card-bg); border-radius: 6px; border: 1px solid var(--border); overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; color: var(--text);">
                    <thead>
                        <tr style="background: var(--surface-2); border-bottom: 1px solid var(--border);">
                            <th style="padding: 10px; text-align: left;">Produto</th>
                            <th style="padding: 10px; text-align: center;">Qtd</th>
                            <th style="padding: 10px; text-align: center;">Qtd Faturada</th>
                            <th style="padding: 10px; text-align: right;">Valor Unit.</th>
                            <th style="padding: 10px; text-align: right;">Subtotal</th>
                            <th style="padding: 10px; text-align: center;">Margem</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    let totalValue = 0;
    deletion.cart.forEach(item => {
        const qty = item.qty || item.quantity || 0;
        const negotiatedPrice = item.negotiatedPrice || item.finalPrice || 0;
        const itemTotal = negotiatedPrice * qty;
        totalValue += itemTotal;
        
        // Quantidade faturada (verificar billedQuantities)
        const billedQty = deletion.billedQuantities?.[item.codigo] || 0;
        const pendingQty = qty - billedQty;
        
        // Calcular margem: ((negotiatedPrice - fob) / negotiatedPrice) * 100
        let marginPercent = 0;
        if (item.fob && negotiatedPrice > 0) {
            marginPercent = ((negotiatedPrice - item.fob) / negotiatedPrice) * 100;
        }
        
        const marginColor = getMarginStatus(marginPercent, normalizeOrderConditions(deletion.conditions).minMargin).color;
        
        // Cor para a quantidade faturada (verde se completo, amarelo se parcial, cinza se nenhum)
        const billingColor = billedQty === qty ? '#15803d' : billedQty > 0 ? '#f59e0b' : '#9ca3af';
        
        html += `
            <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 10px;">
                    <strong>${item.codigo}</strong> - ${item.descricao || ''}
                </td>
                <td style="padding: 10px; text-align: center;">${qty}</td>
                <td style="padding: 10px; text-align: center; color: ${billingColor}; font-weight: 600;">
                    ${billedQty} ${pendingQty > 0 ? `<span style="font-size: 0.85rem; color: var(--text-secondary);">/ ${qty}</span>` : ''}
                </td>
                <td style="padding: 10px; text-align: right;">R$ ${negotiatedPrice.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 10px; text-align: right; font-weight: 600;">R$ ${itemTotal.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 10px; text-align: center; color: ${marginColor}; font-weight: 600;">
                    ${marginPercent.toFixed(2)}%
                </td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 15px; padding: 12px; background: var(--card-bg); border-radius: 6px; border-left: 4px solid var(--secondary); color: var(--text);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: 600;">Total do Pedido:</span>
                    <span style="font-weight: 600; color: var(--text);">R$ ${totalValue.toFixed(2).replace('.', ',')}</span>
                </div>

                ${deletion.billedQuantities && Object.keys(deletion.billedQuantities).length > 0 ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding: 8px; background: #f0fdf4; border-radius: 4px; border-left: 3px solid #15803d;">
                    <span style="font-weight: 600; color: #15803d;">Status de Faturamento:</span>
                    <span style="font-weight: 600; color: #15803d;">✅ Faturado (parcial/completo)</span>
                </div>
                ` : ''}

                ${deletion.representativeName ? `
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--text-secondary);">
                    <span>Representante:</span>
                    <span>${deletion.representativeName}</span>
                </div>
                ` : ''}
                ${deletion.submittedAt ? `
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--text-secondary);">
                    <span>Criado em:</span>
                    <span>${new Date(deletion.submittedAt).toLocaleString('pt-BR')}</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    contentDiv.innerHTML = html;
}

function closeTrashModal() {
    const modal = document.getElementById('trashModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function restoreSubmission(submissionId) {
    if (!confirm('Deseja restaurar este pedido como rascunho?')) return;

    try {
        await deletedSubmissionsManager.restore(submissionId);
        afterOrdersChanged();
        alert('Pedido restaurado como rascunho.');
        closeTrashModal();
        if (deletedSubmissionsManager.count() > 0) showTrashModal();
    } catch (e) {
        alert(e.message);
    }
}

async function permanentlyDeleteSubmission(submissionId) {
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita. O pedido será excluído definitivamente.')) return;

    try {
        await deletedSubmissionsManager.permanentlyDelete(submissionId);
        updateTrashBadge();
        alert('Pedido excluído definitivamente.');
        closeTrashModal();
        if (deletedSubmissionsManager.count() > 0) showTrashModal();
    } catch (e) {
        alert(e.message);
    }
}

async function emptyTrash() {
    const count = deletedSubmissionsManager.count();
    if (count === 0) {
        alert('A lixeira já está vazia.');
        return;
    }
    if (!confirm(`Tem certeza? Os pedidos da lixeira serão excluídos definitivamente. Esta ação não pode ser desfeita.`)) return;

    try {
        const result = await deletedSubmissionsManager.emptyTrash();
        closeTrashModal();
        afterOrdersChanged();
        let message = `${result.deleted} pedido(s) excluído(s) definitivamente.`;
        if (result.kept > 0) {
            message += `\n\n${result.kept} pedido(s) em análise ou aprovados foram mantidos: somente o gestor pode excluí-los.`;
        }
        alert(message);
    } catch (e) {
        alert(e.message);
    }
}

function updateTrashBadge() {
    const trashBtn = document.querySelector('[onclick="showTrashModal()"]');
    if (!trashBtn) return;
    
    const count = deletedSubmissionsManager.count();
    if (count > 0) {
        let badge = trashBtn.querySelector('.trash-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'trash-badge';
            badge.style.cssText = 'display:inline-block; background:#fca5a5; color:#991b1b; font-weight:700; font-size:0.75rem; padding:2px 6px; border-radius:999px; margin-left:4px;';
            trashBtn.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        const badge = trashBtn.querySelector('.trash-badge');
        if (badge) badge.remove();
    }
}
// ===================================================


function showSubmissionDetails(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    const averageMargin = orderSubmissionManager.calculateMargin(submission);
    const marginStatus = getMarginStatus(averageMargin);
    const statusLabel = {
        'rascunho': 'Rascunho',
        'analise': 'Em Análise',
        'aprovado': 'Aprovado',
        'rejeitado': 'Rejeitado'
    }[submission.status] || submission.status;

    const timestamp = submission.status === 'rascunho' ? submission.savedAt : submission.submittedAt;
    const dateLabel = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : '---';

    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const discountParts = describeOrderDiscounts(pricing.conditions);

    alert(`Pedido: ${submission.orderNumber}
Cliente: ${submission.clientName}
Representante: ${submission.representativeName}
Criado por: ${submission.submittedBy || submission.savedBy || '(Sem usuário)'}
Status: ${statusLabel}
Descontos: ${discountParts.length ? `${pricing.discountPercent.toFixed(2)}% (${discountParts.join(' + ')})` : 'Nenhum'}
Margem do pedido: ${averageMargin.toFixed(2)}% (${marginStatus.label})
Valor Total do Pedido: R$ ${pricing.totalInvoice.toFixed(2)}
${pricing.belowMinimum ? `Justificativa (margem abaixo do mínimo): ${pricing.conditions.lowMarginJustification || '(não informada)'}\n` : ''}
${submission.status === 'rascunho' ? 'Salvo em:' : 'Enviado em:'} ${dateLabel}
${submission.rejectionReason ? `Motivo da Rejeição: ${submission.rejectionReason}
` : ''}${submission.supervisorNote ? `Observação do Supervisor: ${submission.supervisorNote}` : ''}`);
}

function openSupervisorOrderActions(submissionId) {
    // Procurar pedido nos ativos primeiro, depois na trash
    let submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        submission = deletedSubmissionsManager.getById(submissionId);
    }
    
    if (!submission) return;
    if (!authManager.isGestor()) {
        alert('Acesso negado. Somente o gestor pode gerenciar este pedido.');
        return;
    }

    const existing = document.getElementById('supervisorActionModalBackdrop');
    if (existing) existing.remove();

    const statusLabel = {
        'rascunho': 'Rascunho',
        'analise': 'Em Análise',
        'aprovado': 'Aprovado',
        'rejeitado': 'Rejeitado'
    }[submission.status] || submission.status;

    const timestamp = submission.status === 'rascunho' ? submission.savedAt : submission.submittedAt;
    const dateLabel = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : '---';

    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    let itemsHtml = `<table class="draft-items-table" style="width:100%; margin-top:10px;"><thead><tr><th>Cód</th><th>Descrição</th><th>Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Margem</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>`;
    pricing.lines.forEach(line => {
        const item = line.item;
        const marginColor = getMarginStatus(line.marginPercent, pricing.conditions.minMargin).color;
        itemsHtml += `<tr><td>${item.codigo}</td><td>${(item.descricao || '').replace(/"/g, '')}</td><td style="text-align:center">${line.qty}</td><td style="text-align:right">R$ ${line.negotiatedUnit.toFixed(2)}</td><td style="text-align:right; color:${marginColor}; font-weight:600;">${line.marginPercent.toFixed(2)}%</td><td style="text-align:right">R$ ${line.subtotal.toFixed(2)}</td></tr>`;
    });
    itemsHtml += `</tbody></table><div style="text-align:right; margin-top:10px; font-weight:700;">Total: R$ ${pricing.totalInvoice.toFixed(2)}</div>`;

    const backdrop = document.createElement('div');
    backdrop.id = 'supervisorActionModalBackdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText = 'display:flex; z-index:2001;';
    const canDecide = submission.status === 'analise';
    const decisionTitle = canDecide ? '' : 'title="Somente pedidos em análise podem ser aprovados ou rejeitados"';

    const approveBtnHtml = `<button onclick="handleSupervisorAction('${submission.id}', 'approve')" class="btn-modal btn-modal-success" ${canDecide ? '' : 'disabled'} ${decisionTitle}>✅ Aprovar</button>`;
    const rejectBtnHtml = `<button onclick="handleSupervisorAction('${submission.id}', 'reject')" class="btn-modal btn-modal-danger" ${canDecide ? '' : 'disabled'} ${decisionTitle}>❌ Rejeitar</button>`;

    backdrop.innerHTML = `
        <div class="modal-panel modal-panel--md">
            <div class="modal-header">
                <div class="modal-header-title">
                    <div class="modal-icon-badge">🧑‍💼</div>
                    <div>
                        <h3 class="modal-title">Ações do Supervisor</h3>
                        <p class="modal-subtitle">
                            Pedido: <strong>${submission.orderNumber || '(Sem número)'}</strong> &bull;
                            Cliente: <strong>${submission.clientName || '(Não informado)'}</strong><br>
                            Enviado por: <strong>${submission.submittedBy || submission.savedBy || '(Sem usuário)'}</strong> &bull;
                            Status: <strong>${statusLabel}</strong> &bull;
                            ${submission.status === 'rascunho' ? 'Salvo em' : 'Enviado em'}: <strong>${dateLabel}</strong>
                        </p>
                    </div>
                </div>
                <button onclick="closeSupervisorActionModal()" class="modal-close-btn" aria-label="Fechar">✕</button>
            </div>
            <div class="modal-body">
                ${renderOrderConditionsSummary(submission)}
                ${itemsHtml}
                <div style="margin-top:20px; display:grid; gap:14px;">
                    <div>
                        <label>Observação do Supervisor</label>
                        <textarea id="supervisorActionNote" style="min-height:100px; resize:vertical;">${submission.supervisorNote || ''}</textarea>
                    </div>
                    <div>
                        <label>Motivo da Rejeição</label>
                        <textarea id="supervisorActionRejectionReason" placeholder="Preencha apenas se for rejeitar." style="min-height:100px; resize:vertical;">${submission.rejectionReason || ''}</textarea>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="handleSupervisorAction('${submission.id}', 'saveNote')" class="btn-modal btn-modal-primary">💬 Salvar Observação</button>
                ${approveBtnHtml}
                ${rejectBtnHtml}
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);
}

async function handleSupervisorAction(submissionId, action) {
    const note = document.getElementById('supervisorActionNote')?.value.trim() || '';
    const reason = document.getElementById('supervisorActionRejectionReason')?.value.trim() || '';

    if (action === 'reject' && !reason) {
        alert('Informe o motivo da rejeição antes de rejeitar o pedido.');
        return;
    }

    try {
        if (action === 'approve') {
            await orderSubmissionManager.approve(submissionId, note);
            alert('Pedido aprovado com sucesso.');
        } else if (action === 'reject') {
            await orderSubmissionManager.reject(submissionId, reason, note);
            alert('Pedido rejeitado com sucesso.');
        } else if (action === 'saveNote') {
            await orderSubmissionManager.setSupervisorNote(submissionId, note);
            alert('Observação salva com sucesso.');
        }
    } catch (e) {
        alert(e.message);
        return;
    }

    closeSupervisorActionModal();
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) searchInput.value = '';
    renderHistoryTab();
    updateSupervisorPanel();
}

function closeSupervisorActionModal() {
    const modal = document.getElementById('supervisorActionModalBackdrop');
    if (modal) modal.remove();
}

function showSupervisorPanel() {
    const modal = document.getElementById('supervisorModal');
    if (!modal) { console.error('supervisorModal não encontrado no HTML'); return; }
    modal.style.display = 'flex';
    try {
        updateSupervisorPanel();
    } catch(e) {
        console.error('Erro ao atualizar painel supervisor:', e);
        const list = document.getElementById('supervisorPendingOrdersList');
        if (list) list.innerHTML = '<div style="padding:15px; text-align:center; color:#c53030;">Erro ao carregar pedidos. Verifique o console (F12).</div>';
    }
}

function closeSupervisorPanel() {
    const modal = document.getElementById('supervisorModal');
    if (!modal) return;
    modal.style.display = 'none';
}

function refreshMissedForecastDates() {
    const syncForecast = (collection) => {
        if (!Array.isArray(collection)) return;
        collection.forEach(submission => {
            if (!submission || submission.status !== 'aprovado' || submission.billingStatus === 'completo' || !submission.predictedBillingDate) return;
            const predictedDate = new Date(submission.predictedBillingDate);
            if (Number.isNaN(predictedDate.getTime())) return;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const predictedDay = new Date(predictedDate);
            predictedDay.setHours(0, 0, 0, 0);
            if (today > predictedDay) {
                const nextDate = new Date(predictedDate.getTime() + (5 * 24 * 60 * 60 * 1000));
                submission.predictedBillingDate = nextDate.toISOString();
            }
        });
    };

    // Display-only: the overdue forecast is pushed forward on screen, the stored date is untouched.
    syncForecast(orderSubmissionManager.getAll());
    syncForecast(deletedSubmissionsManager.getAll());
}

function updateSupervisorPanel() {
    refreshMissedForecastDates();
    const modal = document.getElementById('supervisorModal');
    const btn = document.getElementById('supervisorBtn');
    if (btn) {
        btn.style.display = authManager.isGestor() ? 'inline-flex' : 'none';
    }
    if (!modal) return;

    // Atualizar lista de pedidos enviados
    const pendingList = document.getElementById('supervisorPendingOrdersList');
    if (pendingList) {
        // Obter pedidos pendentes ativos
        let pending = orderSubmissionManager.getPending();
        
        // Adicionar pedidos deletados que estejam em análise ou aprovados
        const deletedInAnalysis = deletedSubmissionsManager.getAll().filter(deletion => 
            ['analise', 'aprovado'].includes(deletion.status)
        );
        
        // Combinar e remover duplicatas
        const allPending = [...pending, ...deletedInAnalysis];
        const uniquePending = allPending.filter((item, index, self) => 
            index === self.findIndex(t => t.id === item.id)
        );
        pending = uniquePending.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        
        if (pending.length === 0) {
            const emptyMessage = authManager.isGestor()
                ? 'Nenhum pedido aguardando aprovação no momento.'
                : 'Somente o gestor visualiza a fila de aprovação.';
            pendingList.innerHTML = `<div style="padding:15px; text-align:center; color:#64748b;">${emptyMessage}</div>`;
        } else {
            let html = '<div style="display:flex; flex-direction:column; gap:12px;">';
            
            pending.forEach((submission, idx) => {
                const cartArray = Array.isArray(submission.cart) ? submission.cart : [];
                const totalItems = cartArray.reduce((sum, item) => sum + (item.qty || 0), 0);
                const submittedDate = new Date(submission.submittedAt).toLocaleString('pt-BR');
                
                // Verificar se foi deletado
                const isDeleted = !orderSubmissionManager.getById(submission.id);
                const deletedBadge = isDeleted ? '🗑️ Deletado' : '';
                const pendingPricing = calculateOrderTotals(submission.cart, submission.conditions);
                const lowMarginBadge = pendingPricing.belowMinimum
                    ? `<span class="low-margin-badge" title="${escapeHtml(pendingPricing.conditions.lowMarginJustification || 'Sem justificativa')}">⚠️ Margem ${pendingPricing.margin.toFixed(2)}%</span>`
                    : '';
                const bgColor = isDeleted ? '#fef2f2' : '#fafafa';
                const borderColor = isDeleted ? '#fecaca' : '#ddd';
                
                html += `
                    <div style="border:1px solid ${borderColor}; border-radius:8px; padding:15px; background:${bgColor}; display:flex; align-items:center; justify-content:space-between; gap:15px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display:flex; align-items:center; gap:15px; flex:1;">
                            <input type="checkbox" class="pending-order-checkbox" value="${submission.id}" style="width:20px; height:20px; flex-shrink:0; margin:0; cursor:pointer;">
                            <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <div style="font-weight:700; font-size:1.05rem; color:#0f172a;">
                                    Pedido: ${submission.orderNumber} ${deletedBadge} ${lowMarginBadge}
                                </div>
                                <div style="font-size:0.9rem; color:#475569;">
                                    Cliente: <strong style="color:#1e293b;">${submission.clientName}</strong> &bull; Enviado por: <strong>${submission.submittedBy}</strong> &bull; Em: <strong>${submittedDate}</strong> &bull; Itens: <strong>${totalItems}</strong>
                                </div>
                            </div>
                        </div>
                        <button onclick="showPendingOrderDetails('${submission.id}')" style="background:#0f172a; color:white; padding:8px 14px; border:none; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:600; flex-shrink:0;">Ver Detalhes</button>
                    </div>
                `;
            });
            
            html += '</div>';
            html += `
                <div style="margin-top:15px; padding-top:15px; border-top:1px solid #ddd; display:grid; gap:12px;">
                    <textarea id="supervisorObservationTextarea" placeholder="Observação do supervisor (opcional)..." style="width:100%; min-height:60px; padding:10px; border:1px solid #ddd; border-radius:6px; font-family:inherit; resize:vertical;"></textarea>
                    <textarea id="rejectionReasonTextarea" placeholder="Motivo da rejeição (somente para rejeitar)..." style="width:100%; min-height:60px; padding:10px; border:1px solid #ddd; border-radius:6px; font-family:inherit; resize:vertical;"></textarea>
                    <div style="display:flex; gap:10px; justify-content:flex-end;">
                        <button onclick="approvePendingOrders()" style="padding:10px 16px; background:#10b981; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;">✅ Aprovar Selecionados</button>
                        <button onclick="rejectPendingOrders()" style="padding:10px 16px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;">❌ Rejeitar Selecionados</button>
                    </div>
                </div>
            `;
            
            pendingList.innerHTML = html;
        }
    }
}

function getSelectedPendingOrders() {
    const checkboxes = document.querySelectorAll('.pending-order-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function describeDecisionResult(verb, result) {
    const done = (result.orders || []).length;
    let message = `${done} pedido(s) ${verb} com sucesso!`;
    if (result.skipped > 0) {
        message += `\n\n${result.skipped} pedido(s) foram ignorados porque não estavam mais em análise.`;
    }
    return message;
}

async function approvePendingOrders() {
    const selected = getSelectedPendingOrders();
    if (selected.length === 0) {
        alert('Selecione ao menos um pedido para aprovar.');
        return;
    }

    const supervisorNote = document.getElementById('supervisorObservationTextarea')?.value.trim() || '';
    try {
        const result = await orderSubmissionManager.approve(selected, supervisorNote);
        updateSupervisorPanel();
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) searchInput.value = '';
        renderHistoryTab();
        alert(describeDecisionResult('aprovado(s)', result));
    } catch (e) {
        alert(e.message);
    }
}

async function rejectPendingOrders() {
    const selected = getSelectedPendingOrders();
    if (selected.length === 0) {
        alert('Selecione ao menos um pedido para rejeitar.');
        return;
    }
    const reason = document.getElementById('rejectionReasonTextarea')?.value.trim() || '';
    if (!reason) {
        alert('Insira um motivo para a rejeição.');
        return;
    }

    const supervisorNote = document.getElementById('supervisorObservationTextarea')?.value.trim() || '';
    try {
        const result = await orderSubmissionManager.reject(selected, reason, supervisorNote);
        updateSupervisorPanel();
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) searchInput.value = '';
        renderHistoryTab();
        alert(describeDecisionResult('rejeitado(s)', result));
    } catch (e) {
        alert(e.message);
    }
}

function showPendingOrderDetails(submissionId) {
    // Procurar pedido nos ativos primeiro, depois na trash
    let submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        submission = deletedSubmissionsManager.getById(submissionId);
    }
    if (!submission) return;

    const averageMargin = orderSubmissionManager.calculateMargin(submission);
    const orderMarginStatus = getMarginStatus(averageMargin);

    const existing = document.getElementById('detailsModalBackdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'detailsModalBackdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText = 'display:flex; z-index:2005;';

    let itemsHtml = `
        <div style="max-height: 400px; overflow-y: auto; margin-top: 15px; border: 1px solid #e2e8f0; border-radius: 6px;">
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                <thead style="background:#f8fafc; position:sticky; top:0;">
                    <tr>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid #e2e8f0;">Cód</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid #e2e8f0;">Descrição</th>
                        <th style="padding:10px; text-align:center; border-bottom:1px solid #e2e8f0;">Qtd</th>
                        <th style="padding:10px; text-align:center; border-bottom:1px solid #e2e8f0;">Qtd Faturada</th>
                        <th style="padding:10px; text-align:right; border-bottom:1px solid #e2e8f0;">Preço (CIF)</th>
                        <th style="padding:10px; text-align:right; border-bottom:1px solid #e2e8f0;">Margem</th>
                        <th style="padding:10px; text-align:right; border-bottom:1px solid #e2e8f0;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
    `;

    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const totalCif = pricing.totalInvoice;
    pricing.lines.forEach(line => {
        const item = line.item;
        const qty = line.qty;
        const negotiatedPrice = line.negotiatedUnit;
        const subtotal = line.subtotal;
        const marginPercent = line.marginPercent;
        const itemMarginColor = getMarginStatus(marginPercent, pricing.conditions.minMargin).color;
        const billedQty = Math.min(submission.billedQuantities?.[item.codigo] || 0, qty);
        const billingColor = billedQty >= qty ? '#15803d' : billedQty > 0 ? '#b45309' : '#64748b';
        
        itemsHtml += `
            <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px;">${item.codigo}</td>
                <td style="padding:10px;">${(item.descricao||'').replace(/"/g,'')}</td>
                <td style="padding:10px; text-align:center; font-weight:600;">${qty}</td>
                <td style="padding:10px; text-align:center; color:${billingColor}; font-weight:600;">${billedQty}/${qty}</td>
                <td style="padding:10px; text-align:right;">R$ ${negotiatedPrice.toFixed(2)}</td>
                <td style="padding:10px; text-align:right; color:${itemMarginColor}; font-weight:600;">${marginPercent.toFixed(2)}%</td>
                <td style="padding:10px; text-align:right; font-weight:600;">R$ ${subtotal.toFixed(2)}</td>
            </tr>
        `;
    });

    itemsHtml += `
                </tbody>
            </table>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; padding:15px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0;">
            <div>
                <span style="color:#475569; font-size:0.9rem;">Margem do Pedido:</span><br>
                <strong style="color:${orderMarginStatus.color}; font-size:1.1rem;">${averageMargin.toFixed(2)}%</strong>
                <span style="color:${orderMarginStatus.color}; font-weight:600; font-size:0.9rem;">(${orderMarginStatus.label})</span>
            </div>
            <div style="text-align:right;">
                <span style="color:#475569; font-size:0.9rem;">Valor Total:</span><br>
                <strong style="font-size:1.2rem; color:#0f172a;">R$ ${totalCif.toFixed(2)}</strong>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal-panel modal-panel--lg';

    const submittedDate = new Date(submission.submittedAt).toLocaleString('pt-BR');

    modal.innerHTML = `
        <div class="modal-header">
            <div class="modal-header-title">
                <div class="modal-icon-badge">📋</div>
                <div>
                    <h3 class="modal-title">Detalhes do Pedido: ${submission.orderNumber}</h3>
                    <p class="modal-subtitle">
                        Enviado por <strong>${submission.submittedBy}</strong> em <strong>${submittedDate}</strong> para o cliente <strong>${submission.clientName}</strong><br>
                        Validade da proposta: <strong>${submission.proposalValidity || 'Não informada'}</strong>
                    </p>
                </div>
            </div>
            <button onclick="document.getElementById('detailsModalBackdrop').remove()" class="modal-close-btn" aria-label="Fechar">✕</button>
        </div>
        <div class="modal-body">
            ${renderOrderConditionsSummary(submission)}
            ${itemsHtml}
        </div>
        <div class="modal-footer">
            <button onclick="document.getElementById('detailsModalBackdrop').remove()" class="btn-modal btn-modal-primary">Fechar</button>
        </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}

// ==========================================

// ========================================

// ==========================================
// TABS E HISTÓRICO MELHORADO
// ==========================================

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => {
        t.classList.remove('active');
        t.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
        targetTab.classList.add('active');
        targetTab.style.display = 'block';
    }
    const btn = document.getElementById('btn-' + tabId);
    if (btn) btn.classList.add('active');

    if (tabId === 'tab-history') {
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        renderHistoryTab();
    }
}

function renderHistoryTab() {
  try {
    refreshMissedForecastDates();
    const historyContainer = document.getElementById('historyTabContent');
    if (!historyContainer) { console.error('historyTabContent não encontrado'); return; }
    const searchTerm = (document.getElementById('historySearchInput')?.value || '').toLowerCase();
    
    const isGestor = authManager.isGestor();

    // The server already returns only what this user may see (gestor: everyone's orders).
    let submissions = orderSubmissionManager.getAll();

    // Sort por data mais recente
    submissions.sort((a, b) => {
        const dateA = new Date(a.submittedAt || a.savedAt || 0);
        const dateB = new Date(b.submittedAt || b.savedAt || 0);
        return dateB - dateA;
    });

    if (searchTerm) {
        submissions = submissions.filter(s => 
            (s.orderNumber && s.orderNumber.toLowerCase().includes(searchTerm)) ||
            (s.clientName && s.clientName.toLowerCase().includes(searchTerm)) ||
            (s.submittedBy && s.submittedBy.toLowerCase().includes(searchTerm)) ||
            (s.savedBy && s.savedBy.toLowerCase().includes(searchTerm)) ||
            (s.id && s.id.toLowerCase().includes(searchTerm))
        );
    }

    const roleNote = isGestor
        ? 'Como gestor, você vê os pedidos de todos os representantes.'
        : 'Você vê apenas os seus próprios pedidos e rascunhos.';

    if (submissions.length === 0) {
        const emptyMessage = authManager.getCurrentUser()
            ? 'Nenhum pedido encontrado.'
            : 'Faça login para carregar o histórico de pedidos.';
        historyContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #64748b;">${emptyMessage}</div>`;
        return;
    }

    let html = '';
    html += `<div style="padding:12px 14px; margin-bottom:12px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc; color:#0f172a; font-size:0.95rem;">
        ${roleNote}
    </div>`;
    submissions.forEach(submission => {
        const isDraft = submission.status === 'rascunho';
        const dateStr = new Date(submission.submittedAt || submission.savedAt).toLocaleString('pt-BR');
        
        let statusBadge = '';
        if(isDraft) statusBadge = `<span style="background:#f1f5f9; padding:4px 8px; border-radius:4px; font-weight:600;">📝 Rascunho</span>`;
        else if(submission.status === 'analise') statusBadge = `<span style="background:#fef3c7; color:#92400e; padding:4px 8px; border-radius:4px; font-weight:600;">🔍 Em Análise</span>`;
        else if(submission.status === 'aprovado') statusBadge = `<span style="background:#dcfce7; color:#15803d; padding:4px 8px; border-radius:4px; font-weight:600;">✅ Aprovado</span>`;
        else if(submission.status === 'rejeitado') statusBadge = `<span style="background:#fee2e2; color:#b91c1c; padding:4px 8px; border-radius:4px; font-weight:600;">❌ Rejeitado</span>`;

        let billingBadge = '';
        const billingStatus = submission.billingStatus || (submission.status === 'aprovado' ? 'pendente' : null);
        if (billingStatus) {
            if (billingStatus === 'completo') billingBadge = `<span class="billing-progress complete">✅ Faturado completamente</span>`;
            else if (billingStatus === 'parcial') billingBadge = `<span class="billing-progress partial">📦 Faturado parcialmente</span>`;
            else if (billingStatus === 'pendente') billingBadge = `<span class="billing-progress pending">⏳ Aguardando faturamento</span>`;
        }

        const predictedBillingDateValue = submission.predictedBillingDate ? new Date(submission.predictedBillingDate) : null;
        const predictedBillingDate = predictedBillingDateValue && !Number.isNaN(predictedBillingDateValue.getTime())
            ? predictedBillingDateValue.toLocaleDateString('pt-BR')
            : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isForecastOverdue = Boolean(
            predictedBillingDateValue &&
            submission.status === 'aprovado' &&
            billingStatus !== 'completo' &&
            !Number.isNaN(predictedBillingDateValue.getTime()) &&
            today > new Date(predictedBillingDateValue.getFullYear(), predictedBillingDateValue.getMonth(), predictedBillingDateValue.getDate())
        );
        let predictedBillingBadge = '';
        if (predictedBillingDate && submission.status === 'aprovado' && billingStatus !== 'completo') {
            predictedBillingBadge = isForecastOverdue
                ? `<span style="background:#fee2e2; color:#991b1b; padding:4px 8px; border-radius:4px; font-weight:700; display:inline-block; border:1px solid #fecaca;">⚠️ Faturamento em atraso: ${predictedBillingDate}</span>`
                : `<span style="background:#e0f2fe; color:#0369a1; padding:4px 8px; border-radius:4px; font-weight:600; display:inline-block;">📅 Previsão faturamento: ${predictedBillingDate}</span>`;
        }

        const averageMargin = orderSubmissionManager.calculateMargin(submission);
        const marginStatus = getMarginStatus(averageMargin);

        const hasBillingInfo = submission.billedQuantities && Object.keys(submission.billedQuantities).length > 0;
        const cartArray = Array.isArray(submission.cart) ? submission.cart : [];
        const totalOrdered = cartArray.reduce((sum, item) => sum + (item.qty || 0), 0);
        const totalBilled = cartArray.reduce((sum, item) => sum + ((submission.billedQuantities && submission.billedQuantities[item.codigo]) || 0), 0);

        const pricing = calculateOrderTotals(cartArray, submission.conditions);
        const totalCif = pricing.totalInvoice;

        let billingSummaryHtml = '';
        if (billingStatus) {
            billingSummaryHtml = `<div style="margin-top:12px; font-size:0.95rem; color:#334155;"><strong>Faturamento:</strong> ${totalBilled} / ${totalOrdered} unidades</div>`;
        }

        let predictedBillingHtml = '';
        if (submission.status === 'aprovado' && billingStatus !== 'completo' && predictedBillingDate) {
            predictedBillingHtml = isForecastOverdue
                ? `<div style="margin-top:8px; font-size:0.95rem; color:#7f1d1d; background:#fee2e2; border:1px solid #fecaca; padding:8px 10px; border-radius:6px; font-weight:700;"><strong>Faturamento em atraso:</strong> ${predictedBillingDate}</div>`
                : `<div style="margin-top:8px; font-size:0.95rem; color:#334155;"><strong>Previsão de faturamento:</strong> ${predictedBillingDate}</div>`;
        }

        let itemsHtml = `
            <table class="history-item-table">
                <tr>
                    <th>Item</th>
                    <th>Qtd Pedida</th>
                    ${hasBillingInfo || submission.status === 'aprovado' ? '<th>Qtd Faturada</th>' : ''}
                    <th>Valor Unit. (Negociado)</th>
                    <th>Margem</th>
                    <th>Subtotal</th>
                </tr>
        `;
        
        pricing.lines.forEach(line => {
            const item = line.item;
            const negotiated = line.negotiatedUnit;
            const subtotal = line.subtotal;
            const marginPercent = line.marginPercent;
            const itemMarginColor = getMarginStatus(marginPercent, pricing.conditions.minMargin).color;

            let billedStr = '';
            if (hasBillingInfo || submission.status === 'aprovado') {
                const billed = (submission.billedQuantities && submission.billedQuantities[item.codigo]) || 0;
                billedStr = `<td><strong>${billed} / ${item.qty}</strong></td>`;
            }

            itemsHtml += `
                <tr>
                    <td>${item.codigo} - ${item.descricao}</td>
                    <td>${item.qty}</td>
                    ${billedStr}
                    <td>R$ ${negotiated.toFixed(2)}</td>
                    <td style="text-align:center; color:${itemMarginColor};"><strong>${marginPercent.toFixed(2)}%</strong></td>
                    <td>R$ ${subtotal.toFixed(2)}</td>
                </tr>
            `;
        });
        itemsHtml += `</table>`;

        // Alertas de Rejeição/Supervisor
        let notesHtml = '';
        if (submission.status === 'rejeitado' && submission.rejectionReason) {
            notesHtml += `<div style="background:#fee2e2; border:1px solid #fca5a5; padding:10px; margin-top:10px; border-radius:6px;">
                <strong style="color:#b91c1c;">Motivo da Rejeição:</strong><br>
                ${submission.rejectionReason}
            </div>`;
        }
        if (submission.supervisorNote) {
            notesHtml += `<div style="background:#eff6ff; border:1px solid #bfdbfe; padding:10px; margin-top:10px; border-radius:6px;">
                <strong style="color:#1d4ed8;">Observação do Supervisor:</strong><br>
                ${submission.supervisorNote}
            </div>`;
        }

        // Histórico de Faturamento e Previsões
        let billingHistoryHtml = '';
        if (submission.billingHistory && submission.billingHistory.length > 0) {
            billingHistoryHtml += `<div style="margin-top:10px; padding:10px; background:#f8fafc; border-radius:6px;">
                <strong>Histórico de Faturamentos:</strong>
                <ul style="margin:5px 0 0 20px; font-size:0.9rem;">`;
            (Array.isArray(submission.billingHistory) ? submission.billingHistory : []).forEach(bh => {
                const bDate = new Date(bh.date).toLocaleDateString('pt-BR');
                const predDate = bh.predictedNextDate ? new Date(bh.predictedNextDate).toLocaleDateString('pt-BR') : 'Concluído';
                billingHistoryHtml += `<li>Faturado em ${bDate} | Previsão próxima etapa: <strong>${predDate}</strong></li>`;
            });
            billingHistoryHtml += `</ul></div>`;
        }

        // Notas Fiscais anexadas
        let invoicesHtml = '';
        if (submission.invoices && submission.invoices.length > 0) {
            invoicesHtml += `<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">`;
            (Array.isArray(submission.invoices) ? submission.invoices : []).forEach((inv, i) => {
                invoicesHtml += `<a href="${inv.data}" download="${inv.name}_${submission.orderNumber}.pdf" style="background:#1e293b; color:white; padding:6px 12px; border-radius:4px; text-decoration:none; font-size:0.85rem; font-weight:600;">📄 Baixar ${inv.name}</a>`;
            });
            invoicesHtml += `</div>`;
        }

        // Ações
        let actionsHtml = `<div style="margin-top:15px; display:flex; gap:10px; flex-wrap:wrap;">`;
        const isOwnOrder = submission.ownerId === authManager.getCurrentUserId();
        if (isDraft && isOwnOrder) {
            actionsHtml += `<button onclick="loadDraftToCurrentOrder('${submission.id}')" style="background:#0f172a; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">✏️ Continuar Rascunho</button>`;
        } else if (!isDraft) {
            actionsHtml += `<button onclick="repeatOrder('${submission.id}')" style="background:#64748b; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">🔁 Repetir Pedido</button>`;
        }

        if (isGestor) {
            if (submission.status === 'analise') {
                actionsHtml += `<button onclick="openSupervisorOrderActions('${submission.id}')" style="background:#0054A6; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">🧑‍💼 Analisar Pedido</button>`;
            }
            if (submission.status === 'aprovado' && submission.billingStatus !== 'completo') {
                actionsHtml += `<button onclick="openBillingModal('${submission.id}')" style="background:#0054A6; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">📦 Faturar / Anexar NF</button>`;
            }
        }
        
        actionsHtml += `<button onclick="deleteSubmission('${submission.id}')" style="background:#dc2626; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">🗑️ Excluir</button>`;
        actionsHtml += `</div>`;

        html += `
            <div id="historyCard_${submission.id}" style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; background: var(--card-bg); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                    <div>
                        <h3 style="margin:0 0 5px 0;">Pedido: ${submission.orderNumber || 'Sem número'}</h3>
                        <div style="font-size:0.95rem; color:#475569; line-height:1.4;">
                            ID: <strong style="color:#0f172a;">${submission.id}</strong><br>
                            Pedido: <strong>${submission.orderNumber || 'Sem número'}</strong><br>
                            Cliente: <strong>${submission.clientName || 'Não informado'}</strong><br>
                            Comprador / Usuário: <strong>${submission.submittedBy || submission.savedBy || '(Sem usuário)'}</strong><br>
                            Margem do pedido: <strong style="color:${marginStatus.color};">${averageMargin.toFixed(2)}%</strong> <span style="color:${marginStatus.color}; font-weight:700;">${marginStatus.label}</span><br>
                            Total do Pedido: <strong>R$ ${totalCif.toFixed(2)}</strong><br>
                            Data: ${dateStr}<br>
                            Validade da proposta: <strong>${normalizeProposalValidity(submission.proposalValidity || '') || 'Não informada'}</strong>
                        </div>
                    </div>
                    <div style="text-align:right; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                        ${statusBadge}
                        ${billingBadge}
                        ${predictedBillingBadge}
                    </div>
                </div>
                ${renderOrderConditionsSummary(submission)}
                ${itemsHtml}
                ${notesHtml}
                ${billingSummaryHtml}
                ${predictedBillingHtml}
                ${billingHistoryHtml}
                ${invoicesHtml}
                ${actionsHtml}
            </div>
        `;
    });

    historyContainer.innerHTML = html;
  } catch(e) {
    console.error('Erro ao renderizar histórico:', e);
    const hc = document.getElementById('historyTabContent');
    if (hc) hc.innerHTML = `<div style="padding:20px; text-align:center; color:#c53030;"><strong>Erro ao carregar histórico:</strong> ${e.message}<br>Abra o console (F12) para detalhes.</div>`;
  }
}

// Faturamento Modal (Supervisor)
function openBillingModal(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if(!submission) return;

    let itemsHtml = '';
    (Array.isArray(submission.cart) ? submission.cart : []).forEach((item, idx) => {
        const billed = (submission.billedQuantities && submission.billedQuantities[item.codigo]) || 0;
        const remaining = item.qty - billed;
        if (remaining > 0) {
            itemsHtml += `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">
                    <div style="flex:1;">
                        <strong>${item.codigo}</strong><br>
                        <small>${item.descricao}</small><br>
                        <small>Pedida: ${item.qty} | Já Faturada: ${billed} | Restante: ${remaining}</small>
                    </div>
                    <div>
                        <input type="number" id="billQty_${idx}" class="bill-qty-input" data-codigo="${item.codigo}" data-max="${remaining}" value="${remaining}" min="0" max="${remaining}" style="width:80px; padding:5px;">
                    </div>
                </div>
            `;
        }
    });

    // Construir Modal Dinamicamente
    const modalId = 'billingModalDynamic';
    let modal = document.getElementById(modalId);
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'display:flex; z-index:2000;';

    modal.innerHTML = `
        <div class="modal-panel modal-panel--sm">
            <div class="modal-header">
                <div class="modal-header-title">
                    <div class="modal-icon-badge">📦</div>
                    <div>
                        <h3 class="modal-title">Registrar Faturamento</h3>
                        <p class="modal-subtitle">Pedido: <strong>${submission.orderNumber}</strong></p>
                    </div>
                </div>
                <button onclick="document.getElementById('${modalId}').remove()" class="modal-close-btn" aria-label="Fechar">✕</button>
            </div>
            <div class="modal-body">
                <div>
                    ${itemsHtml}
                </div>
                <div style="margin-top:18px;">
                    <label>Anexar Nota Fiscal (PDF ou Imagem)</label>
                    <input type="file" id="billingInvoiceFile" accept="application/pdf,image/*">
                    <small style="color:var(--text-secondary); display:block; margin-top:6px;">*O arquivo será convertido para base64 e salvo (limite recomendado: 2MB).</small>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="document.getElementById('${modalId}').remove()" class="btn-modal btn-modal-ghost">Cancelar</button>
                <button onclick="submitBilling('${submissionId}')" class="btn-modal btn-modal-primary">Confirmar Faturamento</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo da nota fiscal.'));
        reader.readAsDataURL(file);
    });
}

async function submitBilling(submissionId) {
    const inputs = document.querySelectorAll('.bill-qty-input');
    const billedMap = {};
    let hasItems = false;

    inputs.forEach(inp => {
        const val = parseInt(inp.value) || 0;
        const code = inp.getAttribute('data-codigo');
        if (val > 0) {
            billedMap[code] = val;
            hasItems = true;
        }
    });

    const fileInput = document.getElementById('billingInvoiceFile');
    const file = fileInput.files[0];

    if (!hasItems && !file) {
        alert('Informe alguma quantidade ou anexe uma Nota Fiscal.');
        return;
    }
    if (file && file.size > 2 * 1024 * 1024) {
        alert('A nota fiscal deve ter no máximo 2 MB.');
        return;
    }

    try {
        const dataUrl = file ? await readFileAsDataUrl(file) : null;
        await orderSubmissionManager.registerBilling(submissionId, billedMap, dataUrl, file ? file.name : null);
        document.getElementById('billingModalDynamic').remove();
        renderHistoryTab();
        alert('Faturamento registrado com sucesso!');
    } catch (e) {
        alert(e.message);
    }
}
