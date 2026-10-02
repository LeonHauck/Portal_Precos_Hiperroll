// script.js

function parseCSV(csv, delimiter = ';') {
    const lines = csv.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/"/g, '')));
}

// Filled by applyCatalog() from the price table in use (see pricingCatalog below).
const productsData = [];
const freightData = {};
const costsData = {};
// Price table in use. source 'server' = database (editable by the gestor in the "Tabela de Preços" tab);
// 'legacy' = data.js, used only until the table is imported into the database.
let pricingCatalog = { source: 'none', imported: false, version: 0, canEdit: false, costLines: [], freight: [], products: [], warnings: [] };
let legacyCatalog = null;
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
    MIN_JUSTIFICATION_LENGTH: 10,
    // What leaves the invoice before it becomes margin, as in the cost spreadsheet (100% NF):
    // ICMS 12 + PIS 1,65 + COFINS 7,6 + comissão 3 + despesa financeira 3,26.
    SALE_DEDUCTIONS_PERCENT: 27.51
});

// minMargin comes from the products (each one has its own minimum, set in the price table).
// Green needs the general target AND the minimum, so a product whose minimum is above the
// target (e.g. 30%) never shows green while it is below its own minimum.
function getMarginStatus(margin, minMargin = PRICING_RULES.MIN_ORDER_MARGIN) {
    if (margin >= Math.max(PRICING_RULES.TARGET_MARGIN, minMargin)) {
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
        deductionsPercent: toPercent(c.deductionsPercent, PRICING_RULES.SALE_DEDUCTIONS_PERCENT),
        lowMarginJustification: String(c.lowMarginJustification || '').trim()
    };
}

function getOrderDiscountPercent(conditions) {
    const c = normalizeOrderConditions(conditions);
    return c.manualDiscount
        + (c.earlyPayment ? c.earlyPaymentPercent : 0)
        + (c.fobFreight ? c.fobFreightPercent : 0);
}

