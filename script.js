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

        const allowedByRole = {
            'vendedor': ['rascunho', 'analise'],
            'supervisor': ['rascunho', 'analise', 'aprovado', 'rejeitado'],
            'desenvolvedor': ['rascunho', 'analise', 'aprovado', 'rejeitado']
        };

        const role = userRole || 'vendedor';
        if (!allowedByRole[role].includes(newStatus)) {
            alert('Você não tem permissão para alterar para esse status.');
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
            const role = (typeof authManager !== 'undefined') ? authManager.getCurrentUserRole() : 'vendedor';
            Array.from(statusSelect.options).forEach(opt => {
                if (role === 'vendedor' && ['aprovado', 'rejeitado'].includes(opt.value)) {
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

// ========== GERENCIADOR DE AUTENTICAÇÃO (LOCAL) ==========
const authManager = {
    users: {}, // username -> { passwordHash, role }
    currentUser: null,
    currentRole: null,

    normalizeUsername(username) {
        return String(username || '').trim().toLowerCase();
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
                        passwordHash: value.passwordHash || '',
                        role: value.role || 'vendedor'
                    };
                }
                return memo;
            }, {});
        } catch (e) {
            this.users = {};
        }
        const currentUserEntry = this.findUser(current);
        this.currentUser = currentUserEntry ? currentUserEntry.username : null;
        this.currentRole = currentUserEntry ? (currentUserEntry.user.role || 'vendedor') : null;

        // Garantir usuário padrão Leon como Desenvolvedor
        const defaultDevUser = 'Leon';
        const defaultDevPass = 'l24598';
        const hash = await this.hashPassword(defaultDevPass);
        const existing = this.findUser(defaultDevUser);
        if (!existing) {
            this.users[defaultDevUser] = { passwordHash: hash, role: 'desenvolvedor' };
            this.save();
        } else {
            if (existing.user.passwordHash !== hash) {
                this.users[existing.username].passwordHash = hash;
            }
            if (existing.user.role !== 'desenvolvedor') {
                this.users[existing.username].role = 'desenvolvedor';
            }
            this.save();
        }

        this.updateUI();
    },

    async hashPassword(password) {
        const enc = new TextEncoder();
        const data = enc.encode(password);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async register(username, password, role = 'vendedor') {
        const normalized = this.normalizeUsername(username);
        if (!normalized || !password) throw new Error('Usuário ou senha inválidos');
        if (this.findUser(username)) throw new Error('Usuário já existe');
        const h = await this.hashPassword(password);
        this.users[username.trim()] = { passwordHash: h, role };
        this.currentUser = username.trim();
        this.currentRole = role;
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
        this.currentRole = found.user.role || 'vendedor';
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
    },

    getCurrentUser() {
        return this.currentUser;
    },

    getCurrentUserRole() {
        return this.currentRole || 'vendedor';
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

// ========== GERENCIADOR DE SUBMISSÃO DE PEDIDOS ==========
const orderSubmissionManager = {
    submissions: {}, // id -> { id, orderNumber, clientName, representativeName, cart, status, submittedAt, submittedBy, rejectionReason, rejectionBy, rejectionAt, approvalAt, supervisorNote }

    init() {
        const saved = localStorage.getItem('orderSubmissions');
        try {
            this.submissions = saved ? JSON.parse(saved) : {};
        } catch (e) {
            this.submissions = {};
        }
    },

    save() {
        localStorage.setItem('orderSubmissions', JSON.stringify(this.submissions));
    },

    generateId() {
        return 'order_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    saveDraft(orderNumber, clientName, representativeName, cart, savedBy, draftId = null) {
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

    submitOrder(orderNumber, clientName, representativeName, cart, submittedBy, draftId = null) {
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
        return Object.values(this.submissions).filter(s => s.status === 'analise');
    },

    getDrafts() {
        return Object.values(this.submissions).filter(s => s.status === 'rascunho');
    },

    getUserSubmissions(user) {
        return Object.values(this.submissions).filter(s => s.submittedBy === user || s.savedBy === user);
    },

    approve(submissionIds, approvedBy, supervisorNote = '') {
        const ids = Array.isArray(submissionIds) ? submissionIds : [submissionIds];
        ids.forEach(id => {
            if (this.submissions[id]) {
                this.submissions[id].status = 'aprovado';
                this.submissions[id].approvalAt = new Date().toISOString();
                this.submissions[id].approvalBy = approvedBy;
                this.submissions[id].rejectionReason = '';
                this.submissions[id].supervisorNote = supervisorNote || this.submissions[id].supervisorNote || '';
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
            }
        });
        this.save();
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

// =========================================================

async function init() {
    // Inicializar autenticação e sistema de status
    await authManager.init();
    orderManager.init();
    statusManager.init();
    orderSubmissionManager.init();
    hiperrollOrderNumberManager.init();
    
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

function updateHeaderInfo() {
    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '---';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '---';
    const dateStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    const headerOrderNumberEl = document.getElementById('headerOrderNumber');
    const headerOrderDateEl = document.getElementById('headerOrderDate');
    
    // Mostrar número do cliente se preenchido, senão mostrar Hiper Roll
    const displayNumber = orderNumberClient !== '---' ? orderNumberClient : orderNumberHiperroll;
    
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
    const orderNumber = orderNumberClient || orderNumberHiperroll; // Usar cliente se preenchido
    const clientName = document.getElementById('clientName')?.value.trim() || '---';
    const representativeName = document.getElementById('representativeName')?.value.trim() || '---';
    const proposalValidity = document.getElementById('proposalValidity')?.value.trim() || '---';
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
    try {
        await authManager.login(u, p);
        if (msg) { msg.style.display = 'none'; }
        closeLoginModal();
        updateSupervisorPanel();
    } catch (e) {
        if (msg) { msg.style.display = 'block'; msg.textContent = e.message; }
    }
}

async function registerUser() {
    const u = document.getElementById('loginUsername')?.value.trim();
    const p = document.getElementById('loginPassword')?.value || '';
    const role = document.getElementById('loginRole')?.value || 'vendedor';
    const msg = document.getElementById('loginMessage');
    try {
        await authManager.register(u, p, role);
        if (msg) { msg.style.display = 'none'; }
        closeLoginModal();
        updateSupervisorPanel();
    } catch (e) {
        if (msg) { msg.style.display = 'block'; msg.textContent = e.message; }
    }
}

function logoutUser() {
    authManager.logout();
    updateSupervisorPanel();
    showLoginModal();
}

// ===== Funções de Submissão de Pedidos =====
function showSubmitOrderModal() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de enviar.');
        return;
    }

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

    const orderNumberHiperroll = document.getElementById('orderNumberHiperroll')?.value.trim() || '';
    const orderNumberClient = document.getElementById('orderNumberClient')?.value.trim() || '';
    const clientName = document.getElementById('clientName')?.value.trim() || '';
    const representativeName = document.getElementById('representativeName')?.value.trim() || '';
    const currentUser = authManager.getCurrentUser();
    const msg = document.getElementById('submitOrderMessage');

    try {
        // Usar número do cliente se preenchido, senão usar Hiper Roll
        const orderNumberToUse = orderNumberClient || orderNumberHiperroll;
        
        const submissionId = orderSubmissionManager.submitOrder(
            orderNumberToUse,
            clientName,
            representativeName,
            cart,
            currentUser,
            activeDraftId
        );

        if (msg) {
            msg.textContent = '✓ Pedido enviado para análise! ID: ' + submissionId;
            msg.style.color = '#15803d';
        }

        activeDraftId = null;
        setTimeout(() => {
            closeSubmitOrderModal();
            cart.length = 0;
            updateOrderTable();
            
            // Gerar novo número Hiper Roll para o próximo pedido
            const nextNumber = hiperrollOrderNumberManager.getNextOrderNumber();
            document.getElementById('orderNumberHiperroll').value = nextNumber;
            document.getElementById('orderNumberClient').value = '';
            document.getElementById('clientName').value = '';
            document.getElementById('representativeName').value = '';
            alert('Pedido enviado com sucesso! Aguardando aprovação do supervisor.');
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
        
        const draftId = orderSubmissionManager.saveDraft(
            orderNumberToUse,
            clientName,
            representativeName,
            cart,
            currentUser,
            activeDraftId
        );
        activeDraftId = draftId;
        alert('Rascunho salvo com sucesso. Você pode continuar editando ou enviar quando estiver pronto.');
    } catch (e) {
        alert(e.message);
    }
}

function loadDraftToCurrentOrder(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        alert('Rascunho não encontrado.');
        return;
    }

    activeDraftId = submissionId;
    // Colocar o número salvo no campo de número do cliente (mais genérico)
    document.getElementById('orderNumberClient').value = submission.orderNumber || '';
    document.getElementById('clientName').value = submission.clientName || '';
    document.getElementById('representativeName').value = submission.representativeName || '';
    cart.length = 0;
    submission.cart.forEach(item => cart.push(JSON.parse(JSON.stringify(item))));
    updateOrderTable();
    closeOrderHistoryModal();
    alert('Rascunho carregado. Edite o pedido ou envie quando estiver pronto.');
}

function repeatOrder(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) {
        alert('Pedido não encontrado.');
        return;
    }

    activeDraftId = null;
    // Colocar o número salvo no campo de número do cliente (mais genérico)
    document.getElementById('orderNumberClient').value = submission.orderNumber || '';
    document.getElementById('clientName').value = submission.clientName || '';
    document.getElementById('representativeName').value = submission.representativeName || '';
    cart.length = 0;
    submission.cart.forEach(item => cart.push(JSON.parse(JSON.stringify(item))));
    updateOrderTable();
    closeOrderHistoryModal();
    alert('Pedido repetido. Ajuste os dados se necessário e envie novamente.');
}

function showOrderHistoryModal() {
    const currentUser = authManager.getCurrentUser();
    const submissions = orderSubmissionManager.getUserSubmissions(currentUser);
    const drafts = submissions.filter(s => s.status === 'rascunho');
    const sentOrders = submissions.filter(s => s.status !== 'rascunho');

    const historyList = document.getElementById('orderHistoryList');
    if (submissions.length === 0) {
        historyList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Nenhum rascunho ou pedido enviado ainda.</div>';
    } else {
        let html = '';

        if (drafts.length) {
            html += '<div style="margin-bottom:16px; font-size:1.05rem; font-weight:700;">Rascunhos</div>';
            drafts.forEach(submission => {
                const savedDate = submission.savedAt ? new Date(submission.savedAt).toLocaleString('pt-BR') : '---';
                const totalItems = submission.cart.reduce((sum, item) => sum + item.qty, 0);
                html += `
                    <div style="border:1px solid #e5e7eb; border-radius:8px; padding:15px; margin-bottom:12px; background:#f8fafc; display:flex; gap:12px; align-items:flex-start;">
                        <label style="display:flex; align-items:center; gap:8px; font-size:0.95rem; margin-top:4px;">
                            <input type="checkbox" class="history-selection-checkbox" value="${submission.id}" />
                            Selecionar
                        </label>
                        <div style="flex:1;">
                            <div style="font-weight:700; font-size:1.05rem;">Rascunho: <strong>${submission.orderNumber || '(Sem número)'}</strong></div>
                            <div style="margin-top:8px; font-size:0.95rem; color:#475569;">
                                <div>Cliente: <strong>${submission.clientName || '(Não informado)'}</strong></div>
                                <div>Itens: <strong>${totalItems}</strong></div>
                                <div>Salvo: <strong>${savedDate}</strong></div>
                            </div>
                        </div>
                        <div style="text-align:right; display:flex; flex-direction:column; gap:8px;">
                            <button onclick="loadDraftToCurrentOrder('${submission.id}')" style="background:#000000; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.9rem;">Carregar Rascunho</button>
                        </div>
                    </div>
                `;
            });
        }

        if (sentOrders.length) {
            html += '<div style="margin:24px 0 16px; font-size:1.05rem; font-weight:700;">Pedidos Enviados</div>';
            sentOrders.forEach(submission => {
                const statusColor = {
                    'analise': '#f59e0b',
                    'aprovado': '#10b981',
                    'rejeitado': '#ef4444'
                }[submission.status] || '#999';

                const statusLabel = {
                    'analise': 'Em Análise',
                    'aprovado': 'Aprovado',
                    'rejeitado': 'Rejeitado'
                }[submission.status] || 'Status Desconhecido';

                const submittedDate = submission.submittedAt ? new Date(submission.submittedAt).toLocaleString('pt-BR') : '---';
                const totalItems = submission.cart.reduce((sum, item) => sum + item.qty, 0);

                html += `
                    <div style="border:1px solid #e5e7eb; border-radius:8px; padding:15px; margin-bottom:12px; display:flex; gap:12px; align-items:flex-start;">
                        <label style="display:flex; align-items:center; gap:8px; font-size:0.95rem; margin-top:4px;">
                            <input type="checkbox" class="history-selection-checkbox" value="${submission.id}" />
                            Selecionar
                        </label>
                        <div style="flex:1;">
                            <div style="font-weight:700; font-size:1.05rem;">Pedido: <strong>${submission.orderNumber}</strong></div>
                            <div style="margin-top:8px; font-size:0.95rem; color:#475569;">
                                <div>Cliente: <strong>${submission.clientName || '(Não informado)'}</strong></div>
                                <div>Itens: <strong>${totalItems}</strong></div>
                                <div>Enviado: <strong>${submittedDate}</strong></div>
                            </div>
                        </div>
                        <div style="text-align:right; display:flex; flex-direction:column; gap:8px;">
                                <div style="background:${statusColor}; color:white; padding:8px 16px; border-radius:6px; font-weight:600; margin-bottom:10px;">
                                    ${statusLabel}
                                </div>
                                ${submission.status === 'rejeitado' && submission.rejectionReason ? `
                                    <div style="background:#fee2e2; border:1px solid #fca5a5; border-radius:6px; padding:10px; margin-bottom:10px; font-size:0.9rem;">
                                        <strong style="color:#b91c1c;">Motivo da Rejeição:</strong><br>
                                        <div style="margin-top:5px; color:#000;">${submission.rejectionReason}</div>
                                    </div>
                                ` : ''}
                                ${submission.supervisorNote ? `
                                    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:10px; margin-bottom:10px; font-size:0.9rem;">
                                        <strong style="color:#1d4ed8;">Observação do Supervisor:</strong><br>
                                        <div style="margin-top:5px; color:#000;">${submission.supervisorNote}</div>
                                    </div>
                                ` : ''}
                                <button onclick="repeatOrder('${submission.id}')" style="background:#0f172a; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.9rem; margin-bottom:8px;">Repetir Pedido</button>
                                <button onclick="deleteSubmission('${submission.id}')" style="background:#dc2626; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.9rem; margin-bottom:8px;">Excluir</button>
                                <button onclick="showSubmissionDetails('${submission.id}')" style="background:#64748b; color:white; padding:8px 12px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.9rem;">Ver Detalhes</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        historyList.innerHTML = html;
    }

    const modal = document.getElementById('orderHistoryModal');
    if (modal) modal.style.display = 'flex';
}

function closeOrderHistoryModal() {
    const modal = document.getElementById('orderHistoryModal');
    if (modal) modal.style.display = 'none';
}

function deleteSubmission(submissionId) {
    const ok = confirm('Deseja realmente excluir este pedido? Esta ação não pode ser desfeita.');
    if (!ok) return;

    const deleted = orderSubmissionManager.deleteSubmission(submissionId);
    if (deleted) {
        alert('Pedido excluído com sucesso.');
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

    const ok = confirm(`Deseja realmente excluir os ${selected.length} pedido(s) selecionado(s)? Esta ação não pode ser desfeita.`);
    if (!ok) return;

    let deletedCount = 0;
    selected.forEach(id => {
        if (orderSubmissionManager.deleteSubmission(id)) {
            deletedCount += 1;
        }
    });

    if (deletedCount > 0) {
        alert(`${deletedCount} pedido(s) excluído(s) com sucesso.`);
    } else {
        alert('Nenhum pedido pôde ser excluído.');
    }

    showOrderHistoryModal();
}

function showSubmissionDetails(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    const statusLabel = {
        'rascunho': 'Rascunho',
        'analise': 'Em Análise',
        'aprovado': 'Aprovado',
        'rejeitado': 'Rejeitado'
    }[submission.status] || submission.status;

    const timestamp = submission.status === 'rascunho' ? submission.savedAt : submission.submittedAt;
    const dateLabel = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : '---';

    alert(`Pedido: ${submission.orderNumber}
Cliente: ${submission.clientName}
Representante: ${submission.representativeName}
Status: ${statusLabel}
${submission.status === 'rascunho' ? 'Salvo em:' : 'Enviado em:'} ${dateLabel}
${submission.rejectionReason ? `Motivo da Rejeição: ${submission.rejectionReason}
` : ''}${submission.supervisorNote ? `Observação do Supervisor: ${submission.supervisorNote}` : ''}`);
}

function showSupervisorPanel() {
    const modal = document.getElementById('supervisorModal');
    if (!modal) return;
    updateSupervisorPanel();
    modal.style.display = 'flex';
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

function updateSupervisorPanel() {
    const modal = document.getElementById('supervisorModal');
    const currentUserRole = authManager.getCurrentUserRole();
    const btn = document.getElementById('supervisorBtn');
    if (btn) {
        btn.style.display = ['supervisor', 'desenvolvedor'].includes(currentUserRole) ? 'inline-flex' : 'none';
    }
    if (!modal || modal.style.display !== 'flex') return;

    const statusLabel = {
        'rascunho': '📝 Rascunho',
        'analise': '🔍 Em Análise',
        'aprovado': '✅ Aprovado',
        'rejeitado': '❌ Rejeitado'
    }[statusManager.currentStatus] || statusManager.currentStatus;

    const risk = getMarginRiskLevel(currentOrderMargin);

    const createdByEl = document.getElementById('supervisorCreatedBy');
    const createdAtEl = document.getElementById('supervisorCreatedAt');
    const currentStatusEl = document.getElementById('supervisorCurrentStatus');
    const riskLevelEl = document.getElementById('supervisorRiskLevel');
    const historyEl = document.getElementById('supervisorHistoryList');

    if (createdByEl) createdByEl.textContent = orderManager.getCreatorLabel();
    if (createdAtEl) createdAtEl.textContent = orderManager.getCreatedAtLabel();
    if (currentStatusEl) currentStatusEl.textContent = statusLabel;
    if (riskLevelEl) {
        riskLevelEl.textContent = `${risk.label} (${currentOrderMargin.toFixed(2)}%)`;
        riskLevelEl.style.color = risk.color;
    }

    if (historyEl) {
        const history = statusManager.getFormattedHistory();
        const sortedHistory = [...history].reverse();
        historyEl.innerHTML = sortedHistory.map(entry => {
            const statusIcon = {
                'rascunho': '📝',
                'analise': '🔍',
                'aprovado': '✅',
                'rejeitado': '❌'
            }[entry.statusNovo] || '•';
            return `
                <div style="padding:12px; border-bottom:1px solid #e5e7eb; background:#f8fafc; margin-bottom:10px; border-radius:8px;">
                    <div style="font-weight:600; margin-bottom:4px;">${statusIcon} ${entry.labelStatus}</div>
                    <div style="font-size:0.9rem; color:#475569;">${entry.dataFormatada}</div>
                    <div style="font-size:0.9rem; color:#475569;">Usuário: <strong>${entry.usuario}</strong></div>
                    ${entry.razao ? `<div style="font-size:0.9rem; color:#475569; margin-top:4px;">Motivo: <em>${entry.razao}</em></div>` : ''}
                </div>
            `;
        }).join('');
    }

    // Atualizar lista de pedidos enviados
    const pendingList = document.getElementById('supervisorPendingOrdersList');
    if (pendingList) {
        const pending = orderSubmissionManager.getPending();
        
        if (pending.length === 0) {
            pendingList.innerHTML = '<div style="padding:15px; text-align:center; color:#999;">Nenhum pedido pendente.</div>';
        } else {
            let html = '<div style="display:flex; flex-direction:column; gap:12px;">';
            
            pending.forEach((submission, idx) => {
                const totalItems = submission.cart.reduce((sum, item) => sum + item.qty, 0);
                const submittedDate = new Date(submission.submittedAt).toLocaleString('pt-BR');
                
                html += `
                    <div style="border:1px solid #ddd; border-radius:8px; padding:12px; background:#fafafa;">
                        <div style="display:flex; align-items:start; gap:12px; margin-bottom:10px;">
                            <input type="checkbox" class="pending-order-checkbox" value="${submission.id}" style="margin-top:2px;">
                            <div style="flex:1;">
                                <div style="font-weight:600;">Pedido: <strong>${submission.orderNumber}</strong></div>
                                <div style="font-size:0.9rem; color:#666; margin-top:4px;">
                                    Cliente: <strong>${submission.clientName}</strong><br>
                                    Enviado por: <strong>${submission.submittedBy}</strong><br>
                                    Em: <strong>${submittedDate}</strong><br>
                                    Itens: <strong>${totalItems}</strong>
                                </div>
                            </div>
                        </div>
                        <button onclick="showPendingOrderDetails('${submission.id}')" style="background:#0054A6; color:white; padding:6px 12px; border:none; border-radius:6px; cursor:pointer; font-size:0.85rem;">Ver Detalhes</button>
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
    const supervisorNote = document.getElementById('supervisorObservationTextarea')?.value.trim() || '';
    orderSubmissionManager.approve(selected, currentUser, supervisorNote);
    updateSupervisorPanel();
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
    const supervisorNote = document.getElementById('supervisorObservationTextarea')?.value.trim() || '';
    orderSubmissionManager.reject(selected, reason, currentUser, supervisorNote);
    updateSupervisorPanel();
    alert(`${selected.length} pedido(s) rejeitado(s) com sucesso!`);
    if (document.getElementById('rejectionReasonTextarea')) {
        document.getElementById('rejectionReasonTextarea').value = '';
    }
    if (document.getElementById('supervisorObservationTextarea')) {
        document.getElementById('supervisorObservationTextarea').value = '';
    }
}

function showPendingOrderDetails(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    let itemsText = 'ITENS DO PEDIDO:\n';
    let totalCif = 0;
    submission.cart.forEach(item => {
        const subtotal = item.negotiatedPrice * (1 - parseFloat(document.getElementById('orderDiscount')?.value || 0) / 100) * item.qty;
        totalCif += subtotal;
        itemsText += `\n${item.codigo} - ${item.descricao}\n  Qtd: ${item.qty} | Preço Unit: R$ ${item.cif.toFixed(2)} | Subtotal: R$ ${subtotal.toFixed(2)}`;
    });

    alert(`
PEDIDO: ${submission.orderNumber}
CLIENTE: ${submission.clientName}
REPRESENTANTE: ${submission.representativeName}
ENVIADO POR: ${submission.submittedBy}
EM: ${new Date(submission.submittedAt).toLocaleString('pt-BR')}

${itemsText}

TOTAL CIF: R$ ${totalCif.toFixed(2)}
${submission.supervisorNote ? `
Observação do Supervisor: ${submission.supervisorNote}` : ''}
    `);
}

// ==========================================

// ========================================