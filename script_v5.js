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

function getMarginStatus(margin) {
    if (margin > 15) {
        return { label: 'Verde', color: '#15803d', description: 'Margem segura' };
    }
    if (margin >= 11) {
        return { label: 'Amarelo', color: '#b45309', description: 'Margem de atenção' };
    }
    return { label: 'Vermelho', color: '#c53030', description: 'Margem crítica' };
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

        if (!saved && typeof restorePortalSnapshotIfAvailable === 'function') {
            restorePortalSnapshotIfAvailable();
        }
        
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

        // Para aprovar/rejeitar, permitir somente usuários específicos (Leon e Gabriel)
        const normalize = (s) => (typeof authManager !== 'undefined') ? authManager.normalizeUsername(s) : String(s || '').trim().toLowerCase();
        const currentNormalized = normalize(user);
        const allowedApprovers = [normalize('Leon'), normalize('Gabriel.Ferreira')];
        if (!allowedApprovers.includes(currentNormalized)) {
            alert('Apenas Gabriel ou Leon podem aprovar ou rejeitar pedidos.');
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
            const currentUser = (typeof authManager !== 'undefined') ? authManager.getCurrentUser() : null;
            const normalize = (s) => (typeof authManager !== 'undefined') ? authManager.normalizeUsername(s) : String(s || '').trim().toLowerCase();
            const allowedApprovers = [normalize('Leon'), normalize('Gabriel.Ferreira')];
            Array.from(statusSelect.options).forEach(opt => {
                if (['aprovado', 'rejeitado'].includes(opt.value) && !allowedApprovers.includes(normalize(currentUser))) {
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
        const snapshot = createPortalSnapshot();
        localStorage.setItem('portal_backup_snapshot', JSON.stringify(snapshot));
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

// ========== GERENCIADOR DE AUTENTICAÇÃO (LOCAL) ==========
const authManager = {
    users: {}, // username -> { passwordHash, role }
    currentUser: null,
    currentRole: null,

    normalizeUsername(username) {
        const normalized = String(username || '').trim().toLowerCase();
        return normalized === 'gabriel' ? 'gabriel.ferreira' : normalized;
    },

    findUser(username) {
        const normalized = this.normalizeUsername(username);
        if (!normalized) return null;
        const matchedKey = Object.keys(this.users).find(key => this.normalizeUsername(key) === normalized);
        return matchedKey ? { username: matchedKey, user: this.users[matchedKey] } : null;
    },

    async init() {
        const usersRaw = localStorage.getItem('hr_users');
        const current = localStorage.getItem('hr_currentUser');
        const currentRole = localStorage.getItem('hr_currentRole');
        try {
            const parsed = usersRaw ? JSON.parse(usersRaw) : {};
            // Compatibilidade com formato antigo: senha em string simples
            this.users = Object.entries(parsed).reduce((memo, [username, value]) => {
                if (typeof value === 'string') {
                    memo[username] = { passwordHash: value, role: 'vendedor' };
                } else {
                    memo[username] = {
                        passwordHash: value && value.passwordHash ? value.passwordHash : '',
                        role: String((value && value.role) || 'vendedor').trim().toLowerCase()
                    };
                }
                return memo;
            }, {});
        } catch (e) {
            this.users = {};
        }
        const currentUserEntry = this.findUser(current);
        this.currentUser = currentUserEntry ? currentUserEntry.username : null;
        this.currentRole = currentUserEntry ? String(currentUserEntry.user.role || 'vendedor').trim().toLowerCase() : null;

        // Garantir usuário padrão Leon como Desenvolvedor
        const defaultDevUser = 'Leon';
        const defaultDevPass = 'l24598';
        const defaultSupervisorUser = 'Gabriel.Ferreira';
        const defaultSupervisorPass = 'gf2026';

        const devHash = await this.hashPassword(defaultDevPass);
        const supervisorHash = await this.hashPassword(defaultSupervisorPass);

        const existingDev = this.findUser(defaultDevUser);
        if (!existingDev) {
            this.users[defaultDevUser] = { passwordHash: devHash, role: 'desenvolvedor' };
        } else {
            if (existingDev.user.passwordHash !== devHash) {
                this.users[existingDev.username].passwordHash = devHash;
            }
            if (existingDev.user.role !== 'desenvolvedor') {
                this.users[existingDev.username].role = 'desenvolvedor';
            }
        }

        const existingSupervisor = this.findUser(defaultSupervisorUser);
        if (!existingSupervisor) {
            this.users[defaultSupervisorUser] = { passwordHash: supervisorHash, role: 'supervisor' };
        } else {
            if (existingSupervisor.user.passwordHash !== supervisorHash) {
                this.users[existingSupervisor.username].passwordHash = supervisorHash;
            }
            if (existingSupervisor.user.role !== 'supervisor') {
                this.users[existingSupervisor.username].role = 'supervisor';
            }
        }

        if (this.currentUser && this.users[this.currentUser]) {
            this.currentRole = this.users[this.currentUser].role;
        }

        this.save();
        this.updateUI();
    },

    async hashPassword(password) {
        const fallbackHashes = {
            l24598: '1367a34fa85547737f3e5f23eaf4dea178c49f17b16bc8b599849663313e69b1',
            gf2026: '31df622c549e72945b4ad2405dc7c0ae00ff845b5a715dd86f7f4500075c8251'
        };
        if (!globalThis.crypto || !globalThis.crypto.subtle) {
            if (Object.prototype.hasOwnProperty.call(fallbackHashes, password)) {
                return fallbackHashes[password];
            }
            throw new Error('A segurança do navegador está indisponível. Abra o portal por um servidor local.');
        }
        const enc = new TextEncoder();
        const data = enc.encode(password);
        const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async register(username, password, role = 'vendedor') {
        const normalized = this.normalizeUsername(username);
        if (!normalized || !password) throw new Error('Usuário ou senha inválidos');
        if (this.findUser(username)) throw new Error('Usuário já existe');
        const h = await this.hashPassword(password);
        const normalizedRole = String(role || 'vendedor').trim().toLowerCase();
        this.users[username.trim()] = { passwordHash: h, role: normalizedRole };
        this.currentUser = username.trim();
        this.currentRole = normalizedRole;
        this.save();
        this.updateUI();
        return true;
    },

    async login(username, password) {
        const normalized = this.normalizeUsername(username);
        if (!normalized || !password) throw new Error('Usuário ou senha inválidos');
        const found = this.findUser(username);
        if (!found) {
            throw new Error('Credenciais incorretas');
        }
        const h = await this.hashPassword(password);
        if (found.user.passwordHash !== h) {
            throw new Error('Credenciais incorretas');
        }
        this.currentUser = found.username;
        this.currentRole = String(found.user.role || 'vendedor').trim().toLowerCase();
        this.save();
        this.updateUI();
        return true;
    },

    logout() {
        this.currentUser = null;
        this.currentRole = null;
        this.save();
        this.updateUI();
    },

    save() {
        localStorage.setItem('hr_users', JSON.stringify(this.users));
        localStorage.setItem('hr_currentUser', this.currentUser || '');
        localStorage.setItem('hr_currentRole', this.currentRole || '');
        if (typeof savePortalSnapshot === 'function') {
            savePortalSnapshot();
        }
    },

    getCurrentUser() {
        return this.currentUser;
    },

    getCurrentUserRole() {
        return String(this.currentRole || 'vendedor').trim().toLowerCase();
    },

    updateUI() {
        const loginBtn = document.getElementById('loginBtn');
        const currentUserDiv = document.getElementById('currentUser');
        const currentUserName = document.getElementById('currentUserName');
        const supervisorBtn = document.getElementById('supervisorBtn');

        if (!loginBtn || !currentUserDiv || !currentUserName || !supervisorBtn) return;

        if (this.currentUser) {
            loginBtn.style.display = 'none';
            currentUserDiv.style.display = 'flex';
            currentUserName.textContent = `${this.currentUser} (${this.getCurrentUserRole()})`;
            if (['supervisor', 'desenvolvedor'].includes(this.getCurrentUserRole())) {
                supervisorBtn.style.display = 'inline-flex';
            } else {
                supervisorBtn.style.display = 'none';
            }
        } else {
            loginBtn.style.display = 'inline-block';
            currentUserDiv.style.display = 'none';
            currentUserName.textContent = '--';
            supervisorBtn.style.display = 'none';
        }
        // Refresh drafts, history and supervisor panel when UI changes (login/logout)
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
        if (typeof savePortalSnapshot === 'function') {
            savePortalSnapshot();
        }
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

// ========== GERENCIADOR DE SUBMISSÃO DE PEDIDOS ==========
function readJsonStorage(key, fallback = {}) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function createPortalSnapshot() {
    const orderSubmissions = orderSubmissionManager && orderSubmissionManager.submissions && Object.keys(orderSubmissionManager.submissions).length
        ? orderSubmissionManager.submissions
        : readJsonStorage('orderSubmissions', {});
    const deletedSubmissions = deletedSubmissionsManager && deletedSubmissionsManager.deleted && Object.keys(deletedSubmissionsManager.deleted).length
        ? deletedSubmissionsManager.deleted
        : readJsonStorage('orderDeletions', {});

    return {
        exportedAt: new Date().toISOString(),
        version: 1,
        data: {
            orderSubmissions,
            deletedSubmissions,
            hr_users: authManager && authManager.users ? authManager.users : readJsonStorage('hr_users', {}),
            hr_currentUser: authManager && authManager.currentUser ? authManager.currentUser : (localStorage.getItem('hr_currentUser') || ''),
            hr_currentRole: authManager && authManager.currentRole ? authManager.currentRole : (localStorage.getItem('hr_currentRole') || ''),
            orderMeta: orderManager && orderManager.meta ? orderManager.meta : readJsonStorage('orderMeta', { createdBy: null, createdAt: null }),
            orderStatus: statusManager && statusManager.currentStatus ? statusManager.currentStatus : (localStorage.getItem('orderStatus') || 'rascunho'),
            orderStatusHistory: statusManager && statusManager.history ? statusManager.history : readJsonStorage('orderStatusHistory', [])
        }
    };
}

function savePortalSnapshot() {
    try {
        const currentOrderSubmissions = orderSubmissionManager && orderSubmissionManager.submissions ? orderSubmissionManager.submissions : readJsonStorage('orderSubmissions', {});
        const currentDeletedSubmissions = deletedSubmissionsManager && deletedSubmissionsManager.deleted ? deletedSubmissionsManager.deleted : readJsonStorage('orderDeletions', {});
        const backupOrderSubmissions = readJsonStorage('orderSubmissionsBackup', {});
        const hasStoredData = Object.keys(currentOrderSubmissions || {}).length > 0 || Object.keys(currentDeletedSubmissions || {}).length > 0 || Object.keys(backupOrderSubmissions || {}).length > 0;
        if (!hasStoredData) {
            return;
        }

        const snapshot = createPortalSnapshot();
        localStorage.setItem('portal_backup_snapshot', JSON.stringify(snapshot));
        localStorage.setItem('portal_backup_snapshot_latest', JSON.stringify(snapshot));
    } catch (error) {
        console.warn('Não foi possível salvar snapshot automático:', error);
    }
}

function restorePortalSnapshotIfAvailable() {
    try {
        const currentSaved = localStorage.getItem('orderSubmissions');
        let currentOrderMap = {};
        try {
            currentOrderMap = currentSaved ? JSON.parse(currentSaved) : {};
        } catch (_) {
            currentOrderMap = {};
        }

        if (currentSaved && currentSaved !== 'null' && Object.keys(currentOrderMap || {}).length > 0) {
            return true;
        }

        const backupSaved = localStorage.getItem('orderSubmissionsBackup');
        let backupOrderMap = {};
        try {
            backupOrderMap = backupSaved ? JSON.parse(backupSaved) : {};
        } catch (_) {
            backupOrderMap = {};
        }

        if (backupSaved && backupSaved !== 'null' && Object.keys(backupOrderMap || {}).length > 0) {
            localStorage.setItem('orderSubmissions', JSON.stringify(backupOrderMap));
            if (orderSubmissionManager) orderSubmissionManager.submissions = backupOrderMap;
            return true;
        }

        const raw = localStorage.getItem('portal_backup_snapshot') || localStorage.getItem('portal_backup_snapshot_latest');
        if (!raw) return false;
        const snapshot = JSON.parse(raw);
        const data = snapshot && snapshot.data ? snapshot.data : snapshot;
        if (!data) return false;

        const hasOrderData = !!(data.orderSubmissions && Object.keys(data.orderSubmissions).length > 0);
        const hasUserData = !!(data.hr_users && Object.keys(data.hr_users).length > 0);
        if (!hasOrderData && !hasUserData) return false;

        const restoredOrderMap = data.orderSubmissions && Object.keys(data.orderSubmissions).length > 0
            ? Object.assign({}, currentOrderMap || {}, data.orderSubmissions || {})
            : (currentOrderMap || {});

        if (data.orderSubmissions) {
            localStorage.setItem('orderSubmissions', JSON.stringify(restoredOrderMap));
            if (orderSubmissionManager) orderSubmissionManager.submissions = restoredOrderMap;
        }
        if (data.deletedSubmissions) {
            localStorage.setItem('orderDeletions', JSON.stringify(data.deletedSubmissions));
            if (deletedSubmissionsManager) deletedSubmissionsManager.deleted = data.deletedSubmissions;
        }
        if (data.hr_users) {
            localStorage.setItem('hr_users', JSON.stringify(data.hr_users));
            if (authManager) authManager.users = data.hr_users;
        }
        if (data.hr_currentUser !== undefined) {
            localStorage.setItem('hr_currentUser', String(data.hr_currentUser || ''));
            if (authManager) authManager.currentUser = data.hr_currentUser || null;
        }
        if (data.hr_currentRole !== undefined) {
            localStorage.setItem('hr_currentRole', String(data.hr_currentRole || ''));
            if (authManager) authManager.currentRole = data.hr_currentRole || null;
        }
        if (data.orderMeta) {
            localStorage.setItem('orderMeta', JSON.stringify(data.orderMeta));
            if (orderManager) orderManager.meta = data.orderMeta;
        }
        if (data.orderStatus !== undefined) {
            localStorage.setItem('orderStatus', String(data.orderStatus));
            if (statusManager) statusManager.currentStatus = data.orderStatus || 'rascunho';
        }
        if (data.orderStatusHistory) {
            localStorage.setItem('orderStatusHistory', JSON.stringify(data.orderStatusHistory));
            if (statusManager) statusManager.history = Array.isArray(data.orderStatusHistory) ? data.orderStatusHistory : [];
        }

        return true;
    } catch (error) {
        console.warn('Backup automático indisponível:', error);
        return false;
    }
}

window.createPortalSnapshot = createPortalSnapshot;
window.savePortalSnapshot = savePortalSnapshot;
window.restorePortalSnapshotIfAvailable = restorePortalSnapshotIfAvailable;

const orderSubmissionManager = {
    submissions: {}, // id -> { id, orderNumber, clientName, representativeName, cart, status, submittedAt, submittedBy, rejectionReason, rejectionBy, rejectionAt, approvalAt, supervisorNote }

    init() {
        const saved = localStorage.getItem('orderSubmissions');
        const backup = localStorage.getItem('orderSubmissionsBackup') || localStorage.getItem('orderSubmissions_backup');
        const snapshotRaw = localStorage.getItem('portal_backup_snapshot') || localStorage.getItem('portal_backup_snapshot_latest');

        try {
            const parsedSaved = saved && saved !== 'null' ? JSON.parse(saved) : null;
            const parsedBackup = backup && backup !== 'null' ? JSON.parse(backup) : null;
            const parsedSnapshot = snapshotRaw && snapshotRaw !== 'null' ? JSON.parse(snapshotRaw) : null;
            const snapshotData = parsedSnapshot && parsedSnapshot.data ? parsedSnapshot.data : parsedSnapshot;
            const parsedSnapshotOrders = snapshotData && snapshotData.orderSubmissions ? snapshotData.orderSubmissions : null;

            const merged = Object.assign(
                {},
                parsedBackup && typeof parsedBackup === 'object' ? parsedBackup : {},
                parsedSaved && typeof parsedSaved === 'object' ? parsedSaved : {},
                parsedSnapshotOrders && typeof parsedSnapshotOrders === 'object' ? parsedSnapshotOrders : {}
            );

            this.submissions = merged && Object.keys(merged).length > 0 ? merged : {};

            if (Object.keys(this.submissions).length > 0) {
                localStorage.setItem('orderSubmissions', JSON.stringify(this.submissions));
                localStorage.setItem('orderSubmissionsBackup', JSON.stringify(this.submissions));
            }
        } catch (e) {
            this.submissions = {};
            const fallback = (backup && backup !== 'null') ? (() => { try { return JSON.parse(backup); } catch (_) { return {}; } })() : {};
            this.submissions = fallback && Object.keys(fallback).length > 0 ? fallback : {};
            if (Object.keys(this.submissions).length > 0) {
                localStorage.setItem('orderSubmissions', JSON.stringify(this.submissions));
                localStorage.setItem('orderSubmissionsBackup', JSON.stringify(this.submissions));
            }
        }

        if (!Object.keys(this.submissions || {}).length && typeof restorePortalSnapshotIfAvailable === 'function') {
            restorePortalSnapshotIfAvailable();
        }
    },

    save() {
        if (!this.submissions || Object.keys(this.submissions).length === 0) {
            const backup = localStorage.getItem('orderSubmissionsBackup');
            if (backup && backup !== 'null') {
                try {
                    const parsed = JSON.parse(backup);
                    if (parsed && Object.keys(parsed).length > 0) {
                        this.submissions = parsed;
                        localStorage.setItem('orderSubmissions', JSON.stringify(parsed));
                        return;
                    }
                } catch (_) {}
            }
            return;
        }

        const serialized = JSON.stringify(this.submissions);
        localStorage.setItem('orderSubmissions', serialized);
        localStorage.setItem('orderSubmissionsBackup', serialized);
        if (typeof savePortalSnapshot === 'function') {
            savePortalSnapshot();
        }
    },

    generateId() {
        return 'order_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    saveDraft(orderNumber, clientName, representativeName, cart, savedBy, draftId = null, proposalValidity = '') {
        if (cart.length === 0) {
            throw new Error('Adicione itens antes de salvar o rascunho.');
        }

        const now = new Date().toISOString();
        if (draftId && this.submissions[draftId] && this.submissions[draftId].status !== 'rascunho') {
            draftId = null;
        }
        const id = draftId && this.submissions[draftId] ? draftId : this.generateId();
        this.submissions[id] = {
            id,
            orderNumber: orderNumber?.trim() || '',
            clientName: clientName?.trim() || '',
            representativeName: representativeName?.trim() || '',
            proposalValidity: proposalValidity?.trim() || this.submissions[id]?.proposalValidity || '',
            cart: JSON.parse(JSON.stringify(cart)),
            status: 'rascunho',
            submittedAt: this.submissions[id]?.submittedAt || '',
            submittedBy: this.submissions[id]?.submittedBy || savedBy,
            savedAt: now,
            savedBy: savedBy,
            rejectionReason: '',
            rejectionBy: '',
            rejectionAt: '',
            approvalAt: '',
            approvalBy: '',
            supervisorNote: this.submissions[id]?.supervisorNote || ''
        };

        this.save();
        return id;
    },

    loadDrafts() {
        return this.getDrafts();
    },

    submitOrder(orderNumber, clientName, representativeName, cart, submittedBy, draftId = null, proposalValidity = '') {
        if (!orderNumber?.trim() || cart.length === 0) {
            throw new Error('Pedido deve ter número e itens');
        }

        const now = new Date().toISOString();
        const useDraftId = draftId && this.submissions[draftId] && this.submissions[draftId].status === 'rascunho';
        const id = useDraftId ? draftId : this.generateId();
        this.submissions[id] = {
            id,
            orderNumber: orderNumber.trim(),
            clientName: clientName.trim(),
            representativeName: representativeName.trim(),
            proposalValidity: proposalValidity?.trim() || this.submissions[id]?.proposalValidity || '',
            cart: JSON.parse(JSON.stringify(cart)), // Deep copy
            status: 'analise', // analise, aprovado, rejeitado, rascunho
            submittedAt: now,
            submittedBy: submittedBy,
            savedAt: this.submissions[id]?.savedAt || now,
            savedBy: this.submissions[id]?.savedBy || submittedBy,
            rejectionReason: '',
            rejectionBy: '',
            rejectionAt: '',
            approvalAt: '',
            approvalBy: '',
            supervisorNote: this.submissions[id]?.supervisorNote || ''
        };

        this.save();
        return id;
    },

    getAll() {
        return Object.values(this.submissions);
    },

    getPending() {
        if (!this.submissions) return [];
        return Object.values(this.submissions).filter(s => s.status === 'analise');
    },

    getDrafts() {
        if (!this.submissions) return [];
        return Object.values(this.submissions).filter(s => s.status === 'rascunho');
    },

    getUserSubmissions(user) {
        const normalizedUser = authManager.normalizeUsername(user);
        return Object.values(this.submissions).filter(s =>
            authManager.normalizeUsername(s.submittedBy) === normalizedUser ||
            authManager.normalizeUsername(s.savedBy) === normalizedUser
        );
    },

    calculateMargin(submission) {
        if (!submission || !Array.isArray(submission.cart) || submission.cart.length === 0) return 0;
        let totalWeightedMargin = 0;
        let totalQty = 0;
        submission.cart.forEach(item => {
            const negotiatedPrice = Math.max(item.negotiatedPrice || item.cif || 0, 0);
            const fob = parseFloat(item.fob || 0) || 0;
            const marginPercent = negotiatedPrice > 0 ? ((negotiatedPrice - fob) / negotiatedPrice) * 100 : 0;
            const qty = parseFloat(item.qty || 0) || 0;
            totalWeightedMargin += marginPercent * qty;
            totalQty += qty;
        });
        return totalQty > 0 ? totalWeightedMargin / totalQty : 0;
    },

    refreshMissedForecastDates() {
        const all = Object.values(this.submissions || {});
        all.forEach(submission => {
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
        this.save();
    },

    approve(submissionIds, approvedBy, supervisorNote = '') {
        const ids = Array.isArray(submissionIds) ? submissionIds : [submissionIds];
        ids.forEach(id => {
            if (this.submissions[id]) {
                this.submissions[id].status = 'aprovado';
                this.submissions[id].approvalAt = new Date().toISOString();
                this.submissions[id].approvalBy = approvedBy;
                const approvalDate = new Date(this.submissions[id].approvalAt);
                const predictedBilling = new Date(approvalDate.getTime() + 8 * 24 * 60 * 60 * 1000);
                this.submissions[id].predictedBillingDate = predictedBilling.toISOString();
                this.submissions[id].rejectionReason = '';
                this.submissions[id].supervisorNote = supervisorNote || this.submissions[id].supervisorNote || '';
                try {
                    if (typeof statusManager !== 'undefined' && statusManager && typeof statusManager.addHistoryEntry === 'function') {
                        statusManager.addHistoryEntry('aprovado', 'Aprovado por supervisor', approvedBy);
                        statusManager.currentStatus = 'aprovado';
                        statusManager.updateUI();
                    }
                } catch (e) {
                    console.warn('Não foi possível registrar histórico de aprovação:', e);
                }
            }
        });
        this.save();
    },

    reject(submissionIds, reason, rejectedBy, supervisorNote = '') {
        const ids = Array.isArray(submissionIds) ? submissionIds : [submissionIds];
        ids.forEach(id => {
            if (this.submissions[id]) {
                this.submissions[id].status = 'rejeitado';
                this.submissions[id].rejectionReason = reason || '';
                this.submissions[id].rejectionBy = rejectedBy;
                this.submissions[id].rejectionAt = new Date().toISOString();
                this.submissions[id].supervisorNote = supervisorNote || this.submissions[id].supervisorNote || '';
                try {
                    if (typeof statusManager !== 'undefined' && statusManager && typeof statusManager.addHistoryEntry === 'function') {
                        statusManager.addHistoryEntry('rejeitado', reason || 'Rejeitado pelo supervisor', rejectedBy);
                        statusManager.currentStatus = 'rejeitado';
                        statusManager.updateUI();
                    }
                } catch (e) {
                    console.warn('Não foi possível registrar histórico de rejeição:', e);
                }
            }
        });
        this.save();
    },

    setSupervisorNote(submissionId, note) {
        const submission = this.submissions[submissionId];
        if (!submission) return false;
        submission.supervisorNote = note || '';
        this.save();
        return true;
    },

    getById(id) {
        return this.submissions[id] || null;
    },

    deleteSubmission(id) {
        if (this.submissions[id]) {
            delete this.submissions[id];
            this.save();
            return true;
        }
        return false;
    },

    getByOrderNumber(orderNumber) {
        return Object.values(this.submissions).find(s => s.orderNumber === orderNumber);
    }
};

// ========== GERENCIADOR DE NÚMEROS HIPER ROLL ==========
const hiperrollOrderNumberManager = {
    counterKey: 'hiperroll_order_counter',
    
    init() {
        // Inicializar contador se não existir
        if (!localStorage.getItem(this.counterKey)) {
            localStorage.setItem(this.counterKey, '0');
        }
    },
    
    getNextOrderNumber() {
        const currentCounter = parseInt(localStorage.getItem(this.counterKey)) || 0;
        const nextCounter = currentCounter + 1;
        localStorage.setItem(this.counterKey, nextCounter.toString());
        
        // Formatar com 5 dígitos (00001, 00002, etc.)
        return String(nextCounter).padStart(5, '0');
    },
    
    getCurrentOrderNumber() {
        const currentCounter = parseInt(localStorage.getItem(this.counterKey)) || 0;
        return String(currentCounter).padStart(5, '0');
    },
    
    resetCounter() {
        localStorage.setItem(this.counterKey, '0');
    }
};

// ========== GERENCIADOR DE EXCLUSÕES (HISTÓRICO/LIXEIRA) ==========
const deletedSubmissionsManager = {
    deletedKey: 'orderDeletions',
    deleted: {}, // id -> { id, originalSubmission, deletedAt, deletedBy, reason }

    init() {
        const saved = localStorage.getItem(this.deletedKey);
        try {
            this.deleted = saved ? JSON.parse(saved) : {};
        } catch (e) {
            this.deleted = {};
        }
    },

    save() {
        localStorage.setItem(this.deletedKey, JSON.stringify(this.deleted));
        if (typeof savePortalSnapshot === 'function') {
            savePortalSnapshot();
        }
    },

    archiveSubmission(submissionId, submission, deletedBy = 'Sistema', reason = '') {
        if (!submission) return false;
        
        const now = new Date().toISOString();
        this.deleted[submissionId] = {
            id: submissionId,
            orderNumber: submission.orderNumber,
            clientName: submission.clientName,
            representativeName: submission.representativeName,
            status: submission.status,
            cart: JSON.parse(JSON.stringify(submission.cart)),
            submittedAt: submission.submittedAt,
            submittedBy: submission.submittedBy,
            deletedAt: now,
            deletedBy: deletedBy,
            reason: reason || ''
        };
        
        this.save();
        return true;
    },

    getAll() {
        return Object.values(this.deleted).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    },

    getById(id) {
        return this.deleted[id] || null;
    },

    deleteByUser(user) {
        return Object.values(this.deleted).filter(d => 
            authManager.normalizeUsername(d.deletedBy) === authManager.normalizeUsername(user)
        );
    },

    deleteByOrderNumber(orderNumber) {
        return Object.values(this.deleted).find(d => d.orderNumber === orderNumber);
    },

    restore(submissionId) {
        if (!this.deleted[submissionId]) return null;
        
        const submission = this.deleted[submissionId];
        const restored = {
            id: submissionId,
            orderNumber: submission.orderNumber,
            clientName: submission.clientName,
            representativeName: submission.representativeName,
            cart: JSON.parse(JSON.stringify(submission.cart)),
            status: 'rascunho', // Restaurado como rascunho
            submittedAt: submission.submittedAt,
            submittedBy: submission.submittedBy,
            savedAt: new Date().toISOString(),
            savedBy: authManager.getCurrentUser(),
            rejectionReason: '',
            rejectionBy: '',
            rejectionAt: '',
            approvalAt: '',
            approvalBy: '',
            supervisorNote: ''
        };
        
        delete this.deleted[submissionId];
        this.save();
        return restored;
    },

    permanentlyDelete(submissionId) {
        if (this.deleted[submissionId]) {
            delete this.deleted[submissionId];
            this.save();
            return true;
        }
        return false;
    },

    count() {
        return Object.keys(this.deleted).length;
    },

    updateBilledQuantities(submissionId, billedItemsMap) {
        const deletion = this.deleted[submissionId];
        if (!deletion) return false;
        
        if (!deletion.billedQuantities) deletion.billedQuantities = {};
        
        // Atualizar quantidades faturadas
        (Array.isArray(deletion.cart) ? deletion.cart : []).forEach(item => {
            const addedQty = billedItemsMap[item.codigo] || 0;
            const currentTotal = (deletion.billedQuantities[item.codigo] || 0) + addedQty;
            deletion.billedQuantities[item.codigo] = Math.min(currentTotal, item.qty);
        });
        
        this.save();
        return true;
    }
};

// =========================================================

async function init() {
    // Inicializar autenticação e sistema de status
    await authManager.init();
    orderManager.init();
    statusManager.init();
    orderSubmissionManager.init();
    hiperrollOrderNumberManager.init();
    deletedSubmissionsManager.init();

    const totalSavedOrders = Object.keys(orderSubmissionManager.submissions || {}).length;
    const storageEmpty = totalSavedOrders === 0 && (!localStorage.getItem('hr_currentUser') || !localStorage.getItem('orderSubmissions'));
    if (storageEmpty) {
        console.warn('[Portal Hiperroll] Storage local vazio ou sem pedidos. Backup automático será restaurado se existir.');
    }
    
    // Gerar número Hiper Roll se não existir
    const orderNumberField = document.getElementById('orderNumberHiperroll');
    if (orderNumberField && !orderNumberField.value) {
        const nextNumber = hiperrollOrderNumberManager.getNextOrderNumber();
        orderNumberField.value = nextNumber;
    }
    
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

    updateHeaderInfo();

    renderDraftsPanel();

    if (!authManager.getCurrentUser()) {
        showLoginModal();
    } else {
        closeLoginModal();
    }
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
                    <div style="font-size:0.85rem; color:#666">${p.descricao}</div>
                </td>
                <td>${p.peso.toFixed(3)}</td>
                <td class="price-tag price-fob">R$&nbsp;${fobPrice.toFixed(2)}</td>
                <td class="price-tag price-cif">R$&nbsp;${cifDisplay}</td>
                <td class="col-action">
                    <button onclick="addToCart('${p.codigo}', ${fobPrice}, ${cifPrice}, ${p.weightRaw})" 
                            style="padding: 5px 10px; cursor: pointer; background: var(--secondary); color:white; border:none; border-radius:4px;">
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

function updateOrderTable() {
    const container = document.getElementById('orderTableContainer');
    const summaryDiv = document.getElementById('orderSummary');
    const discount = parseFloat(document.getElementById('orderDiscount').value) || 0;
    const contract = parseFloat(document.getElementById('orderContract').value) || 0;

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum item no pedido.</div>';
        summaryDiv.style.display = 'none';
        return;
    }

    summaryDiv.style.display = 'block';

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
                    <th>Margem (%)</th>
                    <th>Subtotal</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
    `;

    let totalWeight = 0;
    let totalFob = 0;
    let totalCif = 0;
    let totalMargin = 0;

    cart.forEach((item, idx) => {
        const subWeight = item.weight * item.qty;
        const subFob = item.fob * item.qty;
        const negotiatedPrice = Math.max(item.negotiatedPrice || item.cif, 0);
        const unitDiscount = Math.max(item.unitDiscount || 0, 0);
        const discountPercent = item.cif > 0 ? (unitDiscount / item.cif) * 100 : 0;
        const subCifWithDiscountContract = negotiatedPrice * (1 - discount/100) * (1 + contract / 100) * item.qty;
        const itemMarginPercent = negotiatedPrice > 0 ? ((negotiatedPrice - item.fob) / negotiatedPrice) * 100 : 0;

        totalWeight += subWeight;
        totalFob += subFob;
        totalCif += subCifWithDiscountContract;
        totalMargin += itemMarginPercent * item.qty; // Acumula margem ponderada

        html += `
            <tr>
                <td>
                    <div style="font-weight:600">${item.codigo}</div>
                    <div style="font-size:0.85rem; color:#666">${item.descricao}</div>
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
                    <span style="color: ${
                        itemMarginPercent > 15 ? '#15803d' :
                        itemMarginPercent >= 11 ? '#b45309' :
                        '#c53030'
                    }">
                        ${itemMarginPercent.toFixed(2)}%
                    </span>
                </td>
                <td class="price-tag">R$&nbsp;${subCifWithDiscountContract.toFixed(2)}</td>
                <td class="col-action">
                    <button onclick="removeFromCart(${idx})" style="background:none; border:none; color:red; cursor:pointer;">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Calcular margem média
    const marginMediana = cart.length > 0 ? totalMargin / cart.reduce((sum, item) => sum + item.qty, 0) : 0;
    
    // Atualizar totais
    document.getElementById('totalWeight').textContent = totalWeight.toFixed(3);
    document.getElementById('totalFob').textContent = totalFob.toFixed(2);
    document.getElementById('totalCif').textContent = totalCif.toFixed(2);

    // Update print-only summary values for discount and contract
    const printDiscountEl = document.getElementById('printDiscount');
    const printContractEl = document.getElementById('printContract');
    if (printDiscountEl) printDiscountEl.textContent = discount.toFixed(2) + '%';
    if (printContractEl) printContractEl.textContent = contract.toFixed(2) + '%';
    
    // Atualizar margem média e risco do pedido
    const marginPercentageElement = document.getElementById('marginPercentage');
    marginPercentageElement.textContent = marginMediana.toFixed(2) + '%';
    currentOrderMargin = marginMediana;
    
    // Aplicar classe de alerta visual baseada na margem
    const totalsPriceContainer = document.getElementById('totalsPriceContainer');
    
    // Limpar todas as classes anteriores
    totalsPriceContainer.classList.remove('margin-alert', 'margin-warning', 'margin-good');
    marginPercentageElement.style.color = '';
    
    // Aplicar a classe correta baseada na margem
    if (marginMediana > 15) {
        // Verde: Margem boa
        totalsPriceContainer.classList.add('margin-good');
        marginPercentageElement.style.color = '#15803d';
    } else if (marginMediana >= 11) {
        // Amarelo: Margem de transição/aviso
        totalsPriceContainer.classList.add('margin-warning');
        marginPercentageElement.style.color = '#b45309';
    } else {
        // Vermelho: Margem crítica
        totalsPriceContainer.classList.add('margin-alert');
        marginPercentageElement.style.color = '#c53030';
    }
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
    const discount = parseFloat(document.getElementById('orderDiscount').value) || 0;
    const contract = parseFloat(document.getElementById('orderContract').value) || 0;
    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '---';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '---';
    const loadedDraftNumber = document.getElementById('loadedDraftNumber')?.value.trim() || '';
    const orderNumber = loadedDraftNumber || orderNumberClient || orderNumberHiperroll;
    const clientName = document.getElementById('clientName')?.value.trim() || '---';
    const representativeName = document.getElementById('representativeName')?.value.trim() || '---';
    const proposalValidity = normalizeProposalValidity(document.getElementById('proposalValidity')?.value || '');
    const dateStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    let totalWeight = 0;
    let totalFob = 0;
    let totalCif = 0;
    let totalMargin = 0;
    let rowsHtml = '';

    cart.forEach(item => {
        const subWeight = item.weight * item.qty;
        const subFob = item.fob * item.qty;
        const negotiatedPrice = Math.max(item.negotiatedPrice || item.cif, 0);
        const unitDiscount = Math.max(item.unitDiscount || 0, 0);
        const subtotal = negotiatedPrice * (1 - discount / 100) * (1 + contract / 100) * item.qty;
        const marginPercent = negotiatedPrice > 0 ? ((negotiatedPrice - item.fob) / negotiatedPrice) * 100 : 0;

        totalWeight += subWeight;
        totalFob += subFob;
        totalCif += subtotal;
        totalMargin += marginPercent * item.qty;

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

    const averageMargin = cart.length > 0 ? totalMargin / cart.reduce((sum, item) => sum + item.qty, 0) : 0;

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
            <div class="summary-row"><span>Peso Total:</span> <strong>${totalWeight.toFixed(3)} Kg</strong></div>
            <div class="summary-row"><span>Total FOB:</span> <strong>${formatCurrency(totalFob)}</strong></div>
            <div class="summary-row"><span>Total CIF:</span> <strong>${formatCurrency(totalCif)}</strong></div>
            <div class="summary-row"><span>Margem Média:</span> <strong>${averageMargin.toFixed(2)}%</strong></div>
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

function exportPortalBackup() {
    const snapshot = {
        exportedAt: new Date().toISOString(),
        version: 1,
        data: {
            orderSubmissions: orderSubmissionManager && orderSubmissionManager.submissions ? orderSubmissionManager.submissions : {},
            deletedSubmissions: deletedSubmissionsManager && deletedSubmissionsManager.deleted ? deletedSubmissionsManager.deleted : {},
            hr_users: authManager && authManager.users ? authManager.users : {},
            hr_currentUser: authManager && authManager.currentUser ? authManager.currentUser : '',
            hr_currentRole: authManager && authManager.currentRole ? authManager.currentRole : '',
            orderMeta: orderManager && orderManager.meta ? orderManager.meta : {},
            orderStatus: statusManager && statusManager.currentStatus ? statusManager.currentStatus : 'rascunho',
            orderStatusHistory: statusManager && statusManager.history ? statusManager.history : []
        }
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `portal_hiperroll_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')} .json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    alert('Backup exportado com sucesso. Guarde este arquivo em local seguro.');
}

function restorePortalBackupPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const snapshot = JSON.parse(String(reader.result || '{}'));
                const data = snapshot && snapshot.data ? snapshot.data : snapshot;
                if (data && data.orderSubmissions) {
                    localStorage.setItem('orderSubmissions', JSON.stringify(data.orderSubmissions));
                    orderSubmissionManager.submissions = data.orderSubmissions || {};
                }
                if (data && data.deletedSubmissions) {
                    localStorage.setItem('orderDeletions', JSON.stringify(data.deletedSubmissions));
                    if (deletedSubmissionsManager) deletedSubmissionsManager.deleted = data.deletedSubmissions || {};
                }
                if (data && data.hr_users) {
                    localStorage.setItem('hr_users', JSON.stringify(data.hr_users));
                    if (authManager) authManager.users = data.hr_users || {};
                }
                if (data && data.hr_currentUser !== undefined) {
                    localStorage.setItem('hr_currentUser', String(data.hr_currentUser || ''));
                    if (authManager) authManager.currentUser = data.hr_currentUser || null;
                }
                if (data && data.hr_currentRole !== undefined) {
                    localStorage.setItem('hr_currentRole', String(data.hr_currentRole || ''));
                    if (authManager) authManager.currentRole = data.hr_currentRole || null;
                }
                if (data && data.orderMeta) {
                    localStorage.setItem('orderMeta', JSON.stringify(data.orderMeta));
                    if (orderManager) orderManager.meta = data.orderMeta || { createdBy: null, createdAt: null };
                }
                if (data && data.orderStatus !== undefined) {
                    localStorage.setItem('orderStatus', String(data.orderStatus));
                    if (statusManager) statusManager.currentStatus = data.orderStatus || 'rascunho';
                }
                if (data && data.orderStatusHistory) {
                    localStorage.setItem('orderStatusHistory', JSON.stringify(data.orderStatusHistory));
                    if (statusManager) statusManager.history = Array.isArray(data.orderStatusHistory) ? data.orderStatusHistory : [];
                }
                localStorage.setItem('portal_backup_snapshot', JSON.stringify(snapshot));
                if (typeof renderHistoryTab === 'function') renderHistoryTab();
                if (typeof updateSupervisorPanel === 'function') updateSupervisorPanel();
                if (typeof renderDraftsPanel === 'function') renderDraftsPanel();
                alert('Backup restaurado com sucesso!');
            } catch (error) {
                console.error('Erro ao restaurar backup:', error);
                alert('Arquivo de backup inválido ou corrompido.');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

window.exportPortalBackup = exportPortalBackup;
window.restorePortalBackupPrompt = restorePortalBackupPrompt;

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

// ===== Funções de UI / Autenticação =====
function lockApp() {
    document.body.classList.add('login-locked');
}

function unlockApp() {
    document.body.classList.remove('login-locked');
}

function showLoginModal() {
    const screen = document.getElementById('loginScreen');
    const msg = document.getElementById('loginMessage');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
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
    const msg = document.getElementById('loginMessage');
    const loginButton = document.querySelector('.login-actions button:last-child');
    if (loginButton) loginButton.disabled = true;
    try {
        await authManager.login(u, p);
        if (msg) { msg.style.display = 'none'; }
        closeLoginModal();
        updateSupervisorPanel();
    } catch (e) {
        if (msg) {
            msg.style.display = 'block';
            msg.textContent = e.message || 'Não foi possível entrar. Confira usuário e senha.';
        }
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
    const loginButton = document.querySelector('.login-actions button:last-child');
    const registerButton = document.querySelector('.login-actions button:first-child');
    const passwordInput = document.getElementById('loginPassword');

    if (loginButton && !loginButton.dataset.bound) {
        loginButton.dataset.bound = 'true';
        loginButton.addEventListener('click', loginUser);
    }
    if (registerButton && !registerButton.dataset.bound) {
        registerButton.dataset.bound = 'true';
        registerButton.addEventListener('click', registerUser);
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
window.registerUser = registerUser;
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindLoginControls);
} else {
    bindLoginControls();
}

async function registerUser() {
    const u = document.getElementById('loginUsername')?.value.trim();
    const p = document.getElementById('loginPassword')?.value || '';
    const msg = document.getElementById('loginMessage');
    try {
        await authManager.register(u, p, 'vendedor');
        if (msg) { msg.style.display = 'none'; }
        closeLoginModal();
        updateSupervisorPanel();
    } catch (e) {
        if (msg) {
            msg.style.display = 'block';
            if (e.message === 'Usuário já existe') {
                msg.textContent = 'Este usuário já existe. Tente outro login ou faça login.';
            } else {
                msg.textContent = e.message || 'Erro ao registrar usuário.';
            }
        }
    }
}

function logoutUser() {
    authManager.logout();
    updateSupervisorPanel();
    showLoginModal();
}

function getCurrentUserDrafts() {
    const currentUser = authManager.getCurrentUser();
    if (!currentUser) return [];

    return orderSubmissionManager.getUserSubmissions(currentUser)
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
        let total = 0;
        if (draft.cart && draft.cart.length) {
            draft.cart.forEach((item, idx) => {
                const qty = item.qty || 0;
                const unit = parseFloat(item.negotiatedPrice || item.cif || 0) || 0;
                const subtotal = unit * qty;
                total += subtotal;
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
                <div class="draft-items-total">Total: R$ ${total.toFixed(2)}</div>
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
    let total = 0;
    (submission.cart || []).forEach(item => {
        const qty = item.qty || 0;
        const unit = parseFloat(item.negotiatedPrice || item.cif || 0) || 0;
        const subtotal = unit * qty;
        total += subtotal;
        itemsHtml += `<tr><td>${item.codigo}</td><td>${(item.descricao||'').replace(/"/g,'')}</td><td style="text-align:center">${qty}</td><td style="text-align:right">R$ ${unit.toFixed(2)}</td><td style="text-align:right">R$ ${subtotal.toFixed(2)}</td></tr>`;
    });
    itemsHtml += `</tbody></table><div class="draft-items-total">Total: R$ ${total.toFixed(2)}</div>`;

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
    
    const totalCif = parseFloat(document.getElementById('totalCif')?.textContent || 0);
    if (submitTotalCif) submitTotalCif.textContent = `R$ ${totalCif.toFixed(2)}`;

    const modal = document.getElementById('submitOrderModal');
    if (modal) modal.style.display = 'flex';
}

function closeSubmitOrderModal() {
    const modal = document.getElementById('submitOrderModal');
    if (modal) modal.style.display = 'none';
    const msg = document.getElementById('submitOrderMessage');
    if (msg) msg.textContent = '';
}

function submitOrder() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de enviar.');
        return;
    }

    const selectedDraftValue = document.getElementById('submitDraftSelect')?.value || '';
    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '';
    const clientName = document.getElementById('clientName')?.value.trim() || '';
    const representativeName = document.getElementById('representativeName')?.value.trim() || '';
    const currentUser = authManager.getCurrentUser();
    const msg = document.getElementById('submitOrderMessage');

    try {
        // Usar número do cliente se preenchido, senão usar Hiper Roll
        const orderNumberToUse = orderNumberClient || orderNumberHiperroll;
        
        const draftIdToUse = selectedDraftValue && selectedDraftValue !== '__new__' ? selectedDraftValue : null;
        const proposalValidity = normalizeProposalValidity(document.getElementById('proposalValidity')?.value || '');
        const submissionId = orderSubmissionManager.submitOrder(
            orderNumberToUse,
            clientName,
            representativeName,
            cart,
            currentUser,
            draftIdToUse,
            proposalValidity
        );
        console.log('[Portal Hiperroll] submitOrder() saved submission', {
            submissionId,
            newCount: Object.keys(orderSubmissionManager.submissions || {}).length,
            submission: orderSubmissionManager.getById(submissionId)
        });

        if (msg) {
            msg.textContent = '✓ Pedido enviado para análise! ID: ' + submissionId;
            msg.style.color = '#15803d';
        }

        console.log('[Portal Hiperroll] submitOrder() called, submissionId=', submissionId);
        console.log('[Portal Hiperroll] orderSubmissionManager count before save =', Object.keys(orderSubmissionManager.submissions || {}).length);

        // Registrar no histórico apenas quando o pedido for efetivamente enviado
        try {
            statusManager.addHistoryEntry('analise', 'Enviado para análise', currentUser);
            statusManager.currentStatus = 'analise';
            statusManager.updateUI();
        } catch (e) {
            console.warn('Não foi possível registrar histórico de envio:', e);
        }

        const historySearchInput = document.getElementById('historySearchInput');
        if (historySearchInput) {
            historySearchInput.value = '';
        }
        activeDraftId = null;
        setLoadedOrderReference('');
        switchTab('tab-history');
        renderHistoryTab();

        setTimeout(() => {
            closeSubmitOrderModal();
            cart.length = 0;
            updateOrderTable();
            renderDraftsPanel();
            renderHistoryTab();
            
            // Gerar novo número Hiper Roll para o próximo pedido
            const nextNumber = hiperrollOrderNumberManager.getNextOrderNumber();
            document.getElementById('orderNumberHiperroll').value = nextNumber;
            document.getElementById('orderNumberClient').value = '';
            document.getElementById('clientName').value = '';
            document.getElementById('representativeName').value = '';
            document.getElementById('proposalValidity').value = '';
            alert('Pedido enviado com sucesso! Aguardando aprovação do supervisor.');
            switchTab('tab-history');
            renderHistoryTab();
            setTimeout(() => highlightHistoryCard(submissionId), 250);
        }, 1500);
    } catch (e) {
        if (msg) {
            msg.textContent = e.message;
            msg.style.color = '#b91c1c';
        }
    }
}

function saveDraftCurrentOrder() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de salvar o rascunho.');
        return;
    }

    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '';
    const clientName = document.getElementById('clientName')?.value.trim() || '';
    const representativeName = document.getElementById('representativeName')?.value.trim() || '';
    const currentUser = authManager.getCurrentUser();

    try {
        // Usar número do cliente se preenchido, senão usar Hiper Roll
        const orderNumberToUse = orderNumberClient || orderNumberHiperroll;
        
        const proposalValidity = normalizeProposalValidity(document.getElementById('proposalValidity')?.value || '');
        const draftId = orderSubmissionManager.saveDraft(
            orderNumberToUse,
            clientName,
            representativeName,
            cart,
            currentUser,
            activeDraftId,
            proposalValidity
        );
        activeDraftId = draftId;
        renderDraftsPanel();
        renderHistoryTab();
        // Registrar no histórico apenas quando o rascunho for efetivamente salvo
        try {
            statusManager.addHistoryEntry('rascunho', 'Rascunho salvo', currentUser);
            statusManager.currentStatus = 'rascunho';
            statusManager.updateUI();
        } catch (e) {
            console.warn('Não foi possível registrar histórico do rascunho:', e);
        }
        alert('Rascunho salvo com sucesso. Ele já está disponível no painel de rascunhos.');
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
    document.getElementById('clientName').value = submission.clientName || '';
    document.getElementById('representativeName').value = submission.representativeName || '';
    document.getElementById('proposalValidity').value = submission.proposalValidity || '';
    cart.length = 0;
    (Array.isArray(submission.cart) ? submission.cart : []).forEach(item => cart.push(JSON.parse(JSON.stringify(item))));
    updateOrderTable();
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
    const nextNumber = hiperrollOrderNumberManager.getNextOrderNumber();
    document.getElementById('orderNumberHiperroll').value = nextNumber;
    setLoadedOrderReference('');
    document.getElementById('orderNumberClient').value = submission.orderNumber || '';
    document.getElementById('clientName').value = submission.clientName || '';
    document.getElementById('representativeName').value = submission.representativeName || '';
    document.getElementById('proposalValidity').value = normalizeProposalValidity(submission.proposalValidity || '');
    cart.length = 0;
    (Array.isArray(submission.cart) ? submission.cart : []).forEach(item => cart.push(JSON.parse(JSON.stringify(item))));
    updateOrderTable();
    renderDraftsPanel();
    closeOrderHistoryModal();
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

function deleteSubmission(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        alert('Pedido não encontrado.');
        return;
    }

    let confirmMsg = 'Deseja realmente excluir este pedido? Os dados serão armazenados no histórico de exclusões.';
    if (submission.status === 'analise') {
        confirmMsg += '\n\n⚠️ Aviso: Este pedido está em análise. Ele permanecerá visível no painel do supervisor para que possa dar andamento.';
    } else if (submission.status === 'aprovado') {
        confirmMsg += '\n\n⚠️ Aviso: Este pedido já foi aprovado. Ele permanecerá visível no painel do supervisor para rastreamento.';
    }

    const ok = confirm(confirmMsg);
    if (!ok) return;

    const deletedBy = authManager.getCurrentUser() || 'Sistema';
    if (deletedSubmissionsManager.archiveSubmission(submissionId, submission, deletedBy, '')) {
        orderSubmissionManager.deleteSubmission(submissionId);
        
        if (activeDraftId === submissionId) {
            activeDraftId = null;
        }
        renderDraftsPanel();
        renderHistoryTab();
        updateTrashBadge();
        updateSupervisorPanel();
        
        let successMsg = 'Pedido excluído com sucesso. Histórico preservado em "Lixeira".';
        if (['analise', 'aprovado'].includes(submission.status)) {
            successMsg += '\n\nO pedido continua visível no painel do supervisor.';
        }
        alert(successMsg);
        showOrderHistoryModal();
    } else {
        alert('Não foi possível excluir o pedido.');
    }
}

function deleteSelectedSubmissions() {
    const selected = Array.from(document.querySelectorAll('.history-selection-checkbox:checked')).map(input => input.value);
    if (selected.length === 0) {
        alert('Selecione ao menos um pedido para excluir.');
        return;
    }

    const ok = confirm(`Deseja realmente excluir os ${selected.length} pedido(s) selecionado(s)? Os dados serão armazenados no histórico de exclusões.`);
    if (!ok) return;

    let deletedCount = 0;
    const deletedBy = authManager.getCurrentUser() || 'Sistema';
    
    selected.forEach(id => {
        const submission = orderSubmissionManager.getById(id);
        if (submission) {
            if (deletedSubmissionsManager.archiveSubmission(id, submission, deletedBy, '')) {
                orderSubmissionManager.deleteSubmission(id);
                deletedCount += 1;
            }
        }
    });

    if (deletedCount > 0) {
        alert(`${deletedCount} pedido(s) excluído(s) com sucesso. Histórico preservado em "Lixeira".`);
        updateTrashBadge();
        renderHistoryTab();
    } else {
        alert('Nenhum pedido pôde ser excluído.');
    }

    showOrderHistoryModal();
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
        <thead style="position: sticky; top: 0; background: white;">
            <tr style="background: #f3f4f6; border-bottom: 2px solid #e5e7eb;">
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
            <h4 style="margin: 0 0 15px; color: #1f2937; font-size: 1rem;">
                📦 Produtos do Pedido ${deletion.orderNumber}
            </h4>
            
            <div style="background: white; border-radius: 6px; border: 1px solid #e5e7eb; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: #f3f4f6; border-bottom: 1px solid #e5e7eb;">
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
        
        const marginColor = marginPercent > 15 ? '#15803d' : marginPercent >= 11 ? '#b45309' : '#c53030';
        
        // Cor para a quantidade faturada (verde se completo, amarelo se parcial, cinza se nenhum)
        const billingColor = billedQty === qty ? '#15803d' : billedQty > 0 ? '#f59e0b' : '#9ca3af';
        
        html += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px;">
                    <strong>${item.codigo}</strong> - ${item.descricao || ''}
                </td>
                <td style="padding: 10px; text-align: center;">${qty}</td>
                <td style="padding: 10px; text-align: center; color: ${billingColor}; font-weight: 600;">
                    ${billedQty} ${pendingQty > 0 ? `<span style="font-size: 0.85rem; color: #6b7280;">/ ${qty}</span>` : ''}
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
            
            <div style="margin-top: 15px; padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #3b82f6;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: 600;">Total do Pedido:</span>
                    <span style="font-weight: 600; color: #1f2937;">R$ ${totalValue.toFixed(2).replace('.', ',')}</span>
                </div>
                
                ${deletion.billedQuantities && Object.keys(deletion.billedQuantities).length > 0 ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding: 8px; background: #f0fdf4; border-radius: 4px; border-left: 3px solid #15803d;">
                    <span style="font-weight: 600; color: #15803d;">Status de Faturamento:</span>
                    <span style="font-weight: 600; color: #15803d;">✅ Faturado (parcial/completo)</span>
                </div>
                ` : ''}
                
                ${deletion.representativeName ? `
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: #6b7280;">
                    <span>Representante:</span>
                    <span>${deletion.representativeName}</span>
                </div>
                ` : ''}
                ${deletion.submittedAt ? `
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: #6b7280;">
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

function restoreSubmission(submissionId) {
    const ok = confirm('Deseja restaurar este pedido como rascunho?');
    if (!ok) return;

    const restored = deletedSubmissionsManager.restore(submissionId);
    if (restored) {
        orderSubmissionManager.submissions[submissionId] = restored;
        orderSubmissionManager.save();
        updateTrashBadge();
        alert('Pedido restaurado com sucesso como rascunho!');
        closeTrashModal();
        showTrashModal(); // Reabrir o modal para atualizar a lista
        renderHistoryTab();
        renderDraftsPanel();
    } else {
        alert('Não foi possível restaurar o pedido.');
    }
}

function permanentlyDeleteSubmission(submissionId) {
    const ok = confirm('Tem certeza? Esta ação não pode ser desfeita. O pedido será deletado permanentemente.');
    if (!ok) return;

    if (deletedSubmissionsManager.permanentlyDelete(submissionId)) {
        updateTrashBadge();
        alert('Pedido deletado permanentemente.');
        closeTrashModal();
        showTrashModal();
    } else {
        alert('Não foi possível deletar o pedido.');
    }
}

function emptyTrash() {
    const count = deletedSubmissionsManager.count();
    if (count === 0) {
        alert('A lixeira já está vazia.');
        return;
    }

    const ok = confirm(`Tem certeza? Todos os ${count} pedido(s) na lixeira serão deletados permanentemente. Esta ação não pode ser desfeita.`);
    if (!ok) return;

    deletedSubmissionsManager.getAll().forEach(deletion => {
        deletedSubmissionsManager.permanentlyDelete(deletion.id);
    });

    alert('Lixeira esvaziada com sucesso.');
    closeTrashModal();
    updateTrashBadge();
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

    let total = 0;
    (submission.cart || []).forEach(item => {
        const qty = item.qty || 0;
        const unit = parseFloat(item.negotiatedPrice || item.cif || 0) || 0;
        total += qty * unit;
    });

    alert(`Pedido: ${submission.orderNumber}
Cliente: ${submission.clientName}
Representante: ${submission.representativeName}
Criado por: ${submission.submittedBy || submission.savedBy || '(Sem usuário)'}
Status: ${statusLabel}
Margem média: ${averageMargin.toFixed(2)}% (${marginStatus.label})
Valor Total do Pedido: R$ ${total.toFixed(2)}
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
    
    const currentUser = authManager.getCurrentUser();
    const currentRole = authManager.getCurrentUserRole();
    if (!submission) return;
    if (!['supervisor', 'desenvolvedor'].includes(currentRole)) {
        alert('Acesso negado. Apenas supervisor ou desenvolvedor podem gerenciar este pedido.');
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

    let itemsHtml = `<table class="draft-items-table" style="width:100%; margin-top:10px;"><thead><tr><th>Cód</th><th>Descrição</th><th>Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>`;
    let total = 0;
    (submission.cart || []).forEach(item => {
        const qty = item.qty || 0;
        const unit = parseFloat(item.negotiatedPrice || item.cif || 0) || 0;
        const subtotal = unit * qty;
        total += subtotal;
        itemsHtml += `<tr><td>${item.codigo}</td><td>${(item.descricao || '').replace(/"/g, '')}</td><td style="text-align:center">${qty}</td><td style="text-align:right">R$ ${unit.toFixed(2)}</td><td style="text-align:right">R$ ${subtotal.toFixed(2)}</td></tr>`;
    });
    itemsHtml += `</tbody></table><div style="text-align:right; margin-top:10px; font-weight:700;">Total: R$ ${total.toFixed(2)}</div>`;

    const backdrop = document.createElement('div');
    backdrop.id = 'supervisorActionModalBackdrop';
    backdrop.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:2001; display:flex; align-items:center; justify-content:center; padding:16px;';
    const normalizeBtn = (s) => (typeof authManager !== 'undefined') ? authManager.normalizeUsername(s) : String(s || '').trim().toLowerCase();
    const allowedApproversBtns = [normalizeBtn('Leon'), normalizeBtn('Gabriel.Ferreira')];
    const currentNormalizedBtn = normalizeBtn(currentUser);

    const approveBtnHtml = allowedApproversBtns.includes(currentNormalizedBtn)
        ? `<button onclick="handleSupervisorAction('${submission.id}', 'approve')" style="padding:11px 18px; background:#10b981; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">✅ Aprovar</button>`
        : `<button disabled title="Apenas Gabriel ou Leon podem aprovar" style="padding:11px 18px; background:#94d3b6; color:#093f2a; border:none; border-radius:8px;">✅ Aprovar</button>`;

    const rejectBtnHtml = allowedApproversBtns.includes(currentNormalizedBtn)
        ? `<button onclick="handleSupervisorAction('${submission.id}', 'reject')" style="padding:11px 18px; background:#ef4444; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">❌ Rejeitar</button>`
        : `<button disabled title="Apenas Gabriel ou Leon podem rejeitar" style="padding:11px 18px; background:#f7a8a8; color:#5a1a1a; border:none; border-radius:8px;">❌ Rejeitar</button>`;

    backdrop.innerHTML = `
        <div style="background:white; border-radius:12px; padding:22px; max-width:680px; width:100%; max-height:calc(100vh - 40px); overflow-y:auto; box-shadow:0 14px 38px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:18px;">
                <div>
                    <h3 style="margin:0 0 6px 0;">🧑‍💼 Ações do Supervisor</h3>
                    <div style="font-size:0.95rem; color:#475569; line-height:1.5;">
                        Pedido: <strong>${submission.orderNumber || '(Sem número)'}</strong><br>
                        Cliente: <strong>${submission.clientName || '(Não informado)'}</strong><br>
                        Enviado por: <strong>${submission.submittedBy || submission.savedBy || '(Sem usuário)'}</strong><br>
                        Status atual: <strong>${statusLabel}</strong><br>
                        ${submission.status === 'rascunho' ? 'Salvo em' : 'Enviado em'}: <strong>${dateLabel}</strong>
                    </div>
                </div>
                <button onclick="closeSupervisorActionModal()" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">✕</button>
            </div>
            ${itemsHtml}
            <div style="margin-top:20px; display:grid; gap:14px;">
                <div>
                    <label style="display:block; font-weight:600; margin-bottom:6px;">Observação do Supervisor</label>
                    <textarea id="supervisorActionNote" style="width:100%; min-height:110px; padding:12px; border:1px solid #d1d5db; border-radius:10px; font-family:inherit;">${submission.supervisorNote || ''}</textarea>
                </div>
                <div>
                    <label style="display:block; font-weight:600; margin-bottom:6px;">Motivo da Rejeição</label>
                    <textarea id="supervisorActionRejectionReason" placeholder="Preencha apenas se for rejeitar." style="width:100%; min-height:110px; padding:12px; border:1px solid #d1d5db; border-radius:10px; font-family:inherit;">${submission.rejectionReason || ''}</textarea>
                </div>
            </div>
            <div style="margin-top:18px; display:flex; flex-wrap:wrap; gap:12px; justify-content:flex-end;">
                <button onclick="handleSupervisorAction('${submission.id}', 'saveNote')" style="padding:11px 18px; background:#0f172a; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">💬 Salvar Observação</button>
                ${approveBtnHtml}
                ${rejectBtnHtml}
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);
}

function handleSupervisorAction(submissionId, action) {
    const currentUser = authManager.getCurrentUser();
    const note = document.getElementById('supervisorActionNote')?.value.trim() || '';
    const reason = document.getElementById('supervisorActionRejectionReason')?.value.trim() || '';
    const normalize = (s) => (typeof authManager !== 'undefined') ? authManager.normalizeUsername(s) : String(s || '').trim().toLowerCase();
    const allowedApprovers = [normalize('Leon'), normalize('Gabriel.Ferreira')];
    const currentNormalized = normalize(currentUser);

    if (action === 'approve') {
        if (!allowedApprovers.includes(currentNormalized)) {
            alert('Apenas Gabriel ou Leon podem aprovar pedidos.');
            return;
        }
        orderSubmissionManager.approve(submissionId, currentUser, note);
        alert('Pedido aprovado com sucesso.');
    } else if (action === 'reject') {
        if (!allowedApprovers.includes(currentNormalized)) {
            alert('Apenas Gabriel ou Leon podem rejeitar pedidos.');
            return;
        }
        if (!reason) {
            alert('Informe o motivo da rejeição antes de rejeitar o pedido.');
            return;
        }
        orderSubmissionManager.reject(submissionId, reason, currentUser, note);
        alert('Pedido rejeitado com sucesso.');
    } else if (action === 'saveNote') {
        // Any supervisor or developer can save notes; keep existing behavior
        orderSubmissionManager.setSupervisorNote(submissionId, note);
        alert('Observação salva com sucesso.');
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

function getMarginRiskLevel(margin) {
    if (margin > 15) return { label: 'Verde', color: '#15803d' };
    if (margin >= 11) return { label: 'Amarelo', color: '#b45309' };
    return { label: 'Vermelho', color: '#b91c1c' };
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

    if (orderSubmissionManager && typeof orderSubmissionManager.getAll === 'function') {
        syncForecast(orderSubmissionManager.getAll());
        orderSubmissionManager.save();
    }
    if (deletedSubmissionsManager && typeof deletedSubmissionsManager.getAll === 'function') {
        syncForecast(deletedSubmissionsManager.getAll());
        deletedSubmissionsManager.save();
    }
}

function updateSupervisorPanel() {
    refreshMissedForecastDates();
    const modal = document.getElementById('supervisorModal');
    const currentUserRole = authManager.getCurrentUserRole();
    const btn = document.getElementById('supervisorBtn');
    if (btn) {
        btn.style.display = ['supervisor', 'desenvolvedor'].includes(currentUserRole) ? 'inline-flex' : 'none';
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
            const currentUser = authManager.getCurrentUser();
            const currentRole = authManager.getCurrentUserRole();
            const emptyMessage = ['supervisor', 'desenvolvedor'].includes(currentRole)
                ? 'Nenhum pedido pendente no momento. Verifique o histórico ou o armazenamento local do portal.'
                : currentUser
                    ? 'Nenhum pedido pendente para revisão.'
                    : 'Nenhum pedido pendente. Faça login para visualizar a fila do supervisor.';
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
                const bgColor = isDeleted ? '#fef2f2' : '#fafafa';
                const borderColor = isDeleted ? '#fecaca' : '#ddd';
                
                html += `
                    <div style="border:1px solid ${borderColor}; border-radius:8px; padding:15px; background:${bgColor}; display:flex; align-items:center; justify-content:space-between; gap:15px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display:flex; align-items:center; gap:15px; flex:1;">
                            <input type="checkbox" class="pending-order-checkbox" value="${submission.id}" style="width:20px; height:20px; flex-shrink:0; margin:0; cursor:pointer;">
                            <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <div style="font-weight:700; font-size:1.05rem; color:#0f172a;">
                                    Pedido: ${submission.orderNumber} ${deletedBadge}
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

function approvePendingOrders() {
    const selected = getSelectedPendingOrders();
    if (selected.length === 0) {
        alert('Selecione ao menos um pedido para aprovar.');
        return;
    }

    const currentUser = authManager.getCurrentUser();
    const normalize = (s) => (typeof authManager !== 'undefined') ? authManager.normalizeUsername(s) : String(s || '').trim().toLowerCase();
    const allowedApprovers = [normalize('Leon'), normalize('Gabriel.Ferreira')];
    if (!allowedApprovers.includes(normalize(currentUser))) {
        alert('Apenas Gabriel ou Leon podem aprovar pedidos.');
        return;
    }

    const supervisorNote = document.getElementById('supervisorObservationTextarea')?.value.trim() || '';
    orderSubmissionManager.approve(selected, currentUser, supervisorNote);
    console.log('[Portal Hiperroll] approvePendingOrders() called, selected=', selected);
    updateSupervisorPanel();
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) searchInput.value = '';
    renderHistoryTab();
    alert(`${selected.length} pedido(s) aprovado(s) com sucesso!`);
    if (document.getElementById('supervisorObservationTextarea')) {
        document.getElementById('supervisorObservationTextarea').value = '';
    }
}

function rejectPendingOrders() {
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

    const currentUser = authManager.getCurrentUser();
    const normalize = (s) => (typeof authManager !== 'undefined') ? authManager.normalizeUsername(s) : String(s || '').trim().toLowerCase();
    const allowedApprovers = [normalize('Leon'), normalize('Gabriel.Ferreira')];
    if (!allowedApprovers.includes(normalize(currentUser))) {
        alert('Apenas Gabriel ou Leon podem rejeitar pedidos.');
        return;
    }

    const supervisorNote = document.getElementById('supervisorObservationTextarea')?.value.trim() || '';
    orderSubmissionManager.reject(selected, reason, currentUser, supervisorNote);
    updateSupervisorPanel();
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) searchInput.value = '';
    renderHistoryTab();
    alert(`${selected.length} pedido(s) rejeitado(s) com sucesso!`);
    if (document.getElementById('rejectionReasonTextarea')) {
        document.getElementById('rejectionReasonTextarea').value = '';
    }
    if (document.getElementById('supervisorObservationTextarea')) {
        document.getElementById('supervisorObservationTextarea').value = '';
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
    backdrop.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:2005; display:flex; align-items:center; justify-content:center; padding:16px; font-family:"Outfit", sans-serif;';
    
    let itemsHtml = `
        <div style="max-height: 400px; overflow-y: auto; margin-top: 15px; border: 1px solid #e2e8f0; border-radius: 6px;">
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                <thead style="background:#f8fafc; position:sticky; top:0;">
                    <tr>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid #e2e8f0;">Cód</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid #e2e8f0;">Descrição</th>
                        <th style="padding:10px; text-align:center; border-bottom:1px solid #e2e8f0;">Qtd</th>
                        <th style="padding:10px; text-align:right; border-bottom:1px solid #e2e8f0;">Preço (CIF)</th>
                        <th style="padding:10px; text-align:right; border-bottom:1px solid #e2e8f0;">Margem</th>
                        <th style="padding:10px; text-align:right; border-bottom:1px solid #e2e8f0;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
    `;

    let totalCif = 0;
    const cartArray = Array.isArray(submission.cart) ? submission.cart : [];
    cartArray.forEach(item => {
        const qty = item.qty || 0;
        const negotiatedPrice = Math.max(item.negotiatedPrice || item.cif || 0, 0);
        const subtotal = negotiatedPrice * qty;
        totalCif += subtotal;
        const marginPercent = negotiatedPrice > 0 ? ((negotiatedPrice - item.fob) / negotiatedPrice) * 100 : 0;
        const itemMarginColor = marginPercent > 15 ? '#15803d' : marginPercent >= 11 ? '#b45309' : '#c53030';
        
        itemsHtml += `
            <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px;">${item.codigo}</td>
                <td style="padding:10px;">${(item.descricao||'').replace(/"/g,'')}</td>
                <td style="padding:10px; text-align:center; font-weight:600;">${qty}</td>
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
                <span style="color:#475569; font-size:0.9rem;">Margem Média:</span><br>
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
    modal.style = 'background:white; padding:25px; border-radius:12px; width:90%; max-width:800px; box-shadow:0 10px 25px rgba(0,0,0,0.2); position:relative;';
    
    const submittedDate = new Date(submission.submittedAt).toLocaleString('pt-BR');
    
    modal.innerHTML = `
        <button onclick="document.getElementById('detailsModalBackdrop').remove()" style="position:absolute; top:20px; right:20px; background:none; border:none; font-size:1.5rem; cursor:pointer; color:#64748b;">&times;</button>
        <h2 style="margin:0 0 5px 0; color:#0f172a; font-size:1.3rem;">Detalhes do Pedido: ${submission.orderNumber}</h2>
        <div style="color:#64748b; font-size:0.95rem; margin-bottom:20px;">
            Enviado por <strong>${submission.submittedBy}</strong> em <strong>${submittedDate}</strong> para o cliente <strong>${submission.clientName}</strong><br>
            Validade da proposta: <strong>${submission.proposalValidity || 'Não informada'}</strong>
        </div>
        ${itemsHtml}
        <div style="text-align:right; margin-top:20px;">
            <button onclick="document.getElementById('detailsModalBackdrop').remove()" style="background:#0f172a; color:white; padding:10px 20px; border:none; border-radius:8px; cursor:pointer; font-weight:600;">Fechar</button>
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

// Sobrescrevendo a exibição antiga de histórico (para quando clicar em 'Meus Pedidos')
// Extensão do orderSubmissionManager para suportar faturamento e notas fiscais
if (!orderSubmissionManager.registerBilling) {
    orderSubmissionManager.registerBilling = function(submissionId, billedItemsMap, invoiceBase64, invoiceName) {
        const submission = this.submissions[submissionId];
        if (!submission) return false;

        if (!submission.billedQuantities) submission.billedQuantities = {};
        if (!submission.invoices) submission.invoices = [];
        if (!submission.billedQuantities) submission.billedQuantities = {};

        let allComplete = true;
        let anyBilled = false;

        const cartItems = Array.isArray(submission.cart) ? submission.cart : [];
        cartItems.forEach(item => {
            const addedQty = billedItemsMap[item.codigo] || 0;
            const currentTotal = (submission.billedQuantities[item.codigo] || 0) + addedQty;
            submission.billedQuantities[item.codigo] = Math.min(currentTotal, item.qty);

            if (submission.billedQuantities[item.codigo] > 0) anyBilled = true;
            if (submission.billedQuantities[item.codigo] < item.qty) allComplete = false;
        });

        if (anyBilled && allComplete) {
            submission.billingStatus = 'completo';
        } else if (anyBilled) {
            submission.billingStatus = 'parcial';
        } else {
            submission.billingStatus = 'pendente';
        }

        const now = new Date();
        const nextPred = new Date(now);
        nextPred.setDate(nextPred.getDate() + 4);

        if (!submission.billingHistory) submission.billingHistory = [];
        submission.billingHistory.push({
            date: now.toISOString(),
            predictedNextDate: allComplete ? null : nextPred.toISOString(),
            billedMap: billedItemsMap
        });

        if (anyBilled) {
            submission.predictedBillingDate = allComplete ? null : nextPred.toISOString();
        }

        if (invoiceBase64) {
            submission.invoices.push({
                name: invoiceName || 'Nota Fiscal',
                data: invoiceBase64,
                date: now.toISOString()
            });
        }

        this.save();
        
        // Atualizar também na lixeira se o pedido foi deletado
        deletedSubmissionsManager.updateBilledQuantities(submissionId, billedItemsMap);
        
        return true;
    };
}

function renderHistoryTab() {
  try {
    refreshMissedForecastDates();
    const historyContainer = document.getElementById('historyTabContent');
    if (!historyContainer) { console.error('historyTabContent não encontrado'); return; }
    const searchTerm = (document.getElementById('historySearchInput')?.value || '').toLowerCase();
    
    const currentUser = authManager.getCurrentUser();
    const role = authManager.getCurrentUserRole();
    
    let submissions = orderSubmissionManager.getAll();
    console.log('[Portal Hiperroll] renderHistoryTab start', {
        currentUser,
        role,
        totalSubmissions: submissions.length,
        searchTerm
    });
    
    // Vendedor vê só os seus, Supervisor vê todos
    if (role === 'vendedor') {
        const normalizedCurrent = authManager.normalizeUsername(currentUser);
        submissions = submissions.filter(s =>
            authManager.normalizeUsername(s.submittedBy) === normalizedCurrent ||
            authManager.normalizeUsername(s.savedBy) === normalizedCurrent
        );
    }
    console.log('[Portal Hiperroll] renderHistoryTab after role filter', {
        role,
        filteredCount: submissions.length,
        filteredIds: submissions.map(s => ({ id: s.id, status: s.status, orderNumber: s.orderNumber, submittedBy: s.submittedBy }))
    });
    
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

    const roleNote = role === 'vendedor'
        ? 'Você vê apenas seus próprios pedidos e rascunhos.'
        : 'Supervisor/desenvolvedor vê todos os pedidos, inclusive os seus.';

    if (submissions.length === 0) {
        const currentUser = authManager.getCurrentUser();
        const emptyMessage = currentUser
            ? 'Nenhum pedido encontrado para o usuário atual.'
            : 'Nenhum pedido encontrado. Faça login para carregar o histórico e o painel do supervisor.';
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

        let totalCif = 0;
        cartArray.forEach(item => {
            const negotiated = Math.max(item.negotiatedPrice || item.cif, 0);
            const subtotal = negotiated * item.qty; 
            totalCif += subtotal;
        });

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
        
        cartArray.forEach(item => {
            const negotiated = Math.max(item.negotiatedPrice || item.cif, 0);
            const subtotal = negotiated * item.qty; 
            const marginPercent = negotiated > 0 ? ((negotiated - item.fob) / negotiated) * 100 : 0;
            const itemMarginColor = marginPercent > 15 ? '#15803d' : marginPercent >= 11 ? '#b45309' : '#c53030';
            
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
        if (isDraft) {
            actionsHtml += `<button onclick="loadDraftToCurrentOrder('${submission.id}')" style="background:#0f172a; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">✏️ Continuar Rascunho</button>`;
        } else {
            actionsHtml += `<button onclick="repeatOrder('${submission.id}')" style="background:#64748b; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">🔁 Repetir Pedido</button>`;
        }
        
        // Ações para Supervisor (Faturar)
        if (role === 'supervisor' || role === 'desenvolvedor') {
            if (submission.status === 'aprovado' && submission.billingStatus !== 'completo') {
                actionsHtml += `<button onclick="openBillingModal('${submission.id}')" style="background:#0054A6; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">📦 Faturar / Anexar NF</button>`;
            }
        }
        
        actionsHtml += `<button onclick="deleteSubmission('${submission.id}')" style="background:#dc2626; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer;">🗑️ Excluir</button>`;
        actionsHtml += `</div>`;

        html += `
            <div id="historyCard_${submission.id}" style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                    <div>
                        <h3 style="margin:0 0 5px 0;">Pedido: ${submission.orderNumber || 'Sem número'}</h3>
                        <div style="font-size:0.95rem; color:#475569; line-height:1.4;">
                            ID: <strong style="color:#0f172a;">${submission.id}</strong><br>
                            Pedido: <strong>${submission.orderNumber || 'Sem número'}</strong><br>
                            Cliente: <strong>${submission.clientName || 'Não informado'}</strong><br>
                            Comprador / Usuário: <strong>${submission.submittedBy || submission.savedBy || '(Sem usuário)'}</strong><br>
                            Margem média: <strong style="color:${marginStatus.color};">${averageMargin.toFixed(2)}%</strong> <span style="color:${marginStatus.color}; font-weight:700;">${marginStatus.label}</span><br>
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
    modal.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:2000; display:flex; align-items:center; justify-content:center;";
    
    modal.innerHTML = `
        <div style="background:white; border-radius:8px; padding:20px; width:90%; max-width:500px; max-height:90vh; overflow-y:auto;">
            <h3 style="margin-top:0;">📦 Registrar Faturamento</h3>
            <p>Pedido: <strong>${submission.orderNumber}</strong></p>
            <div style="margin:20px 0;">
                ${itemsHtml}
            </div>
            <div style="margin:20px 0;">
                <label style="font-weight:600; display:block; margin-bottom:8px;">Anexar Nota Fiscal (PDF ou Imagem)</label>
                <input type="file" id="billingInvoiceFile" accept="application/pdf,image/*" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
                <small style="color:#666; display:block; margin-top:4px;">*O arquivo será convertido para base64 e salvo (limite recomendado: 2MB).</small>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button onclick="document.getElementById('${modalId}').remove()" style="padding:10px 15px; background:#ccc; border:none; border-radius:6px; cursor:pointer;">Cancelar</button>
                <button onclick="submitBilling('${submissionId}')" style="padding:10px 15px; background:#0054A6; color:white; border:none; border-radius:6px; cursor:pointer;">Confirmar Faturamento</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function submitBilling(submissionId) {
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
        alert("Informe alguma quantidade ou anexe uma Nota Fiscal.");
        return;
    }

    if (file) {
        if (file.size > 2 * 1024 * 1024) { 
            alert("Para esta demonstração local, por favor selecione um arquivo menor que 2MB.");
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64Data = e.target.result;
            orderSubmissionManager.registerBilling(submissionId, billedMap, base64Data, file.name);
            document.getElementById('billingModalDynamic').remove();
            renderHistoryTab();
            alert("Faturamento registrado com sucesso!");
        };
        reader.readAsDataURL(file);
    } else {
        orderSubmissionManager.registerBilling(submissionId, billedMap, null, null);
        document.getElementById('billingModalDynamic').remove();
        renderHistoryTab();
        alert("Faturamento registrado com sucesso!");
    }
}