// "10" or "12,35": a minimum margin for messages (the order minimum is a weighted average).
function formatMarginPercent(value) {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// Net margin, the same way the cost spreadsheet forms a price (preço = custo ÷ (1 − margem − 27,51%)):
//
//   margem = (preço líquido − custo − deduções) ÷ valor da nota
//
// custo    = (custo do produto + desp. comercial + desp. administrativa) × peso, plus the region's
//            freight × peso — except when the order is "Frete FOB" (the customer pays the freight);
// deduções = SALE_DEDUCTIONS_PERCENT of the invoice (ICMS, PIS, COFINS, comissão, desp. financeira).
// The contract % raises the invoice, but Hiperroll pays that same amount out, so it adds
// nothing to the profit and lowers the margin percentage.
//
// Each product has its own minimum margin (item.minMargin, from the price table). The order's
// minimum is the average of those minimums weighted by each item's invoice value, which is the
// same as asking that the order's profit covers the minimum profit of every item added up.
//
// Items saved before 2026-10 carry neither cost nor minMargin: they keep the old rule
// (lucro = líquido − FOB, no deductions) and the order's stored minimum.
function calculateOrderTotals(items, conditions) {
    const c = normalizeOrderConditions(conditions);
    const discountPercent = getOrderDiscountPercent(c);
    const discountFactor = Math.max(1 - discountPercent / 100, 0);
    const contractFactor = 1 + c.contract / 100;

    const totals = { totalQty: 0, totalWeight: 0, totalFob: 0, totalGross: 0, totalNet: 0, totalInvoice: 0, totalProfit: 0 };
    let requiredProfit = 0;
    const lines = (Array.isArray(items) ? items : []).map(item => {
        const qty = parseFloat(item.qty) || 0;
        const fobUnit = parseFloat(item.fob) || 0;
        const negotiatedUnit = Math.max(parseFloat(item.negotiatedPrice || item.cif) || 0, 0);
        const netUnit = negotiatedUnit * discountFactor;
        const invoiceUnit = netUnit * contractFactor;

        const productCost = parseFloat(item.cost);
        const hasCost = Number.isFinite(productCost) && productCost > 0;
        const costUnit = hasCost ? productCost + (c.fobFreight ? 0 : (parseFloat(item.freightCost) || 0)) : fobUnit;
        const deductionsUnit = hasCost ? invoiceUnit * (c.deductionsPercent / 100) : 0;
        const profitUnit = netUnit - costUnit - deductionsUnit;
        const marginPercent = invoiceUnit > 0 ? (profitUnit / invoiceUnit) * 100 : 0;
        const itemMinMargin = parseFloat(item.minMargin);
        const minMargin = Number.isFinite(itemMinMargin) && itemMinMargin >= 0 ? itemMinMargin : c.minMargin;

        totals.totalQty += qty;
        totals.totalWeight += (parseFloat(item.weight) || 0) * qty;
        totals.totalFob += fobUnit * qty;
        totals.totalGross += negotiatedUnit * qty;
        totals.totalNet += netUnit * qty;
        totals.totalInvoice += invoiceUnit * qty;
        totals.totalProfit += profitUnit * qty;
        requiredProfit += (minMargin / 100) * invoiceUnit * qty;

        return { item, qty, fobUnit, negotiatedUnit, netUnit, invoiceUnit, costUnit, deductionsUnit, profitUnit, marginPercent, minMargin, subtotal: invoiceUnit * qty };
    });

    const margin = totals.totalInvoice > 0 ? (totals.totalProfit / totals.totalInvoice) * 100 : 0;
    // Rounded so float noise (10.000000000000002) never turns an exact-minimum order into "below".
    const minMargin = totals.totalInvoice > 0 ? Math.round((requiredProfit / totals.totalInvoice) * 1e6) / 1e4 : c.minMargin;
    return {
        ...totals,
        conditions: { ...c, minMargin },
        discountPercent,
        lines,
        margin,
        minMargin,
        belowMinimum: lines.length > 0 && margin < minMargin,
        status: getMarginStatus(margin, minMargin)
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
                <strong>⚠️ Margem abaixo do mínimo de ${formatMarginPercent(c.minMargin)}%</strong>
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
        const pricingTabBtn = document.getElementById('btn-tab-pricing');
        if (pricingTabBtn) pricingTabBtn.style.display = this.currentUser && this.canViewPricingAdmin() ? '' : 'none';

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
            minMargin: item.minMargin,
            cost: item.cost,
            freightCost: item.freightCost,
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

async function init() {
    orderManager.init();
    statusManager.init();

    applyPricingRuleLabels();
    updateMinMarginLabels(null);

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

    // Once the table is imported, prices come from the database; before that, from data.js.
    let serverCatalog = null;
    try {
        serverCatalog = await fetchPricingCatalog();
    } catch (e) {
        console.warn('Tabela de preços do servidor indisponível; usando data.js.', e);
    }

    // api/data.php only delivers data.js to a logged-in session, so a session created after the
    // page loaded needs one reload. The flag prevents a reload loop. Not needed after the import.
    const needsDataJs = !(serverCatalog && serverCatalog.imported);
    if (needsDataJs && (window.PORTAL_DATA_LOCKED !== false || typeof PRODUTOS_CSV === 'undefined')) {
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
    useCatalog(serverCatalog);

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
    startPricingWatcher();
}

// ========== TABELA DE PREÇOS (catálogo) ==========

function parseDecimal(value) {
    return parseFloat(String(value ?? '').replace(',', '.')) || 0;
}

// Price groups that are not in the cost spreadsheet (decided with Leon on 2026-10-01/02).
// Each one starts as an exact copy of the group that priced those products (`copyFrom`); from
// then on the gestor can adjust it on its own. `category` is the "Linha" column of the product
// spreadsheet (parseCSV drops the double quotes). By default only the products the keyword rule
// (getCategoryMatch) sends to `copyFrom` are moved; `all: true` moves the whole category, for
// categories whose name or descriptions would mislead the keyword rule.
const LEGACY_CATEGORY_LINES = [
    { category: 'Sacarias - Corte e Solda', name: 'Corte e Solda', copyFrom: 'fundo reto' },
    { category: 'Bobina Saco em Rolo - Condominio', name: 'Bobina Saco em Rolo - Condomínio', copyFrom: 'fundo reto', all: true },
    { category: 'Saco para lixo - Condominio', name: 'Saco para lixo - Condomínio', copyFrom: 'fundo reto', all: true },
    { category: 'Saco para Lixo - Dobrado', name: 'Saco para lixo - Dobrado', copyFrom: 'fundo reto' },
    { category: 'Saco para Lixo - Perfumado', name: 'Saco para lixo - Perfumado', copyFrom: 'fundo reto' },
    { category: 'Saco para lixo - Rolo', name: 'Saco para lixo - Rolo', copyFrom: 'fundo reto' },
    { category: 'Saco para lixo - Hospitalar', name: 'Saco para lixo - Hospitalar', copyFrom: 'fundo reto', all: true },
    { category: 'Bobina Fundo Reto', name: 'Bobina Fundo Reto', copyFrom: 'bobina estrela (cx branca)' }
];

// Columns of the product spreadsheet are found by header name, so a new or reordered column in
// the next spreadsheet doesn't break the portal. "Peso Caixa/Frd" appears twice (gross, then
// net): the last one is the net weight, which is what prices use.
function mapProductColumns(headerRow) {
    const names = headerRow.map(cell => cell.trim().toLowerCase());
    const first = name => names.indexOf(name);
    return {
        margem: first('margem'),
        linha: first('linha'),
        categoria: first('categoria'),
        codigo: first('cod. produto'),
        descricao: names.findIndex(name => name.startsWith('descri')),
        peso: names.lastIndexOf('peso caixa/frd'),
        ncm: first('ncm')
    };
}

// Reads data.js and returns it in the same shape as the server's pricing.get, so the rest of
// the code never needs to know where prices came from.
function buildLegacyCatalog() {
    const products = [];
    const warnings = [];
    const productRows = parseCSV(PRODUTOS_CSV);
    const headerIndex = productRows.findIndex(row => row.some(cell => cell.trim().toLowerCase() === 'cod. produto'));
    const cols = headerIndex >= 0 ? mapProductColumns(productRows[headerIndex]) : null;
    const seenCodes = new Set();
    const repeatedCodes = [];
    (cols ? productRows.slice(headerIndex + 1) : []).forEach(row => {
        const codigo = row[cols.codigo]?.trim() || '';
        const descricao = row[cols.descricao]?.trim() || '';
        if (!codigo || !descricao) return;
        const weight = parseDecimal(row[cols.peso]);
        if (weight === 0) return; // Skip zeroed products
        // The same code listed in two categories is one product: the first row wins.
        if (seenCodes.has(codigo)) {
            repeatedCodes.push(codigo);
            return;
        }
        seenCodes.add(codigo);
        // "10%" (or 0,1 if the cell came as a fraction); without the column, today's general minimum.
        let minMargin = cols.margem >= 0 ? parseDecimal(row[cols.margem]) : PRICING_RULES.MIN_ORDER_MARGIN;
        if (minMargin > 0 && minMargin <= 1 && !String(row[cols.margem]).includes('%')) minMargin *= 100;
        if (!(minMargin > 0)) minMargin = PRICING_RULES.MIN_ORDER_MARGIN;
        const product = { codigo, descricao, categoria: row[cols.linha] || '', subcat: row[cols.categoria] || '', weight, ncm: row[cols.ncm] || '', active: true, minMargin };
        product.costLineKey = getCategoryMatch(product);
        products.push(product);
    });
    if (repeatedCodes.length) {
        warnings.push(`A planilha repete o código de ${repeatedCodes.join(', ')} em duas categorias; o portal usa a primeira ocorrência.`);
    }

    // Colunas: B(1)=Linha, C(2)=Custo Prod, D(3)=Desp Com, E(4)=Desp Adm, M(12)=100% NF.
    // A line may appear twice in the spreadsheet; the row with the highest 100% NF wins.
    const costLines = {};
    parseCSV(BLENDAS_CSV).forEach(row => {
        if (row.length < 13) return;
        const name = row[1]?.trim() || '';
        const key = name.toLowerCase();
        const price100 = parseFloat(row[12]?.replace(',', '.')) || parseFloat(row[12]?.replace('R$', '').replace('.', '').replace(',', '.')) || 0;
        const costs = parseDecimal(row[2]) + parseDecimal(row[3]) + parseDecimal(row[4]);
        // costs > 0 skips the header row, whose "100% NF" label would otherwise parse as 100.
        if (!key || price100 <= 0 || costs <= 0) return;
        if (!costLines[key] || price100 > costLines[key].price100) {
            costLines[key] = {
                key,
                name,
                custoBase: parseDecimal(row[2]),
                despCom: parseDecimal(row[3]),
                despAdm: parseDecimal(row[4]),
                price100: Math.round(price100 * 10000) / 10000
            };
        }
    });

    // The first row of each UF is its capital; "interior"/"fluvial" rows are named. Any other
    // named city is treated as Interior and replaces it — reported in `warnings` for the gestor.
    const freight = {};
    let currentUF = '';
    let ufEntryCount = 0;
    parseCSV(FRETE_CSV).forEach(row => {
        if (row[0]?.includes('UF') || row[0]?.length !== 2) return;
        if (currentUF !== row[0]) {
            currentUF = row[0];
            ufEntryCount = 0;
        }
        const label = row[1] || '';
        const city = label.toLowerCase();
        let type = 'Interior';
        if (city.includes('fluvial')) {
            type = 'Fluvial';
        } else if (city.includes('interior')) {
            type = 'Interior';
        } else if (ufEntryCount === 0 || city.includes('capital') || city.includes('metropolitana')) {
            type = 'Capital';
        }
        const key = `${currentUF}/${type}`;
        if (freight[key]) {
            warnings.push(`${currentUF} · ${type}: a planilha tem duas linhas ("${freight[key].label}" e "${label}") e o portal usa a última, ${label} (R$ ${row[2]} / R$ ${row[3]} por kg). Ajuste na seção Frete se não for isso.`);
        }
        freight[key] = { uf: currentUF, pracaType: type, label, tier1: parseDecimal(row[2]), tier2: parseDecimal(row[3]) };
        ufEntryCount++;
    });

    LEGACY_CATEGORY_LINES.forEach(rule => {
        const source = costLines[rule.copyFrom];
        const category = rule.category.toLowerCase();
        const moved = products.filter(p => p.categoria.toLowerCase() === category && (rule.all || p.costLineKey === rule.copyFrom));
        if (!source || !moved.length) return;
        const key = rule.name.toLowerCase();
        costLines[key] = { ...source, key, name: rule.name };
        moved.forEach(p => { p.costLineKey = key; });
    });

    // Spreadsheet lines that no product uses stay out of the portal (they remain in data.js).
    const usedKeys = new Set(products.map(p => p.costLineKey));
    const allLines = Object.values(costLines);
    return {
        costLines: allLines.filter(line => usedKeys.has(line.key)),
        unusedLines: allLines.filter(line => !usedKeys.has(line.key)).map(line => line.name),
        freight: Object.values(freight),
        products,
        warnings
    };
}

function getLegacyCatalog() {
    if (!legacyCatalog && typeof PRODUTOS_CSV !== 'undefined' && typeof BLENDAS_CSV !== 'undefined' && typeof FRETE_CSV !== 'undefined') {
        legacyCatalog = buildLegacyCatalog();
    }
    return legacyCatalog;
}

async function fetchPricingCatalog() {
    const data = await apiRequest('pricing.get');
    return data.catalog;
}

// Rebuilds the in-memory lookups the screens use (productsData, costsData, freightData).
function applyCatalog(catalog) {
    pricingCatalog = catalog;
    productsData.length = 0;
    Object.keys(costsData).forEach(key => delete costsData[key]);
    Object.keys(freightData).forEach(uf => delete freightData[uf]);

    catalog.costLines.forEach(line => {
        const costs = line.custoBase + line.despCom + line.despAdm;
        costsData[line.key] = { ...line, costs, divisor: line.price100 > 0 ? costs / line.price100 : 0 };
    });
    catalog.freight.forEach(row => {
        if (!freightData[row.uf]) freightData[row.uf] = {};
        freightData[row.uf][row.pracaType] = { tier1: row.tier1, tier2: row.tier2, label: row.label };
    });
    catalog.products.forEach(p => {
        productsData.push({
            codigo: p.codigo,
            descricao: p.descricao,
            categoria: p.categoria,
            subcat: p.subcat,
            ncm: p.ncm,
            peso: p.weight,
            weightRaw: p.weight,
            costLineKey: p.costLineKey,
            priceOverride: p.priceOverride ?? null,
            minMargin: p.minMargin ?? PRICING_RULES.MIN_ORDER_MARGIN,
            active: p.active !== false
        });
    });
    populateStateSelect();
}

function useCatalog(serverCatalog) {
    if (serverCatalog && serverCatalog.imported) {
        applyCatalog({ ...serverCatalog, source: 'server', warnings: [] });
        return;
    }
    const legacy = getLegacyCatalog() || { costLines: [], freight: [], products: [], warnings: [] };
    applyCatalog({ ...legacy, source: 'legacy', imported: false, version: 0, canEdit: Boolean(serverCatalog && serverCatalog.canEdit) });
}

function populateStateSelect() {
    const select = document.getElementById('stateSelect');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Selecione um Estado</option>' + Object.keys(freightData).sort()
        .map(uf => `<option value="${escapeHtml(uf)}">${escapeHtml(uf)}</option>`).join('');
    if (current && freightData[current]) select.value = current;
}

function getCurrentRegionFilters() {
    return {
        uf: document.getElementById('stateSelect')?.value || '',
        cityType: document.getElementById('cityType')?.value || '',
        weightTier: document.getElementById('weightTier')?.value || ''
    };
}

// FOB = preço 100% NF × peso. CIF = (custos + frete da região) ÷ (custos ÷ preço 100% NF) × peso,
// i.e. the freight is added to the cost and gets the same markup. Same formulas as
// server_item_prices() in api/lib/catalog.php, which recalculates them when an order is saved.
// A product with an individual price (set by the gestor) uses price ÷ weight as its 100% NF price.
function computeItemPrices(product, { uf, cityType, weightTier } = {}) {
    const line = costsData[product.costLineKey];
    if (!line) return { fob: 0, cif: 0, rate: 0 };
    const hasOwnPrice = product.priceOverride != null && product.weightRaw > 0;
    const price100 = hasOwnPrice ? product.priceOverride / product.weightRaw : line.price100;
    const divisor = price100 > 0 ? line.costs / price100 : 0;
    const fob = hasOwnPrice ? product.priceOverride : price100 * product.weightRaw; // exact, no ÷ × rounding
    const fData = freightData[uf] ? freightData[uf][cityType] : null;
    const rate = fData ? (fData[weightTier] || 0) : 0;
    const cif = divisor > 0 ? (line.costs + rate) / divisor * product.weightRaw : 0;
    // cost and freightCost (per unit) are what the margin is measured against (calculateOrderTotals).
    return { fob, cif, rate, cost: line.costs * product.weightRaw, freightCost: rate * product.weightRaw };
}

// Refreshes whatever shows prices after the table changed. The price tab is not redrawn while
// the gestor has unsaved edits there, so an automatic refresh never wipes what they typed.
function afterCatalogChanged() {
    if (document.getElementById('stateSelect')?.value) updateResults();
    const pricingTab = document.getElementById('tab-pricing');
    if (pricingTab?.classList.contains('active') && !pricingTab.querySelector('.is-dirty')) renderPricingTab();
}

// Swaps the table in use; if its version changed, the order being built is reviewed.
async function applyServerCatalog(serverCatalog, reason) {
    const before = `${pricingCatalog.source}:${pricingCatalog.version}`;
    useCatalog(serverCatalog);
    afterCatalogChanged();
    if (`${pricingCatalog.source}:${pricingCatalog.version}` !== before) {
        await reviewCartPrices(reason);
    }
}

async function refreshPricingCatalog(reason = 'A tabela de preços foi atualizada pelo gestor.') {
    await applyServerCatalog(await fetchPricingCatalog(), reason);
}

// ----- Atualização automática -----
// Every open portal asks the server for the table version (a tiny answer) once a minute and
// when the browser tab comes back into view; the full table is only downloaded when it changed.
const PRICING_WATCH_INTERVAL_MS = 60 * 1000;
let pricingWatchTimer = null;
let pricingWatchBusy = false;

async function checkPricingVersion() {
    // Skip while a check is running, while the representative is answering the review modal,
    // or when nobody is logged in (the session may have expired).
    if (pricingWatchBusy || repriceModalResolver || !authManager.getCurrentUser()) return false;
    pricingWatchBusy = true;
    try {
        const data = await apiRequest('pricing.version');
        const source = data.imported ? 'server' : 'legacy';
        if (source === pricingCatalog.source && data.version === pricingCatalog.version) return false;
        await refreshPricingCatalog('A tabela de preços foi atualizada pelo gestor.');
        return true;
    } catch (e) {
        console.warn('Não foi possível verificar a versão da tabela de preços:', e);
        return false;
    } finally {
        pricingWatchBusy = false;
    }
}

function startPricingWatcher() {
    if (pricingWatchTimer) return;
    pricingWatchTimer = setInterval(() => {
        if (document.visibilityState === 'visible') checkPricingVersion();
    }, PRICING_WATCH_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkPricingVersion();
    });
}

// ----- "Avisar e atualizar": revisão de preços do pedido aberto -----

// Compares each cart item with the table in use. Items without a region (older drafts) only get
// their FOB updated, since their CIF depends on a region the portal didn't record.
function planCartRepricing(items) {
    const changes = [];
    const missing = [];
    items.forEach(item => {
        const product = productsData.find(p => p.codigo === item.codigo);
        if (!product || !product.active) {
            missing.push(item);
            return;
        }
        const prices = computeItemPrices(product, item);
        const newCif = item.uf ? prices.cif : item.cif;
        const changed = Math.abs(prices.fob - item.fob) >= 0.005 || Math.abs(newCif - item.cif) >= 0.005;
        changes.push({
            item, newFob: prices.fob, newCif, newWeight: product.weightRaw, changed,
            newMinMargin: product.minMargin,
            newCost: prices.cost,
            newFreightCost: item.uf ? prices.freightCost : (parseFloat(item.freightCost) || 0)
        });
    });
    return { changes, missing, hasDifferences: missing.length > 0 || changes.some(c => c.changed) };
}

// 'keep'  = the negotiated price stays; the discount against the new table is recalculated.
// 'table' = the same R$ discount as before is applied on top of the new table price.
function applyCartRepricing(plan, choice) {
    plan.changes.forEach(({ item, newFob, newCif, newWeight, newMinMargin, newCost, newFreightCost }) => {
        const previousDiscount = item.unitDiscount || 0;
        item.fob = newFob;
        item.cif = newCif;
        item.weight = newWeight;
        // Minimum margin and costs always follow the table in force, whatever the price choice.
        if (newMinMargin !== undefined) item.minMargin = newMinMargin;
        if (newCost !== undefined) {
            item.cost = newCost;
            item.freightCost = newFreightCost;
        }
        if (choice === 'table') {
            item.negotiatedPrice = Math.max(newCif - previousDiscount, 0);
        }
        item.unitDiscount = Math.max(newCif - item.negotiatedPrice, 0);
    });
    plan.missing.forEach(item => {
        const idx = cart.indexOf(item);
        if (idx >= 0) cart.splice(idx, 1);
    });
}

function previewRepricingMargin(plan, choice) {
    const clones = plan.changes.map(c => ({ ...c.item }));
    applyCartRepricing({ changes: plan.changes.map((c, i) => ({ ...c, item: clones[i] })), missing: [] }, choice);
    return calculateOrderTotals(clones, getCurrentOrderConditions()).margin;
}

async function reviewCartPrices(reason) {
    if (!cart.length) return 'none';
    const plan = planCartRepricing(cart);
    if (!plan.hasDifferences) {
        applyCartRepricing(plan, 'keep'); // only aligns sub-cent differences and weights
        updateOrderTable();
        return 'none';
    }
    const choice = await showRepriceModal(reason, plan);
    applyCartRepricing(plan, choice);
    updateOrderTable();
    return choice;
}

let repriceModalResolver = null;

function showRepriceModal(reason, plan) {
    const modal = document.getElementById('repriceModal');
    const body = document.getElementById('repriceModalBody');
    if (!modal || !body) {
        return Promise.resolve(confirm(`${reason}\n\nOK = usar os novos preços de tabela\nCancelar = manter os preços negociados`) ? 'table' : 'keep');
    }
    const money = value => `<span class="nowrap">R$ ${formatBRL(value)}</span>`;
    const arrow = (before, after) => Math.abs(before - after) < 0.005
        ? money(after)
        : `<span class="reprice-old">${money(before)}</span> → <strong>${money(after)}</strong>`;
    const rows = plan.changes.filter(c => c.changed).map(({ item, newFob, newCif }) => `
        <tr>
            <td><strong>${escapeHtml(item.codigo)}</strong><div class="reprice-desc">${escapeHtml(item.descricao || '')}</div></td>
            <td>${arrow(item.fob, newFob)}</td>
            <td>${arrow(item.cif, newCif)}</td>
            <td>${money(item.negotiatedPrice)}</td>
            <td>${money(Math.max(newCif - (item.unitDiscount || 0), 0))}</td>
        </tr>`).join('');
    const missing = plan.missing.length
        ? `<div class="pricing-warning"><strong>Saíram da tabela e serão retirados do pedido:</strong> ${plan.missing.map(i => escapeHtml(`${i.codigo} (${i.descricao || ''})`)).join(', ')}</div>`
        : '';

    document.getElementById('repriceReason').textContent = reason;
    document.getElementById('repriceKeepMargin').textContent = `${previewRepricingMargin(plan, 'keep').toFixed(2)}%`;
    document.getElementById('repriceTableMargin').textContent = `${previewRepricingMargin(plan, 'table').toFixed(2)}%`;
    body.innerHTML = `
        ${rows ? `<div class="results-table-container"><table class="pricing-table">
            <thead><tr><th>Produto</th><th>FOB</th><th>CIF de tabela</th><th>Seu preço hoje</th><th>Com a nova tabela</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : ''}
        ${missing}`;
    modal.style.display = 'flex';
    return new Promise(resolve => { repriceModalResolver = resolve; });
}

function resolveRepriceModal(choice) {
    const modal = document.getElementById('repriceModal');
    if (modal) modal.style.display = 'none';
    const resolve = repriceModalResolver;
    repriceModalResolver = null;
    if (resolve) resolve(choice);
}

function formatBRL(value, decimals = 2) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
        if (!p.active) return false; // inactive products only show up in the gestor's price tab
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

    filtered.forEach(p => {
        const { fob: fobPrice, cif: cifPrice } = computeItemPrices(p, { uf, cityType, weightTier });

               html += `
            <tr>
                <td>
                    <div style="font-weight:600">${escapeHtml(p.codigo)}</div>
                    <div style="font-size:0.85rem; color:#6b7280">${escapeHtml(p.descricao)}</div>
                </td>
                <td>${p.peso.toFixed(3)}</td>
                <td class="price-tag price-fob">R$&nbsp;${fobPrice.toFixed(2)}</td>
                <td class="price-tag price-cif">R$&nbsp;${cifPrice.toFixed(2)}</td>
                <td class="col-action">
                    <button onclick="addToCart(this.dataset.codigo)" data-codigo="${escapeHtml(p.codigo)}">
                        ➕ Adicionar
                    </button>
                </td>
            </tr>
        `;

    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Prices are calculated here from the table in use and the region selected in the filters;
// the region is stored with the item so the CIF can be recalculated if the table changes.
function addToCart(codigo) {
    const p = productsData.find(item => item.codigo === codigo);
    if (!p) return;

    const currentUser = authManager.getCurrentUser();
    orderManager.ensureCreator(currentUser);

    const existing = cart.find(item => item.codigo === codigo);
    if (existing) {
        existing.qty++;
    } else {
        const region = getCurrentRegionFilters();
        const { fob, cif, cost, freightCost } = computeItemPrices(p, region);
        cart.push({
            codigo: p.codigo,
            descricao: p.descricao,
            fob: fob,
            cif: cif, // Preço CIF original (referência)
            negotiatedPrice: cif,
            unitDiscount: 0,
            weight: p.weightRaw,
            minMargin: p.minMargin,
            cost: cost,               // custo + despesas do produto (base da margem)
            freightCost: freightCost, // frete da região, pago pela Hiperroll na venda CIF
            qty: 1,
            uf: region.uf,
            cityType: region.cityType,
            weightTier: region.weightTier
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
            ? `⚠️ Margem do pedido abaixo do mínimo de ${formatMarginPercent(totals.minMargin)}% (média das margens mínimas dos produtos, ponderada pelo valor de cada item). O envio exigirá uma justificativa e será sinalizado ao supervisor.`
            : '';
    }
}

function updateOrderTable() {
    const container = document.getElementById('orderTableContainer');
    const summaryDiv = document.getElementById('orderSummary');

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum item no pedido.</div>';
        summaryDiv.style.display = 'none';
        updateMinMarginLabels(null);
        return;
    }

    summaryDiv.style.display = 'block';

    const totals = calculateOrderTotals(cart, getCurrentOrderConditions());
    updateMinMarginLabels(totals.minMargin);

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
                    <th title="Margem líquida: (preço líquido − custo e frete − impostos, comissão e despesa financeira) ÷ valor da nota, já com os descontos do pedido">Margem Líq. (%)</th>
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
                    <span style="color: ${getMarginStatus(itemMarginPercent, line.minMargin).color}" title="Margem mínima deste produto: ${formatMarginPercent(line.minMargin)}%">
                        ${itemMarginPercent.toFixed(2)}%
                    </span>
                    <div class="item-min-margin">mín. ${formatMarginPercent(line.minMargin)}%</div>
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

// The header box and the "(mín. X%)" next to the order margin show the minimum of the order
// being built (it depends on which products are in it); "—" while the order is empty.
function updateMinMarginLabels(minMargin) {
    const text = minMargin === null ? '—' : formatMarginPercent(minMargin);
    const header = document.getElementById('marginThreshold');
    if (header) header.textContent = text;
    document.querySelectorAll('[data-pricing-rule="MIN_ORDER_MARGIN"]').forEach(el => {
        el.textContent = minMargin === null ? '—' : `${text}%`;
    });
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

async function prepareDraftForSubmission(submissionId) {
    await loadDraftToCurrentOrder(submissionId, true);
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
            ? `⚠️ Margem abaixo do mínimo de ${formatMarginPercent(totals.minMargin)}%`
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
        // The gestor changed the table while this order was being built: reload it, show what
        // changed, then reopen this modal with the new totals so the representative sends again.
        if (e.code === 'pricing_outdated') {
            closeSubmitOrderModal();
            try {
                await refreshPricingCatalog('A tabela de preços foi atualizada pelo gestor enquanto você montava este pedido.');
            } catch (refreshError) {
                alert(refreshError.message);
                return;
            }
            showSubmitOrderModal();
            const refreshedMsg = document.getElementById('submitOrderMessage');
            if (refreshedMsg) {
                refreshedMsg.textContent = 'Os preços foram revisados com a tabela nova. Confira a margem e clique em "Enviar Pedido" novamente.';
                refreshedMsg.style.color = '#b45309';
            }
            return;
        }
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

async function loadDraftToCurrentOrder(submissionId, silent = false) {
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
    const repriced = await reviewCartPrices('A tabela de preços mudou desde que este rascunho foi salvo.');
    if (!silent && repriced === 'none') {
        alert('Rascunho carregado. Edite o pedido ou envie quando estiver pronto.');
    }
}

async function repeatOrder(submissionId) {
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
    const repriced = await reviewCartPrices('A tabela de preços mudou desde este pedido.');
    if (repriced === 'none') {
        alert('Pedido repetido como novo pedido. Ajuste os dados se necessário e envie novamente.');
    }
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

// Other users change orders and prices too (e.g. the gestor approving or adjusting the table),
// so both can be refreshed on demand.
async function reloadOrders() {
    try {
        await loadServerData();
        afterOrdersChanged();
        await refreshPricingCatalog();
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
        
        // Same rule as everywhere else (net margin, with the order's discounts and contract).
        const marginPercent = calculateOrderTotals([item], deletion.conditions).margin;

        const marginColor = getMarginStatus(marginPercent, Number.isFinite(parseFloat(item.minMargin)) ? parseFloat(item.minMargin) : normalizeOrderConditions(deletion.conditions).minMargin).color;
        
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
        const marginColor = getMarginStatus(line.marginPercent, line.minMargin).color;
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
        const itemMarginColor = getMarginStatus(marginPercent, line.minMargin).color;
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
    if (tabId === 'tab-pricing') {
        renderPricingTab();
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
            const itemMarginColor = getMarginStatus(marginPercent, line.minMargin).color;

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

// ==========================================
// ABA "TABELA DE PREÇOS" (gestor edita; administrador importa e consulta)
// Every save goes to the server, which validates, records "de → para" in the price history and
// bumps the table version; the screen then reloads the table returned by the server.
// ==========================================

const PRICING_FIELD_LABELS = Object.freeze({
    name: 'Nome',
    custo_base: 'Custo produto (R$/kg)',
    desp_com: 'Desp. comercial (R$/kg)',
    desp_adm: 'Desp. administrativa (R$/kg)',
    price100: 'Preço 100% NF (R$/kg)',
    label: 'Descrição da praça',
    tier1: 'Frete 150–199 kg (R$/kg)',
    tier2: 'Frete acima de 200 kg (R$/kg)',
    descricao: 'Descrição',
    categoria: 'Categoria',
    subcat: 'Subcategoria',
    cost_line_key: 'Grupo de preço',
    weight: 'Peso (kg)',
    ncm: 'NCM',
    active: 'Ativo',
    price_override: 'Preço FOB próprio (R$)',
    min_margin: 'Margem mínima (%)',
    import: 'Importação',
    removido: 'Praça removida'
});
const PRICING_MONEY_FIELDS = ['custo_base', 'desp_com', 'desp_adm', 'price100', 'tier1', 'tier2', 'price_override'];
const PRACA_OPTIONS = ['Capital', 'Interior', 'Fluvial'];

let pricingTabSection = 'lines';
let pricingProductFilter = '';
let pricingShowInactive = false;
let pricingBulkPreview = null;

function pricingCanEdit() {
    return pricingCatalog.source === 'server' && Boolean(pricingCatalog.canEdit);
}

function setPricingMessage(text, type = 'info') {
    const el = document.getElementById('pricingMessage');
    if (!el) return;
    el.textContent = text || '';
    el.className = `pricing-message${text ? ` is-${type}` : ''}`;
}

function renderPricingTab() {
    const container = document.getElementById('pricingTabContent');
    if (!container) return;
    if (!authManager.canViewPricingAdmin()) {
        container.innerHTML = '';
        return;
    }
    bindPricingEnterKey(container);
    if (!pricingCatalog.imported) {
        container.innerHTML = renderPricingImportPanel();
        if (getLegacyCatalog() && !pricingImportError && !pricingImportPromise) importPricingCatalog();
        return;
    }

    const sections = [
        ['lines', '🏷️ Grupos de preço'],
        ['freight', '🚚 Frete'],
        ['products', '📦 Produtos'],
        ['bulk', '📈 Reajuste em lote'],
        ['history', '🕘 Histórico']
    ];
    container.innerHTML = `
        <div class="pricing-toolbar">
            <div class="pricing-sections" role="tablist">
                ${sections.map(([id, label]) => `<button type="button" role="tab" class="pricing-section-btn${id === pricingTabSection ? ' active' : ''}" onclick="switchPricingSection('${id}')">${label}</button>`).join('')}
            </div>
            <div class="pricing-meta">Versão da tabela: <strong>${pricingCatalog.version}</strong>${pricingCanEdit() ? '' : ' · <span class="pricing-readonly">somente leitura (a edição é do gestor)</span>'}</div>
        </div>
        <div id="pricingMessage" class="pricing-message"></div>
        <div id="pricingSectionBody"></div>`;

    const renderers = {
        lines: renderPricingLines,
        freight: renderPricingFreight,
        products: renderPricingProducts,
        bulk: renderPricingBulk,
        history: renderPricingHistory
    };
    (renderers[pricingTabSection] || renderPricingLines)(document.getElementById('pricingSectionBody'));
}

// Enter inside an edited row (product line, freight or product) saves it right away.
function bindPricingEnterKey(container) {
    if (container.dataset.enterBound) return;
    container.dataset.enterBound = '1';
    container.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !event.target.matches('input')) return;
        const row = event.target.closest('tr');
        if (!row || !row.classList.contains('is-dirty')) return;
        if (row.dataset.lineKey) {
            event.preventDefault();
            savePricingLines();
        } else if (row.dataset.uf) {
            event.preventDefault();
            saveFreightRows();
        } else if (row.dataset.codigo) {
            event.preventDefault();
            savePricingProducts();
        }
    });
}

function switchPricingSection(section) {
    pricingTabSection = section;
    pricingBulkPreview = null;
    renderPricingTab();
}

function pricingSaveBar(onSave) {
    return `
        <div class="pricing-savebar">
            <input id="pricingNote" class="pricing-input pricing-input--text" maxlength="300" placeholder="Motivo da alteração (opcional, fica no histórico)">
            <button type="button" class="btn-modal btn-modal-ghost" onclick="renderPricingTab()">Descartar</button>
            <button type="button" id="pricingSaveBtn" class="btn-modal btn-modal-primary" onclick="${onSave}" disabled>Salvar alterações</button>
        </div>`;
}

// Value for a number input: always shows cents ("29.20"), keeps extra decimals if a value has them.
function priceInputValue(value) {
    const number = Number(value) || 0;
    return Math.abs(number * 100 - Math.round(number * 100)) < 1e-9 ? number.toFixed(2) : String(number);
}

function getPricingNote() {
    return document.getElementById('pricingNote')?.value.trim() || '';
}

function readPricingNumber(scope, field) {
    const el = scope.querySelector(`[data-field="${field}"]`);
    return el ? parseFloat(el.value) || 0 : 0;
}

function markPricingDirty(row) {
    row.classList.add('is-dirty');
    const btn = document.getElementById('pricingSaveBtn');
    if (btn) btn.disabled = false;
}

// Sends one change, then swaps in the table the server returns (the open cart gets reviewed).
async function sendPricingChange(action, body) {
    try {
        const data = await apiRequest(action, { method: 'POST', body });
        await applyServerCatalog(data.catalog, 'Você alterou a tabela de preços. Confira o pedido que está montando.');
        renderPricingTab();
        const count = data.changed ?? (data.changes ? data.changes.length : 0);
        setPricingMessage(
            count ? `Alterações salvas (${count}). Já valem para todos. Versão da tabela: ${pricingCatalog.version}.` : 'Nada mudou: os valores já eram esses.',
            count ? 'success' : 'info'
        );
        return data;
    } catch (e) {
        setPricingMessage(e.message, 'error');
        return null;
    }
}

// ----- Carga inicial (automática, uma única vez) -----
// The first time the gestor (or the admin) opens this tab, the table the portal already uses
// (data.js) is copied into the database as it is, so they can start editing right away.
let pricingImportPromise = null;
let pricingImportError = '';

function renderPricingImportPanel() {
    if (!getLegacyCatalog()) {
        return '<div class="empty-state">A tabela de preços ainda não está no sistema e o arquivo data.js não está disponível no servidor.</div>';
    }
    if (pricingImportError) {
        return `
            <div class="pricing-import">
                <div class="pricing-message is-error">Não foi possível preparar a tabela de preços: ${escapeHtml(pricingImportError)}</div>
                <button type="button" class="btn-modal btn-modal-primary" onclick="importPricingCatalog()">Tentar de novo</button>
            </div>`;
    }
    return '<div class="empty-state">Preparando a tabela de preços…</div>';
}

// Safe to call more than once: a second call while one is running gets the same promise.
function importPricingCatalog() {
    if (pricingCatalog.imported) return Promise.resolve();
    if (!pricingImportPromise) {
        pricingImportPromise = runPricingImport().finally(() => { pricingImportPromise = null; });
    }
    return pricingImportPromise;
}

async function runPricingImport() {
    const legacy = getLegacyCatalog();
    if (!legacy) return;
    pricingImportError = '';
    try {
        const data = await apiRequest('pricing.import', {
            method: 'POST',
            body: { costLines: legacy.costLines, freight: legacy.freight, products: legacy.products }
        });
        await applyServerCatalog(data.catalog, 'A tabela de preços passou a vir do sistema. Confira o pedido que está montando.');
        renderPricingTab();
        const notes = legacy.warnings.length ? ` Confira: ${legacy.warnings.join(' ')}` : '';
        setPricingMessage(`Tabela pronta para edição: ${data.imported.costLines} grupos de preço, ${data.imported.freight} praças de frete e ${data.imported.products} produtos, com os preços que o portal já usava.${notes}`, 'success');
    } catch (e) {
        // 409 = someone else (another tab, the admin) did the same a moment ago: just load it.
        if (e.status === 409) {
            await refreshPricingCatalog();
        } else {
            pricingImportError = e.message;
        }
        renderPricingTab();
    }
}

// ----- Grupos de preço (cost lines) -----

let pricingShowCosts = false;

function formatMarkup(line) {
    const costs = line.custoBase + line.despCom + line.despAdm;
    if (costs <= 0) return '—';
    const pct = (line.price100 / costs - 1) * 100;
    return `${pct >= 0 ? '+' : ''}${formatBRL(pct, 1)}%`;
}

// Net margin of a group at its table price: 1 − custos ÷ preço − deduções. The same for every
// region, because the freight enters the CIF with the group's own markup.
function formatLineNetMargin(line) {
    const costs = line.custoBase + line.despCom + line.despAdm;
    if (!(line.price100 > 0)) return '—';
    const pct = (1 - costs / line.price100) * 100 - PRICING_RULES.SALE_DEDUCTIONS_PERCENT;
    return `${formatBRL(pct, 1)}%`;
}

// "42" or "42 (3 com preço próprio)": products with their own price don't follow this line's price.
function describeLineProducts(key) {
    const products = productsData.filter(p => p.costLineKey === key && p.active);
    const own = products.filter(p => p.priceOverride != null).length;
    return own ? `${products.length} <span class="reprice-desc">(${own} com preço próprio)</span>` : String(products.length);
}

// Default view is just "line → price per kg". The cost columns stay in the page (hidden by CSS)
// so every save still sends the whole line; "Mostrar custos" reveals them.
function renderPricingLines(body) {
    const editable = pricingCanEdit();
    const dis = editable ? '' : 'disabled';
    const money = (field, value, extra = '') => `<input type="number" step="0.01" min="0" class="pricing-input${extra}" data-field="${field}" value="${priceInputValue(value)}" ${dis} oninput="onPricingLineInput(this)">`;
    const rows = pricingCatalog.costLines.map(line => `
        <tr data-line-key="${escapeHtml(line.key)}">
            <td><input class="pricing-input pricing-input--text" data-field="name" value="${escapeHtml(line.name)}" maxlength="80" ${dis} oninput="onPricingLineInput(this)"></td>
            <td class="col-cost">${money('custoBase', line.custoBase)}</td>
            <td class="col-cost">${money('despCom', line.despCom)}</td>
            <td class="col-cost">${money('despAdm', line.despAdm)}</td>
            <td class="col-cost pricing-computed" data-computed="costs">${formatBRL(line.custoBase + line.despCom + line.despAdm)}</td>
            <td>${money('price100', line.price100, ' pricing-input--strong')}</td>
            <td class="col-cost pricing-computed" data-computed="markup">${formatMarkup(line)}</td>
            <td class="pricing-computed" data-computed="netMargin">${formatLineNetMargin(line)}</td>
            <td class="pricing-computed">${describeLineProducts(line.key)}</td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="pricing-filterbar">
            <p class="pricing-hint">${editable ? 'Altere o <strong>preço por kg</strong> do grupo e aperte <strong>Enter</strong>. ' : ''}Cada grupo de preço tem um preço por kg; o preço FOB de cada produto do grupo = preço por kg × peso do produto. <strong>Margem líq. na tabela</strong> é a margem que sobra vendendo no preço cheio; compare com a margem mínima dos produtos do grupo. Produtos com <strong>preço próprio</strong> (seção Produtos) não mudam quando o grupo muda.</p>
            <label class="pricing-check"><input type="checkbox" ${pricingShowCosts ? 'checked' : ''} onchange="pricingShowCosts = this.checked; this.closest('#pricingSectionBody').querySelector('.pricing-table').classList.toggle('pricing-table--simple', !this.checked)"> Mostrar custos</label>
        </div>
        <div class="results-table-container">
            <table class="pricing-table${pricingShowCosts ? '' : ' pricing-table--simple'}">
                <thead><tr><th>Grupo de preço</th><th class="col-cost">Custo produto</th><th class="col-cost">Desp. comercial</th><th class="col-cost">Desp. adm.</th><th class="col-cost">Total custos</th><th title="Preço 100% NF">Preço por kg (R$)</th><th class="col-cost">Markup s/ custos</th><th title="Margem líquida do grupo no preço de tabela: 1 − custos ÷ preço − 27,51% (impostos, comissão e despesa financeira). Compare com a margem mínima dos produtos do grupo.">Margem líq. na tabela</th><th>Produtos</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${editable ? `
        <details class="pricing-new">
            <summary>➕ Novo grupo de preço</summary>
            <div class="pricing-form-grid">
                <label>Nome<input id="newLineName" class="pricing-input pricing-input--text" maxlength="80"></label>
                <label>Custo produto<input id="newLineCustoBase" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Desp. comercial<input id="newLineDespCom" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Desp. adm.<input id="newLineDespAdm" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Preço por kg<input id="newLinePrice100" type="number" step="0.01" min="0" class="pricing-input"></label>
                <button type="button" class="btn-modal btn-modal-ghost" onclick="createPricingLine()">Criar grupo</button>
            </div>
        </details>
        ${pricingSaveBar('savePricingLines()')}` : ''}`;
}

function readPricingLineRow(row) {
    return {
        key: row.dataset.lineKey,
        name: row.querySelector('[data-field="name"]').value.trim(),
        custoBase: readPricingNumber(row, 'custoBase'),
        despCom: readPricingNumber(row, 'despCom'),
        despAdm: readPricingNumber(row, 'despAdm'),
        price100: readPricingNumber(row, 'price100')
    };
}

function onPricingLineInput(input) {
    const row = input.closest('tr');
    const line = readPricingLineRow(row);
    row.querySelector('[data-computed="costs"]').textContent = formatBRL(line.custoBase + line.despCom + line.despAdm);
    row.querySelector('[data-computed="markup"]').textContent = formatMarkup(line);
    row.querySelector('[data-computed="netMargin"]').textContent = formatLineNetMargin(line);
    markPricingDirty(row);
}

async function savePricingLines() {
    const lines = [...document.querySelectorAll('#pricingSectionBody tr.is-dirty[data-line-key]')].map(readPricingLineRow);
    if (!lines.length) return;
    await sendPricingChange('pricing.updateCostLines', { lines, note: getPricingNote() });
}

async function createPricingLine() {
    const name = document.getElementById('newLineName')?.value.trim() || '';
    if (!name) {
        setPricingMessage('Informe o nome do novo grupo de preço.', 'error');
        return;
    }
    const key = name.toLowerCase();
    if (costsData[key]) {
        setPricingMessage('Já existe um grupo de preço com esse nome.', 'error');
        return;
    }
    const num = id => parseFloat(document.getElementById(id)?.value) || 0;
    await sendPricingChange('pricing.updateCostLines', {
        lines: [{ key, name, custoBase: num('newLineCustoBase'), despCom: num('newLineDespCom'), despAdm: num('newLineDespAdm'), price100: num('newLinePrice100') }],
        note: 'Novo grupo de preço'
    });
}

// ----- Frete -----

function renderPricingFreight(body) {
    const editable = pricingCanEdit();
    const dis = editable ? '' : 'disabled';
    const dirty = 'oninput="markPricingDirty(this.closest(\'tr\'))"';
    const rows = pricingCatalog.freight.map(f => `
        <tr data-uf="${escapeHtml(f.uf)}" data-praca="${escapeHtml(f.pracaType)}">
            <td><strong>${escapeHtml(f.uf)}</strong></td>
            <td>${escapeHtml(f.pracaType)}</td>
            <td><input class="pricing-input pricing-input--wide" data-field="label" value="${escapeHtml(f.label)}" maxlength="200" ${dis} ${dirty}></td>
            <td><input type="number" step="0.01" min="0" class="pricing-input" data-field="tier1" value="${priceInputValue(f.tier1)}" ${dis} ${dirty}></td>
            <td><input type="number" step="0.01" min="0" class="pricing-input" data-field="tier2" value="${priceInputValue(f.tier2)}" ${dis} ${dirty}></td>
            ${editable ? '<td><label class="pricing-check"><input type="checkbox" data-field="remove" onchange="markPricingDirty(this.closest(\'tr\'))"> remover</label></td>' : ''}
        </tr>`).join('');

    body.innerHTML = `
        <p class="pricing-hint">Frete em R$ por kg, por UF e tipo de praça.${editable ? ' Altere o valor e aperte <strong>Enter</strong>.' : ''} O frete entra no preço CIF dos produtos daquela região.</p>
        <div class="results-table-container">
            <table class="pricing-table">
                <thead><tr><th>UF</th><th>Praça</th><th>Descrição</th><th>150 a 199 kg</th><th>Acima de 200 kg</th>${editable ? '<th></th>' : ''}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${editable ? `
        <details class="pricing-new">
            <summary>➕ Nova praça</summary>
            <div class="pricing-form-grid">
                <label>UF<input id="newFreightUf" class="pricing-input" maxlength="2" placeholder="Ex.: MG"></label>
                <label>Praça<select id="newFreightType" class="pricing-input">${PRACA_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('')}</select></label>
                <label>Descrição<input id="newFreightLabel" class="pricing-input pricing-input--text" maxlength="200" placeholder="Ex.: Belo Horizonte"></label>
                <label>150 a 199 kg<input id="newFreightTier1" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Acima de 200 kg<input id="newFreightTier2" type="number" step="0.01" min="0" class="pricing-input"></label>
                <button type="button" class="btn-modal btn-modal-ghost" onclick="createFreightRow()">Adicionar praça</button>
            </div>
        </details>
        ${pricingSaveBar('saveFreightRows()')}` : ''}`;
}

async function saveFreightRows() {
    const rows = [...document.querySelectorAll('#pricingSectionBody tr.is-dirty[data-uf]')].map(row => ({
        uf: row.dataset.uf,
        pracaType: row.dataset.praca,
        label: row.querySelector('[data-field="label"]').value.trim(),
        tier1: readPricingNumber(row, 'tier1'),
        tier2: readPricingNumber(row, 'tier2'),
        remove: Boolean(row.querySelector('[data-field="remove"]')?.checked)
    }));
    if (!rows.length) return;
    // Plain value changes save straight away; only removing a praça asks first.
    const removed = rows.filter(r => r.remove).map(r => `${r.uf} · ${r.pracaType}`);
    if (removed.length && !confirm(`Remover do frete: ${removed.join(', ')}? Os representantes deixam de ter preço CIF para essas praças.`)) return;
    await sendPricingChange('pricing.updateFreight', { rows, note: getPricingNote() });
}

async function createFreightRow() {
    const uf = (document.getElementById('newFreightUf')?.value || '').trim().toUpperCase();
    const pracaType = document.getElementById('newFreightType')?.value || '';
    if (!/^[A-Z]{2}$/.test(uf)) {
        setPricingMessage('Informe a UF com duas letras (ex.: MG).', 'error');
        return;
    }
    if (freightData[uf] && freightData[uf][pracaType]) {
        setPricingMessage(`${uf} · ${pracaType} já existe: edite essa praça na tabela.`, 'error');
        return;
    }
    const num = id => parseFloat(document.getElementById(id)?.value) || 0;
    await sendPricingChange('pricing.updateFreight', {
        rows: [{ uf, pracaType, label: document.getElementById('newFreightLabel')?.value.trim() || '', tier1: num('newFreightTier1'), tier2: num('newFreightTier2') }],
        note: 'Nova praça de frete'
    });
}

// ----- Produtos -----
// Each product's FOB comes from its product line (preço por kg × peso) unless the gestor typed an
// individual price for it. The list can be narrowed by any number of categories and by search;
// the bulk actions apply to exactly the products listed on screen.
// Edits are kept in pricingProductEdits until "Salvar alterações", so several products (even
// from different categories) can be changed and saved together.

let pricingProductCategories = []; // empty = every category
let pricingProductEdits = {};      // codigo → { descricao, costLineKey, weight, active, priceEdited, price }

function lineFobFor(product, costLineKey = product.costLineKey, weight = product.weight) {
    const line = costsData[costLineKey];
    return line ? line.price100 * weight : 0;
}

function currentFobFor(product) {
    return product.priceOverride != null ? product.priceOverride : lineFobFor(product);
}

function getFilteredPricingProducts() {
    const terms = pricingProductFilter.toLowerCase().split(' ').filter(Boolean);
    return pricingCatalog.products.filter(p =>
        (pricingShowInactive || p.active) &&
        (!pricingProductCategories.length || pricingProductCategories.includes(p.categoria)) &&
        terms.every(t => `${p.codigo} ${p.descricao} ${p.categoria} ${p.subcat}`.toLowerCase().includes(t)));
}

function renderPricingProducts(body) {
    const editable = pricingCanEdit();
    const lineOptions = pricingCatalog.costLines.map(l => `<option value="${escapeHtml(l.key)}">${escapeHtml(l.name)}</option>`).join('');
    const categories = {};
    pricingCatalog.products.forEach(p => { categories[p.categoria] = (categories[p.categoria] || 0) + 1; });
    // A category that no longer exists (after an edit) must not keep filtering the list.
    pricingProductCategories = pricingProductCategories.filter(c => c in categories);
    const categoryChips = Object.keys(categories).sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .map(c => `<button type="button" class="pricing-chip-btn" data-category="${escapeHtml(c)}" onclick="togglePricingCategory(this.dataset.category)">${escapeHtml(c || '(sem categoria)')} (${categories[c]})</button>`).join('');

    body.innerHTML = `
        <div class="pricing-categories" id="pricingCategoryChips">
            <span class="pricing-categories-label">Categorias:</span>
            <button type="button" class="pricing-chip-btn" data-all="1" onclick="setPricingCategories([])">Todas (${pricingCatalog.products.length})</button>
            ${categoryChips}
        </div>
        <div class="pricing-filterbar">
            <input id="pricingProductSearch" class="pricing-input pricing-input--wide" placeholder="Buscar por código ou descrição" value="${escapeHtml(pricingProductFilter)}" oninput="pricingProductFilter = this.value; renderPricingProductRows()">
            <label class="pricing-check"><input type="checkbox" ${pricingShowInactive ? 'checked' : ''} onchange="pricingShowInactive = this.checked; renderPricingProductRows()"> Mostrar inativos</label>
        </div>
        <p class="pricing-hint">Clique em uma ou mais categorias para filtrar. ${editable ? 'Altere quantos produtos quiser e clique em <strong>Salvar alterações</strong> (ou aperte Enter). ' : ''}Um produto <strong>sem preço próprio</strong> segue o grupo de preço dele: preço por kg do grupo × peso. <strong>Margem mín.</strong> é a margem mínima do produto na negociação. O CIF de cada região é calculado a partir do preço FOB.</p>
        ${editable ? `
        <div class="pricing-bulkbar">
            <span>Com os <strong id="pricingFilteredCount">0</strong> produtos listados:</span>
            <span class="pricing-bulkbar-group">
                <input id="bulkProductPercent" type="number" step="0.1" class="pricing-input pricing-input--narrow" placeholder="%">
                <button type="button" class="pricing-row-btn" onclick="bulkUpdateFilteredProducts('percent')" title="Aumenta (ou reduz, com número negativo) o preço FOB de cada produto listado. Eles passam a ter preço próprio.">Reajustar preço</button>
            </span>
            <span class="pricing-bulkbar-group">
                <select id="bulkProductLine" class="pricing-input">${lineOptions}</select>
                <button type="button" class="pricing-row-btn" onclick="bulkUpdateFilteredProducts('setLine')" title="Os produtos listados passam a pertencer a este grupo de preço e a usar o preço por kg dele.">Mover para o grupo</button>
            </span>
            <button type="button" class="pricing-row-btn pricing-row-btn--ghost" onclick="bulkUpdateFilteredProducts('clearPrice')" title="Apaga o preço próprio dos produtos listados: eles voltam a custar preço por kg do grupo × peso.">Voltar ao preço do grupo</button>
        </div>
        <div class="pricing-pending" id="pricingProductPending" hidden>
            <span>✏️ <strong id="pricingPendingCount">0</strong> produto(s) com alteração ainda não salva</span>
            <button type="button" class="btn-modal btn-modal-ghost" onclick="discardPricingProductEdits()">Descartar</button>
            <button type="button" class="btn-modal btn-modal-primary" onclick="savePricingProducts()">Salvar alterações</button>
        </div>` : ''}
        <div class="results-table-container">
            <table class="pricing-table">
                <thead><tr><th>Código</th><th>Descrição</th><th>Grupo de preço</th><th>Peso (kg)</th><th>Preço FOB (R$)</th><th title="Margem mínima do produto na negociação. O pedido precisa de justificativa quando fica abaixo da média ponderada dos itens.">Margem mín. (%)</th><th>Ativo</th></tr></thead>
                <tbody id="pricingProductRows"></tbody>
            </table>
        </div>
        ${editable ? `
        <details class="pricing-new">
            <summary>➕ Novo produto</summary>
            <div class="pricing-form-grid">
                <label>Código<input id="newProductCodigo" class="pricing-input" maxlength="40" placeholder="Ex.: P-09999"></label>
                <label>Descrição<input id="newProductDescricao" class="pricing-input pricing-input--text" maxlength="200"></label>
                <label>Categoria<input id="newProductCategoria" class="pricing-input pricing-input--text" maxlength="80" placeholder="Ex.: Bobina Fundo Estrela"></label>
                <label>Subcategoria<input id="newProductSubcat" class="pricing-input pricing-input--text" maxlength="80"></label>
                <label>Grupo de preço<select id="newProductLine" class="pricing-input">${lineOptions}</select></label>
                <label>Peso (kg)<input id="newProductWeight" type="number" step="0.001" min="0" class="pricing-input"></label>
                <label>Preço FOB próprio (opcional)<input id="newProductPrice" type="number" step="0.01" min="0" class="pricing-input" placeholder="vazio = preço do grupo"></label>
                <label>Margem mínima (%)<input id="newProductMinMargin" type="number" step="0.5" min="0" max="100" class="pricing-input" value="${PRICING_RULES.MIN_ORDER_MARGIN}"></label>
                <button type="button" class="btn-modal btn-modal-ghost" onclick="createPricingProduct()">Cadastrar produto</button>
            </div>
        </details>` : ''}`;
    renderPricingProductRows();
}

function setPricingCategories(categories) {
    pricingProductCategories = categories;
    renderPricingProductRows();
}

function togglePricingCategory(category) {
    setPricingCategories(pricingProductCategories.includes(category)
        ? pricingProductCategories.filter(c => c !== category)
        : [...pricingProductCategories, category]);
}

function renderPricingProductRows() {
    const tbody = document.getElementById('pricingProductRows');
    if (!tbody) return;
    const editable = pricingCanEdit();
    const dis = editable ? '' : 'disabled';
    const list = getFilteredPricingProducts();
    const countEl = document.getElementById('pricingFilteredCount');
    if (countEl) countEl.textContent = list.length;
    document.querySelectorAll('#pricingCategoryChips .pricing-chip-btn').forEach(chip => {
        const active = chip.dataset.all ? !pricingProductCategories.length : pricingProductCategories.includes(chip.dataset.category);
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    tbody.innerHTML = list.map(p => {
        // Values typed but not saved yet take the place of the stored ones.
        const edit = pricingProductEdits[p.codigo];
        const shown = edit ? { ...p, ...edit } : p;
        const options = pricingCatalog.costLines.map(l => `<option value="${escapeHtml(l.key)}"${l.key === shown.costLineKey ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('');
        const price = edit && edit.priceEdited ? edit.price : (p.priceOverride != null ? p.priceOverride : lineFobFor(p, shown.costLineKey, shown.weight));
        const own = p.priceOverride != null;
        const priceNote = own
            ? `<span class="price-badge">preço próprio</span>${editable ? ` <button type="button" class="pricing-link-btn" onclick="resetPricingProductPrice(this)" title="Voltar a seguir o grupo de preço (R$ ${formatBRL(lineFobFor(p))})">↺ usar grupo</button>` : ''}`
            : '<span class="price-badge price-badge--line">do grupo</span>';
        return `
        <tr data-codigo="${escapeHtml(p.codigo)}" class="${shown.active ? '' : 'is-inactive'}${edit ? ' is-dirty' : ''}"${edit && edit.priceEdited ? ' data-price-edited="1"' : ''}>
            <td><strong>${escapeHtml(p.codigo)}</strong><div class="reprice-desc">${escapeHtml(p.categoria)}</div></td>
            <td><input class="pricing-input pricing-input--wide" data-field="descricao" value="${escapeHtml(shown.descricao)}" maxlength="200" ${dis} oninput="onPricingProductInput(this)"></td>
            <td><select class="pricing-input" data-field="costLineKey" ${dis} onchange="onPricingProductInput(this)">${options}</select></td>
            <td><input type="number" step="0.001" min="0" class="pricing-input pricing-input--narrow" data-field="weight" value="${shown.weight}" ${dis} oninput="onPricingProductInput(this)"></td>
            <td class="pricing-price-cell">
                <input type="number" step="0.01" min="0" class="pricing-input pricing-input--strong pricing-input--narrow" data-field="price" value="${priceInputValue(Math.round(price * 100) / 100)}" ${dis}
                    oninput="this.closest('tr').dataset.priceEdited = '1'; onPricingProductInput(this)">
                <div class="price-note">${priceNote}</div>
            </td>
            <td><input type="number" step="0.5" min="0" max="100" class="pricing-input pricing-input--narrow" data-field="minMargin" value="${shown.minMargin}" ${dis} oninput="onPricingProductInput(this)"></td>
            <td><input type="checkbox" data-field="active" ${shown.active ? 'checked' : ''} ${dis} onchange="onPricingProductInput(this)"></td>
        </tr>`;
    }).join('') || `<tr><td colspan="7"><div class="empty-state">Nenhum produto encontrado.</div></td></tr>`;
    updatePricingProductPending();
}

function updatePricingProductPending() {
    const bar = document.getElementById('pricingProductPending');
    if (!bar) return;
    const count = Object.keys(pricingProductEdits).length;
    bar.hidden = count === 0;
    document.getElementById('pricingPendingCount').textContent = count;
}

// Records what was typed in the row. Without its own price, the FOB shown follows the
// line/weight the gestor is choosing.
function onPricingProductInput(el) {
    const row = el.closest('tr');
    const product = pricingCatalog.products.find(p => p.codigo === row.dataset.codigo);
    if (!product) return;
    const edit = {
        descricao: row.querySelector('[data-field="descricao"]').value,
        costLineKey: row.querySelector('[data-field="costLineKey"]').value,
        weight: readPricingNumber(row, 'weight'),
        minMargin: readPricingNumber(row, 'minMargin'),
        active: row.querySelector('[data-field="active"]').checked,
        priceEdited: row.dataset.priceEdited === '1'
    };
    if (edit.priceEdited) {
        edit.price = readPricingNumber(row, 'price');
    } else if (product.priceOverride == null) {
        row.querySelector('[data-field="price"]').value = priceInputValue(Math.round(lineFobFor(product, edit.costLineKey, edit.weight) * 100) / 100);
    }
    pricingProductEdits[product.codigo] = edit;
    row.classList.add('is-dirty');
    row.classList.toggle('is-inactive', !edit.active);
    updatePricingProductPending();
}

function buildEditedProduct(current, edit) {
    const product = { ...current, descricao: edit.descricao.trim(), costLineKey: edit.costLineKey, weight: edit.weight, minMargin: edit.minMargin, active: edit.active };
    if (edit.priceEdited) {
        // Typing exactly the line price on a product without its own price keeps it following the line.
        product.priceOverride = current.priceOverride == null && Math.abs(edit.price - lineFobFor(product)) < 0.005 ? null : edit.price;
    }
    return product;
}

async function savePricingProducts() {
    const pending = pricingProductEdits;
    const pairs = Object.keys(pending)
        .map(code => ({ current: pricingCatalog.products.find(p => p.codigo === code), edit: pending[code] }))
        .filter(pair => pair.current);
    if (!pairs.length) return;
    const products = pairs.map(pair => buildEditedProduct(pair.current, pair.edit));
    const badPrice = products.find(p => p.priceOverride != null && !(p.priceOverride > 0));
    if (badPrice) {
        setPricingMessage(`Informe um preço maior que zero para ${badPrice.codigo}.`, 'error');
        return;
    }
    const deactivated = pairs.filter((pair, i) => pair.current.active && !products[i].active).map(pair => pair.current.codigo);
    if (deactivated.length && !confirm(`Desativar ${deactivated.join(', ')}? ${deactivated.length > 1 ? 'Eles deixam' : 'Ele deixa'} de aparecer para os representantes.`)) return;

    // Cleared before sending because a successful save redraws the tab; restored if it fails.
    pricingProductEdits = {};
    const data = await sendPricingChange('pricing.saveProducts', { products, note: '' });
    if (!data) {
        pricingProductEdits = pending;
        updatePricingProductPending();
    }
}

function discardPricingProductEdits() {
    pricingProductEdits = {};
    renderPricingProductRows();
}

async function resetPricingProductPrice(el) {
    const row = el.closest('tr');
    const current = pricingCatalog.products.find(p => p.codigo === row.dataset.codigo);
    if (!current) return;
    if (!confirm(`${current.codigo} volta a seguir o preço do grupo: R$ ${formatBRL(lineFobFor(current))} (hoje R$ ${formatBRL(current.priceOverride)}). Confirmar?`)) return;
    delete pricingProductEdits[current.codigo];
    await sendPricingChange('pricing.saveProduct', { product: { ...current, priceOverride: null }, note: 'Voltou ao preço do grupo' });
}

async function bulkUpdateFilteredProducts(action) {
    if (Object.keys(pricingProductEdits).length) {
        setPricingMessage('Salve ou descarte as alterações pendentes antes de usar uma ação para todos os produtos listados.', 'error');
        return;
    }
    const list = getFilteredPricingProducts();
    if (!list.length) {
        setPricingMessage('Nenhum produto listado para alterar.', 'error');
        return;
    }
    const scope = pricingProductCategories.length ? ` (${pricingProductCategories.join(', ')})` : '';
    const body = { action, codigos: list.map(p => p.codigo), note: '' };

    if (action === 'percent') {
        const percent = parseFloat(document.getElementById('bulkProductPercent')?.value);
        if (!Number.isFinite(percent) || percent === 0) {
            setPricingMessage('Informe o percentual (ex.: 5 para +5%, -3 para −3%).', 'error');
            return;
        }
        const sample = list[0];
        const before = currentFobFor(sample);
        const after = Math.round(before * (1 + percent / 100) * 100) / 100;
        if (!confirm(`Reajustar em ${percent}% o preço de ${list.length} produto(s)${scope}?\n\nExemplo: ${sample.codigo}: R$ ${formatBRL(before)} → R$ ${formatBRL(after)}\n\nEles passam a ter preço próprio e deixam de acompanhar os reajustes do grupo (até você usar "Voltar ao preço do grupo").`)) return;
        body.percent = percent;
    } else if (action === 'setLine') {
        const select = document.getElementById('bulkProductLine');
        const lineName = select?.selectedOptions[0]?.textContent || '';
        if (!confirm(`Mover ${list.length} produto(s)${scope} para o grupo "${lineName}"?\n\nQuem não tem preço próprio passa a usar o preço por kg desse grupo.`)) return;
        body.costLineKey = select.value;
    } else {
        const withOwn = list.filter(p => p.priceOverride != null).length;
        if (!withOwn) {
            setPricingMessage('Nenhum dos produtos listados tem preço próprio.', 'info');
            return;
        }
        if (!confirm(`${withOwn} produto(s)${scope} voltam a seguir o preço do grupo. Confirmar?`)) return;
    }
    await sendPricingChange('pricing.bulkProducts', body);
}

async function createPricingProduct() {
    const value = id => document.getElementById(id)?.value.trim() || '';
    const price = parseFloat(value('newProductPrice'));
    await sendPricingChange('pricing.saveProduct', {
        product: {
            isNew: true,
            codigo: value('newProductCodigo'),
            descricao: value('newProductDescricao'),
            categoria: value('newProductCategoria'),
            subcat: value('newProductSubcat'),
            costLineKey: value('newProductLine'),
            weight: parseFloat(value('newProductWeight')) || 0,
            priceOverride: Number.isFinite(price) && price > 0 ? price : null,
            minMargin: parseFloat(value('newProductMinMargin')) || 0,
            ncm: value('newProductNcm'),
            active: true
        },
        note: 'Novo produto'
    });
}

// ----- Reajuste em lote -----

function renderPricingBulk(body) {
    if (!pricingCanEdit()) {
        body.innerHTML = '<div class="empty-state">O reajuste em lote é feito pelo gestor.</div>';
        return;
    }
    body.innerHTML = `
        <div class="pricing-bulk">
            <p class="pricing-hint">Aplica um percentual de uma vez. Primeiro pré-visualize: nada é gravado até você clicar em “Aplicar reajuste”. Os valores novos são arredondados para centavos. Para reajustar uma categoria de produtos, use a seção Produtos.</p>
            <div class="pricing-form-grid">
                <label>Aplicar em
                    <select id="bulkTarget" class="pricing-input" onchange="onBulkParamsChange(true)">
                        <option value="costLines">Grupos de preço</option>
                        <option value="freight">Frete</option>
                    </select>
                </label>
                <label>Percentual (%)<input id="bulkPercent" type="number" step="0.1" class="pricing-input" placeholder="Ex.: 5 ou -3" oninput="onBulkParamsChange()"></label>
                <label id="bulkModeLabel" class="pricing-form-wide">O que reajustar
                    <select id="bulkMode" class="pricing-input" onchange="onBulkParamsChange()">
                        <option value="priceAndCosts">Preço e custos juntos (mantém o markup) — recomendado</option>
                        <option value="price">Só o preço 100% NF (aumenta o markup)</option>
                        <option value="costs">Só os custos (reduz o markup)</option>
                    </select>
                </label>
            </div>
            <div class="pricing-bulk-select">
                <div><strong id="bulkSelectTitle">Grupos incluídos</strong>
                    <button type="button" class="pricing-link-btn" onclick="toggleBulkSelection(true)">marcar todas</button> ·
                    <button type="button" class="pricing-link-btn" onclick="toggleBulkSelection(false)">desmarcar todas</button>
                </div>
                <div id="bulkSelectList" class="pricing-chip-list"></div>
            </div>
            <input id="bulkNote" class="pricing-input pricing-input--text" maxlength="300" placeholder="Motivo (ex.: reajuste da resina de outubro)">
            <div class="pricing-savebar">
                <button type="button" class="btn-modal btn-modal-ghost" onclick="previewBulkAdjust()">👁️ Pré-visualizar</button>
                <button type="button" id="bulkApplyBtn" class="btn-modal btn-modal-primary" onclick="applyBulkAdjust()" disabled>Aplicar reajuste</button>
            </div>
            <div id="bulkPreview"></div>
        </div>`;
    renderBulkSelectList();
}

function renderBulkSelectList() {
    const target = document.getElementById('bulkTarget')?.value || 'costLines';
    const items = target === 'freight'
        ? [...new Set(pricingCatalog.freight.map(f => f.uf))].sort().map(uf => ({ value: uf, label: uf }))
        : pricingCatalog.costLines.map(l => ({ value: l.key, label: l.name }));
    document.getElementById('bulkSelectTitle').textContent = target === 'freight' ? 'UFs incluídas' : 'Grupos incluídos';
    document.getElementById('bulkModeLabel').hidden = target === 'freight';
    document.getElementById('bulkSelectList').innerHTML = items.map(i => `
        <label class="pricing-chip"><input type="checkbox" class="bulk-item" value="${escapeHtml(i.value)}" checked onchange="onBulkParamsChange()"> ${escapeHtml(i.label)}</label>`).join('');
}

function onBulkParamsChange(targetChanged = false) {
    if (targetChanged) renderBulkSelectList();
    pricingBulkPreview = null;
    const applyBtn = document.getElementById('bulkApplyBtn');
    if (applyBtn) applyBtn.disabled = true;
    const preview = document.getElementById('bulkPreview');
    if (preview) preview.innerHTML = '';
}

function toggleBulkSelection(checked) {
    document.querySelectorAll('#bulkSelectList .bulk-item').forEach(cb => { cb.checked = checked; });
    onBulkParamsChange();
}

function getBulkParams() {
    const percent = parseFloat(document.getElementById('bulkPercent')?.value);
    if (!Number.isFinite(percent) || percent === 0) {
        setPricingMessage('Informe o percentual do reajuste (ex.: 5 para +5%, -3 para −3%).', 'error');
        return null;
    }
    const keys = [...document.querySelectorAll('#bulkSelectList .bulk-item:checked')].map(cb => cb.value);
    if (!keys.length) {
        setPricingMessage('Marque ao menos um item para reajustar.', 'error');
        return null;
    }
    const target = document.getElementById('bulkTarget').value;
    return { target, percent, mode: target === 'costLines' ? document.getElementById('bulkMode').value : '', keys };
}

function formatPricingValue(field, value) {
    if (field === 'price_override' && (value === null || value === undefined || value === '')) return 'preço do grupo';
    if (value === null || value === undefined || value === '') return '—';
    if (field === 'weight') return formatBRL(parseFloat(value), 3);
    if (field === 'min_margin') return `%`;
    if (field === 'active') return String(value) === '1' ? 'Sim' : 'Não';
    if (field === 'cost_line_key') return costsData[value] ? costsData[value].name : String(value);
    if (PRICING_MONEY_FIELDS.includes(field)) return `R$ ${formatBRL(parseFloat(value))}`;
    return String(value);
}

async function previewBulkAdjust() {
    const params = getBulkParams();
    if (!params) return;
    setPricingMessage('');
    try {
        const data = await apiRequest('pricing.bulkAdjust', { method: 'POST', body: { ...params, preview: true } });
        pricingBulkPreview = { signature: JSON.stringify(params), count: data.changes.length };
        const rows = data.changes.map(c => {
            const variation = c.oldValue ? ((c.newValue / c.oldValue - 1) * 100) : 0;
            return `<tr><td>${escapeHtml(c.label)}</td><td>${escapeHtml(PRICING_FIELD_LABELS[c.field] || c.field)}</td>
                <td>${formatPricingValue(c.field, c.oldValue)}</td><td><strong>${formatPricingValue(c.field, c.newValue)}</strong></td>
                <td>${variation >= 0 ? '+' : ''}${formatBRL(variation, 2)}%</td></tr>`;
        }).join('');
        document.getElementById('bulkPreview').innerHTML = `
            <h4 class="pricing-preview-title">Pré-visualização: ${data.changes.length} valor(es) mudam</h4>
            <div class="results-table-container"><table class="pricing-table">
                <thead><tr><th>Item</th><th>Campo</th><th>Atual</th><th>Novo</th><th>Variação</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;
        document.getElementById('bulkApplyBtn').disabled = false;
    } catch (e) {
        setPricingMessage(e.message, 'error');
    }
}

async function applyBulkAdjust() {
    const params = getBulkParams();
    if (!params) return;
    if (!pricingBulkPreview || pricingBulkPreview.signature !== JSON.stringify(params)) {
        setPricingMessage('Os parâmetros mudaram: pré-visualize de novo antes de aplicar.', 'error');
        return;
    }
    if (!confirm(`Aplicar reajuste de ${params.percent}% em ${pricingBulkPreview.count} valor(es)? Vale imediatamente para todos os representantes.`)) return;
    const note = document.getElementById('bulkNote')?.value.trim() || '';
    pricingBulkPreview = null;
    await sendPricingChange('pricing.bulkAdjust', { ...params, note });
}

// ----- Histórico -----

function describePricingEntity(entry) {
    if (entry.entity === 'cost_line') return costsData[entry.entityKey] ? costsData[entry.entityKey].name : entry.entityKey;
    if (entry.entity === 'freight') return `Frete ${entry.entityKey.replace('/', ' · ')}`;
    if (entry.entity === 'product') return `Produto ${entry.entityKey}`;
    return 'Tabela inteira';
}

async function renderPricingHistory(body) {
    body.innerHTML = '<div class="empty-state">Carregando histórico…</div>';
    try {
        const data = await apiRequest('pricing.history');
        if (pricingTabSection !== 'history' || !body.isConnected) return;
        if (!data.history.length) {
            body.innerHTML = '<div class="empty-state">Nenhuma alteração registrada.</div>';
            return;
        }
        const rows = data.history.map(h => `
            <tr>
                <td>${new Date(h.createdAt).toLocaleString('pt-BR')}</td>
                <td>${escapeHtml(h.username || '')}</td>
                <td>${escapeHtml(describePricingEntity(h))}</td>
                <td>${escapeHtml(PRICING_FIELD_LABELS[h.field] || h.field)}</td>
                <td>${escapeHtml(formatPricingValue(h.field, h.oldValue))}</td>
                <td><strong>${escapeHtml(formatPricingValue(h.field, h.newValue))}</strong></td>
                <td>${escapeHtml(h.note || '')}</td>
            </tr>`).join('');
        body.innerHTML = `
            <p class="pricing-hint">Últimas 300 alterações, da mais recente para a mais antiga.</p>
            <div class="results-table-container"><table class="pricing-table">
                <thead><tr><th>Quando</th><th>Quem</th><th>Item</th><th>Campo</th><th>De</th><th>Para</th><th>Motivo</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;
    } catch (e) {
        body.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
}
