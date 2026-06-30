// App State â€” STORES_DATA sempre vem do data.js (nunca salvo completo no localStorage)
// Apenas atualizações leves (lastVisit, currentStatus) são persistidas em hr_store_updates
// Fallbacks seguros caso o data.js falhe ao carregar
if (typeof PRODUCTS_DATA === 'undefined') {
    window.PRODUCTS_DATA = [];
    console.warn("PRODUCTS_DATA não encontrado. data.js falhou ao carregar?");
}
if (typeof STORES_DATA === 'undefined') {
    window.STORES_DATA = [];
    console.warn("STORES_DATA não encontrado. data.js falhou ao carregar?");
}

function generateStableId(network, name) {
    const raw = (network || 'Geral') + '-' + (name || '');
    return String(raw)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function loadDataOverrides() {
    try {
        return JSON.parse(localStorage.getItem('hr_data_overrides') || 'null');
    } catch (e) {
        return null;
    }
}

function persistDataOverrides(mergedStores, mergedProducts) {
    try {
        localStorage.setItem('hr_data_overrides', JSON.stringify({
            stores: mergedStores,
            products: mergedProducts
        }));
    } catch (e) {
        console.warn('Falha ao salvar overrides de dados:', e);
    }
}

function mergeDataCollections(baseProducts, baseStores, incomingProducts, incomingStores) {
    const mergedProducts = Array.isArray(baseProducts) ? [...baseProducts] : [];
    const mergedStores = Array.isArray(baseStores)
        ? baseStores.map(s => ({ ...s, productIds: Array.isArray(s.productIds) ? [...s.productIds] : [] }))
        : [];

    const productIndex = new Map();
    mergedProducts.forEach(product => {
        if (product && product.name) {
            productIndex.set(normalizeText(product.name), product);
        }
    });

    (incomingProducts || []).forEach(product => {
        const key = normalizeText(product.name);
        const existingProduct = productIndex.get(key);

        if (existingProduct) {
            if (product.network && !existingProduct.network) existingProduct.network = product.network;
            if (product.status && !existingProduct.status) existingProduct.status = product.status;
            return;
        }

        const nextId = generateStableId('', product.name);
        const newProduct = {
            id: nextId,
            name: product.name,
            network: product.network || 'Geral',
            status: product.status || 'Ativo'
        };
        mergedProducts.push(newProduct);
        productIndex.set(key, newProduct);
    });

    const storeIndex = new Map();
    mergedStores.forEach(store => {
        if (store && store.name) {
            storeIndex.set(normalizeText(store.name), store);
        }
    });

    (incomingStores || []).forEach(importedStore => {
        const key = normalizeText(importedStore.name);
        let store = storeIndex.get(key);

        if (!store) {
            const nextId = generateStableId(importedStore.network || 'Geral', importedStore.name);
            store = {
                id: nextId,
                name: importedStore.name,
                network: importedStore.network || 'Geral',
                lastVisit: null,
                status: 'pending',
                productIds: []
            };
            mergedStores.push(store);
            storeIndex.set(key, store);
        }

        if (importedStore.network && !store.network) {
            store.network = importedStore.network;
        }

        const productNames = Array.isArray(importedStore.productNames) ? importedStore.productNames : [];
        const productIds = Array.isArray(importedStore.productIds) ? importedStore.productIds : [];

        [...productIds, ...productNames].forEach(item => {
            if (typeof item === 'number') {
                if (!store.productIds.includes(item)) store.productIds.push(item);
                return;
            }

            const product = productIndex.get(normalizeText(item));
            if (product && !store.productIds.includes(product.id)) {
                store.productIds.push(product.id);
            }
        });
    });

    return { products: mergedProducts, stores: mergedStores };
}

const persistedDataOverrides = loadDataOverrides();
const initialData = persistedDataOverrides
    ? mergeDataCollections(PRODUCTS_DATA, STORES_DATA, persistedDataOverrides.products || [], persistedDataOverrides.stores || [])
    : { products: PRODUCTS_DATA, stores: STORES_DATA };

let products = initialData.products;

// Cache de fotos em memória (não persiste no localStorage e evita estouro)
// Mapa: { [visitId]: [base64, base64, ...] }
const photoCache = {};

// Carrega visitas e STRIP fotos do localStorage legado (libera espaço imediatamente)
let visits = (function() {
    try {
        const raw = JSON.parse(localStorage.getItem('hr_visits')) || [];
        let dirty = false;
        const cleaned = raw.map(v => {
            if (v.photos && v.photos.length > 0) {
                photoCache[v.id] = v.photos; // mantém fotos em memória
                dirty = true;
                return { ...v, photos: [] };  // remove do objeto persistido
            }
            return v;
        });
        if (dirty) {
            // Resalva versão sem fotos para liberar o espaço legado
            localStorage.setItem('hr_visits', JSON.stringify(cleaned));
        }
        return cleaned;
    } catch(e) {
        return [];
    }
})();

let validatedRuptures = [];
let dismissedNotifications = [];
let resolvedRupturesHistory = [];
let historyBackfillNotice = '';
try {
    validatedRuptures = JSON.parse(localStorage.getItem('hr_validated_ruptures')) || [];
    dismissedNotifications = JSON.parse(localStorage.getItem('hr_dismissed')) || [];
    resolvedRupturesHistory = JSON.parse(localStorage.getItem('hr_resolved_ruptures_history')) || [];
} catch(e) {
    console.warn("localStorage indisponível", e);
}

// Funções auxiliares para o padrão de atualizações leves de lojas
function loadStoreUpdates() {
    try { return JSON.parse(localStorage.getItem('hr_store_updates')) || {}; }
    catch(e) { return {}; }
}

function saveStoreUpdates() {
    // Persiste apenas os campos voláteis (lastVisit, currentStatus) de cada loja
    const updates = {};
    stores.forEach(s => {
        if (s.lastVisit || s.currentStatus) {
            updates[s.id] = { lastVisit: s.lastVisit || null, currentStatus: s.currentStatus || 'pending' };
        }
    });
    try {
        localStorage.setItem('hr_store_updates', JSON.stringify(updates));
    } catch(e) {
        console.warn('Falha ao salvar atualizações de lojas:', e);
    }
}

function saveAppStateLocally() {
    saveStoreUpdates();
    try {
        localStorage.setItem('hr_visits', JSON.stringify(visits));
        localStorage.setItem('hr_validated_ruptures', JSON.stringify(validatedRuptures));
        localStorage.setItem('hr_dismissed', JSON.stringify(dismissedNotifications));
        localStorage.setItem('hr_resolved_ruptures_history', JSON.stringify(resolvedRupturesHistory));
    } catch (e) {
        console.warn('Falha ao salvar estado local:', e);
    }
}

async function syncAppStateServer() {
    if (typeof Storage === 'undefined' || !Storage.isServer) return;
    const updatesMap = {};
    stores.forEach(s => {
        if (s.lastVisit || s.currentStatus) {
            updatesMap[s.id] = { lastVisit: s.lastVisit, currentStatus: s.currentStatus };
        }
    });

    try {
        await Storage.syncAll(visits, updatesMap, validatedRuptures, dismissedNotifications, resolvedRupturesHistory);
    } catch (err) {
        console.warn('[Storage] Falha ao sincronizar com servidor:', err);
    }
}

async function persistAppState() {
    saveAppStateLocally();
    await syncAppStateServer();
}

// Inicializa stores mesclando os dados base com overrides persistidos e atualizações salvas
const _storeUpdates = loadStoreUpdates();
let stores = (initialData.stores || []).map(s => {
    const upd = _storeUpdates[s.id];
    return upd ? { ...s, lastVisit: upd.lastVisit, currentStatus: upd.currentStatus } : { ...s };
});

function persistLocalStorageJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}

function cleanPersistedDataForRemovedStores() {
    const existingStoreIds = new Set(stores.map(s => s.id));

    const cleanedVisits = visits.filter(v => existingStoreIds.has(v.storeId));
    if (cleanedVisits.length !== visits.length) {
        visits = cleanedVisits;
        persistLocalStorageJson('hr_visits', visits);
    }

    const cleanedValidatedRuptures = validatedRuptures.filter(r => existingStoreIds.has(r.storeId));
    if (cleanedValidatedRuptures.length !== validatedRuptures.length) {
        validatedRuptures = cleanedValidatedRuptures;
        persistLocalStorageJson('hr_validated_ruptures', validatedRuptures);
    }

    const cleanedResolvedHistory = resolvedRupturesHistory.filter(item => existingStoreIds.has(item.storeId));
    if (cleanedResolvedHistory.length !== resolvedRupturesHistory.length) {
        resolvedRupturesHistory = cleanedResolvedHistory;
        persistLocalStorageJson('hr_resolved_ruptures_history', resolvedRupturesHistory);
    }

    const storeUpdates = loadStoreUpdates();
    const cleanedUpdates = Object.entries(storeUpdates).reduce((acc, [storeId, value]) => {
        if (existingStoreIds.has(storeId) || existingStoreIds.has(Number(storeId))) {
            acc[storeId] = value;
        }
        return acc;
    }, {});

    if (Object.keys(cleanedUpdates).length !== Object.keys(storeUpdates).length) {
        persistLocalStorageJson('hr_store_updates', cleanedUpdates);
    }
}

cleanPersistedDataForRemovedStores();

function safeGetItem(key, def = null) {
    try { return localStorage.getItem(key) || def; } 
    catch(e) { return def; }
}

function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); return true; } 
    catch(e) { return false; }
}

function safeRemoveItem(key) {
    try { localStorage.removeItem(key); } 
    catch(e) {}
}

// Limpa chave legada hr_stores se existir (libera espaço imediatamente)
if (safeGetItem('hr_stores')) {
    safeRemoveItem('hr_stores');
}
if (safeGetItem('hr_products')) {
    safeRemoveItem('hr_products');
}

// DOM Elements
const dashboardStoreList = document.getElementById('dashboardStoreList');
const activeRupturesCount = document.getElementById('activeRupturesCount');
const contentArea = document.getElementById('content-area');
const navItems = document.querySelectorAll('.nav-item');
const storeSelect = document.getElementById('storeSelect');
const productListChecklist = document.getElementById('productListChecklist');
const visitModal = document.getElementById('visitModal');
const addVisitBtn = document.getElementById('addVisitBtn');
const importBtn = document.getElementById('importBtn');
const spreadsheetInput = document.getElementById('spreadsheetInput');
const productSearch = document.getElementById('productSearch');
const visitForm = document.getElementById('visitForm');
const closeModal = document.querySelector('#visitModal .close-modal');
const globalSearch = document.getElementById('globalSearch');
const filterOverdueBtn = document.getElementById('filterOverdueBtn');
const globalStartDate = document.getElementById('globalStartDate');
const globalEndDate = document.getElementById('globalEndDate');
const globalNetworkSelect = document.getElementById('globalNetworkSelect');

// Funï¿½ï¿½o de Notificaï¿½ï¿½o Visual (Toast)
function showToast(message, type = 'success') {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 24px;
            background: #27ae60;
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 10px;
            transform: translateY(100px);
            opacity: 0;
        `;
        document.body.appendChild(toast);
    }
    
    toast.style.background = type === 'success' ? '#27ae60' : '#e74c3c';
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i> ${message}`;
    
    // Mostrar
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    // Esconder
    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
    }, 3000);
}


window.fixEncoding = function(str) {
    if (!str) return str;
    if (str !== '-' && str.length > 0) { var codes = []; for(var i=0;i<str.length;i++) codes.push(str.charCodeAt(i).toString(16)); console.log('fixEncoding input:', str, 'codes:', codes.join(',')); }
    var r = str;
    // Double-encoded UTF-8: prefix is char(0xC3)+char(0x192)+char(0xC2) then last byte
    var dblPfx = String.fromCharCode(0xC3,0x192,0xC2);
    var map = [[0xA3,0xE3],[0xA1,0xE1],[0xA9,0xE9],[0xAD,0xED],[0xB3,0xF3],[0xBA,0xFA],[0xA7,0xE7],[0xB5,0xF5],[0xA2,0xE2],[0xAA,0xEA],[0xB4,0xF4],[0xA0,0xE0]];
    map.forEach(function(m){var s=dblPfx+String.fromCharCode(m[0]);while(r.indexOf(s)!==-1)r=r.replace(s,String.fromCharCode(m[1]));});
    // Single-encoded UTF-8: prefix is char(0xC3) then second byte
    var sglPfx = String.fromCharCode(0xC3);
    map.forEach(function(m){var s=sglPfx+String.fromCharCode(m[0]);while(r.indexOf(s)!==-1)r=r.replace(s,String.fromCharCode(m[1]));});
    return r;
};
let currentGlobalFilter = '';
let showingOnlyOverdue = false;
let globalFilterDateStart = '';
let globalFilterDateEnd = '';
let globalFilterNetworks = []; // Vazio = Todas as Redes
// Redes a excluir da UI (por exemplo lojas removidas do cadastro mestre)
const EXCLUDED_NETWORKS = new Set(['ATACADAO SP']);
let currentPage = 'dashboard';
let reportFilterOnlyRuptures = false; // Filtro "Em Ruptura" na aba de Relatórios
let reportFilterOnlyObservation = false; // Filtro de visitas com observações na aba de Relatórios
let reportFilterOnlyExtraPoints = false; // Filtro de visitas com pontos extras na aba de Relatórios
let reportFilterOnlyExtraVisits = false; // Filtro de Visita Extra na aba de Relatórios
let historyFilterOnlyObservation = false; // Filtro de visitas com observações
let historyFilterOnlyExtraPoints = false; // Filtro de visitas com pontos extras
let historyFilterOnlyExtraVisits = false; // Filtro de Visita Extra
let editingVisitId = null; // null = nova visita | number = ID da visita sendo editada


window.populateGlobalNetworkFilter = function() {
    const container = document.getElementById('globalNetworkOptions');
    const textSpan = document.getElementById('globalSelectedNetworksText');
    if (!container) return;

    const nets = new Set(stores.map(s => s.network).filter(Boolean).filter(net => !EXCLUDED_NETWORKS.has(net)));
    container.innerHTML = '';
    
    Array.from(nets).sort().forEach(net => {
        const isChecked = globalFilterNetworks.includes(net) ? 'checked' : '';
        container.innerHTML += `
            <label style="display: flex; align-items: center; justify-content: flex-start; padding: 6px 4px; cursor: pointer; border-radius: 4px; width: 100%;">
                <input type="checkbox" value="${net}" ${isChecked} onchange="toggleGlobalNetwork('${net}')" style="margin-right: 8px; width: 15px; height: 15px; cursor: pointer; flex-shrink: 0;">
                <span style="text-align: left; color: var(--text-dark); font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${net}</span>
            </label>
        `;
    });
    
    updateGlobalNetworkText(textSpan);
};

window.toggleDropdown = function(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
    }
};

window.toggleGlobalNetwork = function(net) {
    const idx = globalFilterNetworks.indexOf(net);
    if (idx > -1) {
        globalFilterNetworks.splice(idx, 1);
    } else {
        globalFilterNetworks.push(net);
    }
    
    const textSpan = document.getElementById('globalSelectedNetworksText');
    updateGlobalNetworkText(textSpan);
    refreshGlobalDashboard();
};

function updateGlobalNetworkText(spanEl) {
    if (!spanEl) return;
    if (globalFilterNetworks.length === 0) {
        spanEl.textContent = "Todas as Redes";
    } else if (globalFilterNetworks.length === 1) {
        spanEl.textContent = globalFilterNetworks[0];
    } else {
        spanEl.textContent = globalFilterNetworks.length + " Redes";
    }
}

function hydrateResolvedHistoryFromVisits() {
    if (!Array.isArray(visits) || visits.length === 0) return false;

    // Rebuild the active rupture map from the latest visits.
    const latestVisitByStore = visits.reduce((acc, visit) => {
        if (!visit || !visit.storeId || !visit.date) return acc;
        const current = acc[visit.storeId];
        if (!current || new Date(visit.date) > new Date(current.date)) {
            acc[visit.storeId] = visit;
        }
        return acc;
    }, {});

    const activeKeys = new Set();
    Object.values(latestVisitByStore).forEach(visit => {
        (visit.ruptures || []).forEach(productId => {
            activeKeys.add(`${productId}:${visit.storeId}`);
        });
    });

    const sortedVisits = [...visits]
        .filter(v => Array.isArray(v.ruptures) && v.ruptures.length > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    let addedToResolved = 0;
    let addedToActive = 0;
    let didCleanup = false;

    // Clean stale validated ruptures that no longer appear in the latest visit
    const validValidatedRuptures = validatedRuptures.filter(r => {
        const key = `${r.productId}:${r.storeId}`;
        const isValid = activeKeys.has(key);
        if (!isValid) didCleanup = true;
        return isValid;
    });
    if (didCleanup) {
        validatedRuptures = validValidatedRuptures;
    }

    sortedVisits.forEach(visit => {
        const store = stores.find(s => s.id === visit.storeId);
        (visit.ruptures || []).forEach(productId => {
            const key = `${productId}:${visit.storeId}`;
            const latestVisit = latestVisitByStore[visit.storeId];
            const latestVisitDate = latestVisit && latestVisit.date ? new Date(latestVisit.date) : null;
            const visitDateObj = visit.date ? new Date(visit.date) : null;
            const latestHasProduct = latestVisit && Array.isArray(latestVisit.ruptures)
                ? latestVisit.ruptures.includes(productId)
                : false;

            if (latestVisitDate && visitDateObj && latestVisitDate.getTime() > visitDateObj.getTime() && !latestHasProduct) {
                const alreadyExists = resolvedRupturesHistory.some(item =>
                    item.visitId === visit.id && item.productId === productId && item.storeId === visit.storeId
                );
                if (alreadyExists) return;

                const product = products.find(p => p.id === productId);
                const resolvedAt = latestVisit.date;
                const resolvedAtTime = new Date(`${resolvedAt}T12:00:00`).toLocaleString('pt-BR');

                resolvedRupturesHistory.unshift({
                    id: `backfill-${visit.id}-${productId}`,
                    productId,
                    productName: product ? product.name : 'Produto',
                    storeId: visit.storeId,
                    storeName: store ? store.name : 'Loja',
                    network: store ? store.network : '',
                    visitId: visit.id,
                    visitDate: visit.date,
                    resolvedAt,
                    resolvedAtTime,
                    timestamp: new Date(`${resolvedAt}T12:00:00`).getTime()
                });
                addedToResolved += 1;
                didCleanup = true;
                return;
            }

            if (!latestVisit || (latestVisitDate && visitDateObj && latestVisitDate.getTime() === visitDateObj.getTime())) {
                // If this is the latest visit, and the rupture is active, ensure it exists.
                if (!activeKeys.has(key)) {
                    const product = products.find(p => p.id === productId);
                    validatedRuptures.push({
                        id: Date.now() + Math.random(),
                        productId,
                        productName: product ? product.name : 'Produto',
                        storeId: visit.storeId,
                        storeName: store ? store.name : 'Loja',
                        network: store ? store.network : '',
                        visitId: visit.id,
                        visitDate: visit.date,
                        timestamp: new Date().getTime()
                    });
                    activeKeys.add(key);
                    addedToActive += 1;
                    didCleanup = true;
                }
            }
        });
    });

    if (addedToResolved > 0 || addedToActive > 0 || didCleanup) {
        if (addedToActive > 0 || didCleanup) {
            saveAppStateLocally(); // Save the updated validated ruptures
        }
        if (addedToResolved > 0) {
            resolvedRupturesHistory = resolvedRupturesHistory.slice(0, 500);
            historyBackfillNotice = `Histórico antigo carregado: ${addedToResolved} rupturas enviadas para histórico resolvido.`;
        }
        saveAppStateLocally();
        if (typeof Storage !== 'undefined' && Storage.isServer) syncAppStateServer();
        if (typeof renderHistoryViewData === 'function') {
            try { renderHistoryViewData(); } catch(e) {}
        }
        return true;
    }
    return false;
}

// Initialize App
async function init() {
    setupEventListeners();
    checkLoginStatus();
    populateGlobalNetworkFilter();
    checkLoginStatus();
    
    // Sincronizacao com o Servidor HostGator (se disponível)
    if (typeof Storage !== 'undefined' && Storage.isServer) {
        console.log("[Storage] Sincronizando com Servidor...");
        const serverData = await Storage.loadFromServer();
        if (serverData) {
            // Merge server state with local state to avoid overwriting local resolutions.
            if (serverData.visits) visits = serverData.visits;

            // Build resolved keys from server and local resolved history
            const serverResolved = Array.isArray(serverData.resolved_history) ? serverData.resolved_history : [];
            const localResolved = Array.isArray(resolvedRupturesHistory) ? resolvedRupturesHistory : [];
            const resolvedKeys = new Set();
            serverResolved.concat(localResolved).forEach(item => {
                if (item && item.productId && item.storeId) resolvedKeys.add(`${item.productId}:${item.storeId}`);
            });

            // Merge validated ruptures but exclude those already resolved
            const serverValidated = Array.isArray(serverData.validated_ruptures) ? serverData.validated_ruptures : [];
            const localValidated = Array.isArray(validatedRuptures) ? validatedRuptures : [];
            const mergedMap = new Map();

            serverValidated.concat(localValidated).forEach(r => {
                if (!r || typeof r.productId === 'undefined' || typeof r.storeId === 'undefined') return;
                const key = `${r.productId}:${r.storeId}`;
                if (resolvedKeys.has(key)) return; // skip resolved
                if (!mergedMap.has(key)) mergedMap.set(key, r);
            });

            validatedRuptures = Array.from(mergedMap.values());

            // Merge resolved history preferring server then local (unique by visitId+productId+storeId)
            const histMap = new Map();
            serverResolved.concat(localResolved).forEach(h => {
                const k = `${h.visitId || h.id}:${h.productId}:${h.storeId}`;
                if (!histMap.has(k)) histMap.set(k, h);
            });
            resolvedRupturesHistory = Array.from(histMap.values()).slice(0, 500);

            if (serverData.dismissed) dismissedNotifications = serverData.dismissed;

            const sUpdates = serverData.store_updates || {};
            stores = STORES_DATA.map(s => {
                const upd = sUpdates[s.id];
                return upd ? { ...s, lastVisit: upd.lastVisit, currentStatus: upd.currentStatus } : { ...s };
            });
            
            if (serverData.photo_map) {
                Object.keys(serverData.photo_map).forEach(vId => {
                    photoCache[vId] = serverData.photo_map[vId];
                });
            }

            // Persist merged local state so reloads use the merged result
            persistLocalStorageJson('hr_validated_ruptures', validatedRuptures);
            persistLocalStorageJson('hr_resolved_ruptures_history', resolvedRupturesHistory);
            persistLocalStorageJson('hr_visits', visits);
        }
    }

    cleanPersistedDataForRemovedStores();
    hydrateResolvedHistoryFromVisits();

    checkOverdueStores();
    renderPage('dashboard');
    populateSelects();
    renderChecklist();
    updateStats();
    renderValidatedRuptures();
}

function checkLoginStatus() {
    const isLoggedIn = safeGetItem('hr_logged_in') === 'true';
    if (isLoggedIn) {
        document.body.classList.add('logged-in');
        document.body.classList.remove('not-logged-in');
    } else {
        document.body.classList.add('not-logged-in');
        document.body.classList.remove('logged-in');
    }
}

function checkOverdueStores() {
    const now = new Date();
    stores.forEach(store => {
        if (!store.lastVisit) {
            store.currentStatus = 'pending';
            return;
        }

        const lastVisitDate = new Date(store.lastVisit);
        const diffTime = Math.abs(now - lastVisitDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        const freq = store.frequency || 1;
        const maxDays = 7 / freq;

        if (diffDays > maxDays) {
            store.currentStatus = 'overdue';
        } else {
            store.currentStatus = 'visited';
        }
    });
}

let selectedPhotos = [];

function setupEventListeners() {
    const loginForm = document.getElementById('loginForm');
    const visitPhotosInput = document.getElementById('visitPhotos');
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    if (visitPhotosInput) {
        visitPhotosInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            for (const file of files) {
                try {
                    // Tenta comprimir a imagem para otimizar espaço no localStorage
                    const base64 = await compressImage(file);
                    selectedPhotos.push(base64);
                    
                    const preview = document.createElement('div');
                    preview.className = 'preview-item';
                    preview.innerHTML = `<img src="${base64}">`;
                    photoPreviewContainer.appendChild(preview);
                } catch (err) {
                    console.error("Erro ao comprimir imagem, usando original:", err);
                    const base64 = await convertToBase64(file);
                    selectedPhotos.push(base64);
                    
                    const preview = document.createElement('div');
                    preview.className = 'preview-item';
                    preview.innerHTML = `<img src="${base64}">`;
                    photoPreviewContainer.appendChild(preview);
                }
            }
        });
    }

    function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Mantém proporï¿½ï¿½o da imagem ao redimensionar
                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Converte para jpeg comprimido
                    const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressedBase64);
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    }

    function convertToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    addVisitBtn.addEventListener('click', () => visitModal.style.display = 'flex');
    importBtn.addEventListener('click', () => spreadsheetInput.click());

    // Garante reset do modo ediï¿½ï¿½o ao fechar o modal pelo "X"
    closeModal.addEventListener('click', () => {
        visitModal.style.display = 'none';
        productSearch.value = '';
        renderChecklist();
        _resetEditMode();
    });

    spreadsheetInput.addEventListener('change', handleImport);

    productSearch.addEventListener('input', (e) => {
        const selectedStoreId = storeSelect.value;
        const store = stores.find(s => s.id === selectedStoreId);
        renderChecklist(e.target.value, store ? store.productIds : null);
    });

    storeSelect.addEventListener('change', (e) => {
        const selectedStoreId = e.target.value;
        if (selectedStoreId) {
            const store = stores.find(s => s.id === selectedStoreId);
            renderChecklist(productSearch.value, store.productIds);
        } else {
            renderChecklist(productSearch.value);
        }
    });

    addVisitBtn.addEventListener('click', () => {
        _resetEditMode();
        visitModal.style.display = 'flex';
        document.getElementById('visitDate').valueAsDate = new Date();
    });

    globalSearch.addEventListener('input', (e) => {
        currentGlobalFilter = e.target.value.toLowerCase();
        refreshGlobalDashboard();
    });

    globalStartDate?.addEventListener('change', (e) => {
        globalFilterDateStart = e.target.value;
        refreshGlobalDashboard();
    });

    globalEndDate?.addEventListener('change', (e) => {
        globalFilterDateEnd = e.target.value;
        refreshGlobalDashboard();
    });

    window.refreshGlobalDashboard = function() {
        renderDashboard();
        updateStats();
        renderAttentionRanking();
        renderCriticalDelays();
        renderVisitsChart();
        renderValidatedRuptures();
    };

    window.getGlobalFilteredRuptures = function() {
        // Começa excluindo rupturas de redes que não devem aparecer
        let filtered = validatedRuptures.filter(r => {
            const s = stores.find(s => s.id === r.storeId);
            return s && !EXCLUDED_NETWORKS.has(s.network);
        });

        // Filtra por data: usa a data da última visita é loja como referência
        if (globalFilterDateStart || globalFilterDateEnd) {
            filtered = filtered.filter(r => {
                const store = stores.find(s => s.id === r.storeId);
                const visitDate = store && store.lastVisit ? store.lastVisit : null;
                if (!visitDate) return false; // sem visita registrada ? não exibe
                if (globalFilterDateStart && visitDate < globalFilterDateStart) return false;
                if (globalFilterDateEnd && visitDate > globalFilterDateEnd) return false;
                return true;
            });
        }

        // Filtra por rede
        if (globalFilterNetworks.length > 0) {
            filtered = filtered.filter(r => {
                const s = stores.find(store => store.id === r.storeId);
                return s && globalFilterNetworks.includes(s.network);
            });
        }
        return filtered;
    };

    window.getGlobalFilteredVisits = function() {
        let filtered = visits;
        if (globalFilterDateStart) {
            filtered = filtered.filter(v => v.date >= globalFilterDateStart);
        }
        if (globalFilterDateEnd) {
            filtered = filtered.filter(v => v.date <= globalFilterDateEnd);
        }
        if (globalFilterNetworks.length > 0) {
            filtered = filtered.filter(v => {
                const s = stores.find(store => store.id === v.storeId);
                return s && globalFilterNetworks.includes(s.network);
            });
        }
        // Excluir visitas de redes removidas
        filtered = filtered.filter(v => {
            const s = stores.find(store => store.id === v.storeId);
            return s && !EXCLUDED_NETWORKS.has(s.network);
        });
        return filtered;
    };

    window.getGlobalFilteredStores = function() {
        // Começa excluindo redes que não devem aparecer na UI
        let filtered = stores.filter(s => !EXCLUDED_NETWORKS.has(s.network));
        if (globalFilterNetworks.length > 0) {
            filtered = filtered.filter(s => globalFilterNetworks.includes(s.network));
        }
        if (showingOnlyOverdue) {
            filtered = filtered.filter(s => s.currentStatus === 'overdue');
        }
        if (currentGlobalFilter) {
            filtered = filtered.filter(store => {
                const searchTerm = currentGlobalFilter.toLowerCase();
                const matchesStore = (store.name || '').toLowerCase().includes(searchTerm);
                const matchesNetwork = (store.network || '').toLowerCase().includes(searchTerm);
                const matchesProduct = store.productIds?.some(pId => {
                    const product = products.find(p => p.id === pId);
                    return product && (product.name || '').toLowerCase().includes(searchTerm);
                });
                return matchesStore || matchesNetwork || matchesProduct;
            });
        }
        return filtered;
    };

    filterOverdueBtn.addEventListener('click', () => {
        showingOnlyOverdue = !showingOnlyOverdue;
        filterOverdueBtn.classList.toggle('active');
        filterOverdueBtn.style.backgroundColor = showingOnlyOverdue ? 'var(--primary-red)' : '';
        filterOverdueBtn.style.color = showingOnlyOverdue ? 'white' : '';
        renderDashboard();
    });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            renderPage(page);
        });
    });

    const notificationBtn = document.getElementById('notificationBtn');
    const notificationDropdown = document.getElementById('notificationDropdown');
    
    notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationDropdown.classList.toggle('active');
        updateNotifications();
    });

    window.addEventListener('click', () => {
        notificationDropdown.classList.remove('active');
    });

    notificationDropdown.addEventListener('click', (e) => e.stopPropagation());

    window.addEventListener('click', (e) => {
        if (e.target === visitModal) {
            visitModal.style.display = 'none';
            _resetEditMode();
        }
        if (e.target === document.getElementById('productDetailModal')) document.getElementById('productDetailModal').style.display = 'none';
        if (e.target === document.getElementById('reportsModal')) document.getElementById('reportsModal').style.display = 'none';
        if (e.target === document.getElementById('imageModal')) closeImageModal();
        if (e.target === document.getElementById('syncModal')) closeSyncModal();
        
        // Fechar dropdowns de rede se clicar fora
        const networkDropdown = document.getElementById('networkDropdown');
        if (networkDropdown && !networkDropdown.contains(e.target)) {
            const opts = document.getElementById('networkOptions');
            if (opts) opts.style.display = 'none';
        }
        
        const globalDropdown = document.getElementById('globalNetworkDropdown');
        if (globalDropdown && !globalDropdown.contains(e.target)) {
            const opts = document.getElementById('globalNetworkOptions');
            if (opts) opts.style.display = 'none';
        }
    });

    visitForm.addEventListener('submit', handleVisitSubmit);

    // Sidebar navigation is fully handled by the navItems click listener above calling renderPage()
}

function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const text = event.target.result;
        processCSV(text);
    };
    reader.readAsText(file);
}

function processCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return;

    // Detectar delimitador (vírgula ou ponto e vírgula)
    const firstLine = lines[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';
    
    const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase());
    
    // Identificar colunas (usando indexof e removendo possíveis acentos/espaços)
    const findCol = (names) => headers.findIndex(h => names.some(n => h.includes(n)));

    const colLoja = findCol(['loja', 'unidade', 'ponto']);
    const colItem = findCol(['item', 'produto', 'descri']);
    const colRede = findCol(['rede', 'bandeira', 'grupo']);
    const colStatus = findCol(['status', 'situa']);

    if (colLoja === -1 || colItem === -1) {
        alert('Não consegui identificar as colunas de "Loja" e "Item". Verifique o cabeçalho do arquivo.');
        return;
    }

    const newStores = [];
    const newProducts = [];
    const storeMap = new Map();
    const productMap = new Map();

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter);
        
        const storeName = cols[colLoja]?.trim();
        const productName = cols[colItem]?.trim();
        const networkName = colRede !== -1 ? cols[colRede]?.trim() : 'Geral';
        const productStatus = colStatus !== -1 ? cols[colStatus]?.trim() : 'Ativo';
        const storeKey = normalizeText(storeName);
        const productKey = normalizeText(productName);

        if (storeName && !storeMap.has(storeKey)) {
            const id = generateStableId(networkName, storeName);
            const storeObj = { id, name: storeName, network: networkName, lastVisit: null, status: 'pending', productNames: [] };
            newStores.push(storeObj);
            storeMap.set(storeKey, storeObj);
        }

        if (productName && !productMap.has(productKey)) {
            const id = generateStableId('', productName);
            const prodObj = { id, name: productName, network: networkName, status: productStatus };
            newProducts.push(prodObj);
            productMap.set(productKey, prodObj);
        }
        
        // Link product to store (case insensitive)
        if (storeName && productName) {
            const sObj = storeMap.get(storeKey);
            const pObj = productMap.get(productKey);
            if (sObj && pObj && !sObj.productNames.includes(productName)) {
                sObj.productNames.push(productName);
            }
        }
    }

    if (newStores.length > 0 || newProducts.length > 0) {
        const mergedData = mergeDataCollections(products, stores, newProducts, newStores);
        products = mergedData.products;
        stores = mergedData.stores.map(s => {
            const updates = loadStoreUpdates();
            const upd = updates[s.id];
            return upd ? { ...s, lastVisit: upd.lastVisit, currentStatus: upd.currentStatus } : { ...s };
        });

        persistDataOverrides(stores, products);
        saveStoreUpdates();
        localStorage.setItem('hr_visits', JSON.stringify(visits));
        
        
        init();
        showToast(`Importação concluída. ${newStores.length} lojas e ${newProducts.length} produtos adicionados sem apagar o cadastro atual.`, 'success');
    }
}

function renderPage(page) {
    currentPage = page;
    
    window.reportsTableLimit = 50;
    window.historyVisitsLimit = 50;
    window.historyResolvedLimit = 50;
    
    // Reseta o filtro de ruptura ao sair dos relat\u00f3rios
    if (page !== 'reports' && reportFilterOnlyRuptures) {
        reportFilterOnlyRuptures = false;
    }

    // Update Sidebar UI
    navItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-page') === page);
    });

    if (page === 'dashboard') {
        renderDashboardView();
    } else if (page === 'reports') {
        renderReportsView();
    } else if (page === 'history') {
        renderHistoryView();
    } else if (page === 'stores') {
        renderStoresListView();
    } else if (page === 'products') {
        renderProductsListView();
    }
}

function renderDashboard() {
    const list = document.getElementById('dashboardStoreList');
    if (!list) return;
    list.innerHTML = '';
    
    const filteredStores = getGlobalFilteredStores();

    filteredStores.forEach(store => {
        const card = document.createElement('div');
        const eps = typeof getStoreLatestExtraPoints === 'function' ? getStoreLatestExtraPoints(store.id) : [];
        card.className = 'store-card' + (eps.length > 0 ? ' has-extra-point' : '');
        card.innerHTML = `
            <div class="status-indicator ${store.currentStatus || store.status}"></div>
            <div class="store-info">
                <p class="store-name">${store.name} <span class="network-tag">${store.network}</span></p>
                <p class="store-date">${store.lastVisit ? 'última visita: ' + formatDate(store.lastVisit) : 'Nunca visitada'}</p>
                ${eps.length > 0 ? `<div style="margin-top: 6px;">${eps.map(ep => `<span class="badge-extra-point">${ep}</span>`).join('')}</div>` : ''}
            </div>
            <div class="store-badge">
                ${renderStatusBadge(store)}
            </div>
            <button class="btn-icon" onclick="openVisitForStore('${store.id}')"><i class="fa-solid fa-chevron-right"></i></button>
        `;
        list.appendChild(card);
    });
}

function renderHistoryView() {
    contentArea.innerHTML = `
        <div class="panel">
            <div class="panel-header" style="display: block; margin-bottom: 20px;">
                <h2 style="margin-bottom: 8px;">Histórico Completo</h2>
                <p style="margin: 0 0 12px; color: var(--text-light);">Visitas registradas e rupturas já resolvidas para acompanhamento e compra futura.</p>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap;">
                    <div class="header-filters" style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap; flex: 1; min-width: 0;">
                        <div class="search-bar" style="width: 220px;">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input type="text" id="historySearch" placeholder="Buscar loja ou item..." oninput="renderHistoryViewData()">
                        </div>
                        <div class="filter-select" style="display: flex; gap: 8px; align-items: center; padding: 0 15px; height: 42px; background: white; border: 1px solid #eee; border-radius: 12px;">
                            <i class="fa-regular fa-calendar" style="color: var(--text-light); font-size: 0.9rem;"></i>
                            <input type="date" id="historyStartDate" class="hide-calendar-icon" onchange="renderHistoryViewData()" title="Data Inicial" style="border: none; padding: 0; outline: none; background: transparent; cursor: pointer; color: var(--text-dark); font-family: 'Outfit', sans-serif; font-size: 0.9rem;" onclick="this.showPicker()">
                            <span style="color: var(--text-light); font-size: 0.85rem;">até</span>
                            <input type="date" id="historyEndDate" class="hide-calendar-icon" onchange="renderHistoryViewData()" title="Data Final" style="border: none; padding: 0; outline: none; background: transparent; cursor: pointer; color: var(--text-dark); font-family: 'Outfit', sans-serif; font-size: 0.9rem;" onclick="this.showPicker()">
                        </div>
                        <div class="custom-multiselect" style="position: relative; min-width: 220px;">
                            <button id="historyNetworkFilterBtn" class="filter-select" onclick="toggleDropdown('historyNetworkDropdown')" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; background: white; cursor: pointer; height: 42px; padding: 0 15px;">
                                <span id="historyNetworkFilterLabel" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Todas as Redes</span>
                                <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem; color: var(--text-light); margin-left: 10px;"></i>
                            </button>
                            <div id="historyNetworkDropdown" style="display: none; position: absolute; top: calc(100% + 5px); left: 0; right: 0; background: white; border: 1px solid var(--border); border-radius: 6px; z-index: 100; max-height: 280px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 8px;">
                                <label style="display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-bottom: 1px solid #eee; margin-bottom: 4px;">
                                    <input type="checkbox" id="historySelectAllNetworks" checked onchange="toggleAllHistoryNetworks(this);" style="margin-right: 8px; width: 16px; height: 16px; cursor: pointer;">
                                    <strong style="color: var(--text-dark);">Todas as Redes</strong>
                                </label>
                                ${[...new Set(stores.map(s => s.network).filter(Boolean).filter(net => !EXCLUDED_NETWORKS.has(net)))].sort().map(net => `
                                    <label style="display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-radius: 4px;">
                                        <input type="checkbox" class="history-network-checkbox" value="${net}" checked onchange="toggleHistoryNetworkSelection('${net}'); renderHistoryViewData();" style="margin-right: 8px; width: 15px; height: 15px; cursor: pointer;">
                                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dark); font-size: 0.9rem;">${net}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        <div class="custom-multiselect" style="position: relative; min-width: 220px;">
                            <button id="historyProductFilterBtn" class="filter-select" onclick="toggleDropdown('historyProductDropdown')" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; background: white; cursor: pointer; height: 42px; padding: 0 15px;">
                                <span id="historyProductFilterLabel" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Todos os Produtos</span>
                                <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem; color: var(--text-light); margin-left: 10px;"></i>
                            </button>
                            <div id="historyProductDropdown" style="display: none; position: absolute; top: calc(100% + 5px); left: 0; right: 0; background: white; border: 1px solid var(--border); border-radius: 6px; z-index: 100; max-height: 280px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 8px;">
                                <label style="display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-bottom: 1px solid #eee; margin-bottom: 4px;">
                                    <input type="checkbox" id="historySelectAllProducts" checked onchange="toggleAllHistoryProducts(this);" style="margin-right: 8px; width: 16px; height: 16px; cursor: pointer;">
                                    <strong style="color: var(--text-dark);">Todos os Produtos</strong>
                                </label>
                                ${products.map(prod => `
                                    <label style="display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-radius: 4px;">
                                        <input type="checkbox" class="history-product-checkbox" value="${prod.id}" checked onchange="toggleHistoryProductSelection('${prod.id}'); renderHistoryViewData();" style="margin-right: 8px; width: 15px; height: 15px; cursor: pointer;">
                                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dark); font-size: 0.9rem;">${prod.name}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        <button id="historyExtraPointsFilterBtn" onclick="toggleHistoryExtraPointsFilter()" class="filter-select" title="Mostrar apenas visitas com pontos extras" style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;">
                            <i class="fa-solid fa-star"></i>
                            <span>Com ponto extra</span>
                        </button>
                        <button id="historyObservationFilterBtn" onclick="toggleHistoryObservationFilter()" class="filter-select" title="Mostrar apenas visitas com observações" style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;">
                            <i class="fa-solid fa-comment-dots"></i>
                            <span>Com observação</span>
                        </button>
                        <button id="historyExtraVisitsFilterBtn" onclick="toggleHistoryExtraVisitsFilter()" class="filter-select" title="Mostrar apenas Visitas Extras" style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;">
                            <i class="fa-solid fa-award"></i>
                            <span>Somente Visitas Extras</span>
                        </button>
                        <div class="filter-select" style="padding: 0 15px; height: 42px; background: white; border: 1px solid #eee; border-radius: 12px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-filter"></i>
                            <select id="historyStatusFilter" onchange="renderHistoryViewData()" style="border: none; background: transparent; outline: none; cursor: pointer;">
                                <option value="all">Todos</option>
                                <option value="resolved">Só resolvidos</option>
                                <option value="active">Não resolvidos</option>
                            </select>
                        </div>
                    </div>
                    <div class="header-actions" style="display: flex; gap: 15px; align-items: center; flex-shrink: 0; justify-content: flex-end;">
                        <button class="btn btn-secondary" onclick="exportHistoryCSV()"><i class="fa-solid fa-file-csv"></i> Exportar CSV</button>
                        <button class="btn btn-primary" onclick="exportHistoryPDF()"><i class="fa-solid fa-file-pdf"></i> Exportar PDF</button>
                    </div>
                </div>
            </div>
            <div class="reports-container" style="display: grid; gap: 24px;">
                <div id="historyBackfillNotice" style="display: none; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; background: #eefbf2; color: #1f6f3f; border: 1px solid #c8e6c9; font-size: 0.9rem;"></div>
                <div>
                    <h3 style="margin-bottom: 10px;">Histórico de Visitas</h3>
                    <table class="reports-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Loja</th>
                                <th>Rede</th>
                                <th>Rupturas</th>
                                <th>Status da visita</th>
                                <th>Pontos Extras</th>
                                <th>Observações</th>
                            </tr>
                        </thead>
                        <tbody id="historyVisitsTableBody"></tbody>
                    </table>
                </div>
                <div>
                    <h3 style="margin-bottom: 10px;">Rupturas Resolvidas</h3>
                    <table class="reports-table">
                        <thead>
                            <tr>
                                <th>Produto</th>
                                <th>Loja</th>
                                <th>Visita</th>
                                <th>Resolvido em</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="historyResolvedTableBody"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    updateHistoryFilterLabels();
    renderHistoryViewData();
}

function renderReportsView() {
    contentArea.innerHTML = `
        <div class="panel">
            <div class="panel-header" style="display: block; margin-bottom: 20px;">
                <h2 style="margin-bottom: 15px;">Histórico de Visitas (Relatórios)</h2>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap;">
                    <div class="header-filters" style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap; flex: 1; min-width: 0;">
                        <div class="search-bar" style="width: 200px;">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input type="text" id="reportSearch" placeholder="Buscar loja ou item..." oninput="renderReportsTable()">
                        </div>
                        <div class="filter-select" style="display: flex; gap: 8px; align-items: center; padding: 0 15px; height: 42px; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif;">
                            <i class="fa-regular fa-calendar" style="color: var(--text-light); font-size: 0.9rem;"></i>
                            <input type="date" id="reportStartDate" class="hide-calendar-icon" onchange="renderReportsTable()" title="Data Inicial" style="border: none; padding: 0; outline: none; background: transparent; cursor: pointer; color: var(--text-dark); font-family: 'Outfit', sans-serif; font-size: 0.9rem;" onclick="this.showPicker()">
                            <span style="color: var(--text-light); font-size: 0.85rem;">até</span>
                            <input type="date" id="reportEndDate" class="hide-calendar-icon" onchange="renderReportsTable()" title="Data Final" style="border: none; padding: 0; outline: none; background: transparent; cursor: pointer; color: var(--text-dark); font-family: 'Outfit', sans-serif; font-size: 0.9rem;" onclick="this.showPicker()">
                        </div>
                        <div class="custom-multiselect" style="position: relative; width: 220px;">
                            <button id="networkFilterBtn" class="filter-select" onclick="toggleNetworkDropdown()" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; background: white; cursor: pointer; height: 42px; padding: 0 15px;">
                                <span id="networkFilterLabel" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Todas as Redes</span>
                                <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem; color: var(--text-light); margin-left: 10px;"></i>
                            </button>
                            <div id="networkDropdown" style="display: none; position: absolute; top: calc(100% + 5px); left: 0; right: 0; background: white; border: 1px solid var(--border); border-radius: 6px; z-index: 100; max-height: 280px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 8px;">
                                <label style="display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-bottom: 1px solid #eee; margin-bottom: 4px;">
                                    <input type="checkbox" id="selectAllNetworks" checked onchange="toggleAllNetworks(this)" style="margin-right: 8px; width: 16px; height: 16px; cursor: pointer;">
                                    <strong style="color: var(--text-dark);">Todas as Redes</strong>
                                </label>
                                ${[...new Set(stores.map(s => s.network).filter(Boolean).filter(net => !EXCLUDED_NETWORKS.has(net)))].sort().map(net => `
                                    <label style="display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-radius: 4px;">
                                        <input type="checkbox" class="network-checkbox" value="${net}" checked onchange="updateNetworkFilterLabel()" style="margin-right: 8px; width: 15px; height: 15px; cursor: pointer;">
                                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dark); font-size: 0.9rem;">${net}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        <button id="reportExtraPointsFilterBtn" onclick="toggleReportExtraPointsFilter()" class="filter-select" title="Mostrar apenas visitas com pontos extras" style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;">
                            <i class="fa-solid fa-star"></i>
                            <span>Com ponto extra</span>
                        </button>
                        <button id="reportObservationFilterBtn" onclick="toggleReportObservationFilter()" class="filter-select" title="Mostrar apenas visitas com observações" style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;">
                            <i class="fa-solid fa-comment-dots"></i>
                            <span>Com observação</span>
                        </button>
                        <button id="reportExtraVisitsFilterBtn" onclick="toggleReportExtraVisitsFilter()" class="filter-select" title="Mostrar apenas Visitas Extras" style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;">
                            <i class="fa-solid fa-award"></i>
                            <span>Somente Visitas Extras</span>
                        </button>
                        <button
                            id="reportRuptureFilterBtn"
                            onclick="toggleRuptureFilter()"
                            class="filter-select"
                            title="Mostrar apenas lojas com ruptura nesta visita"
                            style="height: 42px; padding: 0 15px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: white; border: 1px solid #eee; border-radius: 12px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: var(--text-dark); transition: background 0.2s, color 0.2s, border-color 0.2s; white-space: nowrap;"
                        >
                            <i class="fa-solid fa-triangle-exclamation" style="font-size: 0.85rem;"></i>
                            Em Ruptura
                        </button>
                    </div>
                    <div class="header-actions" style="display: flex; gap: 15px; align-items: center; flex-shrink: 0; justify-content: flex-end;">
                        <button class="btn btn-secondary" onclick="exportVisitsCSV()">
                            <i class="fa-solid fa-file-csv"></i> Exportar CSV
                        </button>
                        <button class="btn btn-primary" onclick="exportVisitsPDF()">
                            <i class="fa-solid fa-file-pdf"></i> Exportar PDF
                        </button>
                        <button id="bulkDeleteBtn" class="btn btn-danger" style="display: none;" onclick="deleteSelectedVisits()">
                            <i class="fa-solid fa-trash"></i> Excluir Selecionados
                        </button>
                    </div>
                </div>
            </div>
            <div class="reports-container">
                <table class="reports-table">
                    <thead>
                        <tr>
                            <th><input type="checkbox" id="selectAllVisits" onclick="toggleSelectAll(this)"></th>
                            <th>Data</th>
                            <th>Loja</th>
                            <th>Rede</th>
                            <th>Rupturas</th>
                            <th>Fotos</th>
                            <th>Pontos Extras</th>
                            <th>Observações</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody id="reportsTableBody">
                        <!-- Visitas aqui -->
                    </tbody>
                </table>
            </div>
        </div>
    `;
    renderReportsTable();
}

function renderDashboardView() {
    contentArea.innerHTML = `
        <div class="dashboard-stats">
            <div class="stat-card">
                <div class="stat-icon red"><i class="fa-solid fa-store"></i></div>
                <div class="stat-details">
                    <h3>Lojas Totais</h3>
                    <p id="totalStores">${stores.length}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon blue"><i class="fa-solid fa-calendar-check"></i></div>
                <div class="stat-details">
                    <h3>Visitas este Mês</h3>
                    <p id="totalVisits">${visits.length}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon orange"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <div class="stat-details">
                    <h3>Taxa de Ruptura</h3>
                    <p id="ruptureRate">${calculateRuptureRate()}%</p>
                </div>
            </div>
        </div>

        <div class="dashboard-grid">
            <!-- Linha 1: Operacional -->
            <div class="panel store-status">
                <div class="panel-header">
                    <h2>Status das Lojas</h2>
                </div>
                <div class="store-list" id="dashboardStoreList">
                    <!-- Injected by JS -->
                </div>
            </div>

            <div class="panel rupture-trends">
                <div class="panel-header">
                    <h2>Alerta de Produtos em Ruptura</h2>
                    <span class="badge-count" id="activeRupturesCount">${validatedRuptures.length}</span>
                </div>
                <div class="rupture-search-bar">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="ruptureStoreSearch" placeholder="Pesquisar por loja..." oninput="filterRupturesByStore()">
                </div>
                <div class="rupture-management-list" id="dashboardProductAlerts">
                    <!-- Injected by JS -->
                </div>
            </div>

            <!-- Linha 2: Analítico (Gráfico) -->
            <div class="panel visits-chart-panel" style="grid-column: span 2;">
                <div class="panel-header">
                    <h2>Tendência de Visitas por Rede (Últimos 7 Dias)</h2>
                </div>
                <div class="chart-container" style="height: 250px; position: relative;">
                    <canvas id="visitsChart"></canvas>
                </div>
            </div>

            <!-- Linha 3: Estratégico (Compacto) -->
            <div class="panel ranking-panel" style="max-height: 300px; overflow-y: auto;">
                <div class="panel-header">
                    <h2>TOP 5: Atenção</h2>
                    <i class="fa-solid fa-ranking-star" style="color: var(--primary-red);"></i>
                </div>
                <div class="ranking-list" id="attentionRanking">
                    <!-- Injected by JS -->
                </div>
            </div>

            <div class="panel critical-delay-panel" style="max-height: 300px; overflow-y: auto;">
                <div class="panel-header">
                    <h2>Atraso Crítico (+14 dias)</h2>
                    <i class="fa-solid fa-triangle-exclamation" style="color: orange;"></i>
                </div>
                <div class="critical-list" id="criticalDelayList">
                    <!-- Injected by JS -->
                </div>
            </div>
        </div>
    `;
    
    // Re-link dynamic elements
    renderDashboard(); 
    renderValidatedRuptures();
    renderVisitsChart();
    renderAttentionRanking();
    renderCriticalDelays();
}

function renderAttentionRanking() {
    const container = document.getElementById('attentionRanking');
    if (!container) return;
    container.innerHTML = '';

    const fVisits = typeof getGlobalFilteredVisits === 'function' ? getGlobalFilteredVisits() : visits;
    const fRuptures = typeof getGlobalFilteredRuptures === 'function' ? getGlobalFilteredRuptures() : validatedRuptures;

    // Se não houver visitas E não houver rupturas validadas no filtro, não mostra ranking
    if (fVisits.length === 0 && fRuptures.length === 0) {
        container.innerHTML = '<p class="empty-state" style="padding: 10px;">Aguardando dados para gerar ranking...</p>';
        return;
    }

    const now = new Date();
    const fStores = typeof getGlobalFilteredStores === 'function' ? getGlobalFilteredStores() : stores;
    const ranked = fStores.map(store => {
        const lastVisitDate = store.lastVisit ? new Date(store.lastVisit) : null;
        const daysSince = lastVisitDate ? Math.floor((now - lastVisitDate) / (1000 * 60 * 60 * 24)) : 0;
        const ruptureCount = fRuptures.filter(r => r.storeId === store.id).length;
        
        // Só gera score se tiver pelo menos um motivo de atenï¿½ï¿½o
        return {
            ...store,
            score: (ruptureCount * 5) + daysSince
        };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    if (ranked.length === 0) {
        container.innerHTML = '<p class="empty-state" style="padding: 10px;">Nenhuma loja requer atenï¿½ï¿½o imediata.</p>';
        return;
    }

    ranked.forEach((store, index) => {
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.innerHTML = `
            <div class="rank-number">${index + 1}</div>
            <div class="rank-info">
                <strong>${store.name}</strong>
                <span>Score de Risco: ${store.score}</span>
            </div>
            <button class="btn-icon" onclick="openVisitForStore('${store.id}')"><i class="fa-solid fa-location-arrow"></i></button>
        `;
        container.appendChild(item);
    });
}

function renderCriticalDelays() {
    const container = document.getElementById('criticalDelayList');
    if (!container) return;
    container.innerHTML = '';

    const now = new Date();
    const fStores = typeof getGlobalFilteredStores === 'function' ? getGlobalFilteredStores() : stores;
    // Só entra no atraso crítico se já tiver sido visitada alguma vez (para ter um parâmetro)
    const critical = fStores.filter(store => {
        if (!store.lastVisit) return false; 
        const lastVisitDate = new Date(store.lastVisit);
        const daysSince = Math.floor((now - lastVisitDate) / (1000 * 60 * 60 * 24));
        return daysSince >= 14;
    }).sort((a, b) => {
        const dateA = new Date(a.lastVisit);
        const dateB = new Date(b.lastVisit);
        return dateA - dateB;
    });

    if (critical.length === 0) {
        container.innerHTML = '<p class="empty-state" style="padding: 10px;">Aguardando histórico de visitas...</p>';
        return;
    }

    critical.forEach(store => {
        const days = store.lastVisit ? Math.floor((now - new Date(store.lastVisit)) / (1000 * 60 * 60 * 24)) : '8';
        const item = document.createElement('div');
        item.className = 'critical-item';
        item.innerHTML = `
            <div class="critical-info">
                <strong>${store.name}</strong>
                <span>Sem visita há ${days} dias</span>
            </div>
            <i class="fa-solid fa-circle-exclamation" style="color: var(--primary-red);"></i>
        `;
        container.appendChild(item);
    });
}

function renderVisitsChart() {
    const ctx = document.getElementById('visitsChart');
    if (!ctx) return;
    
    if (typeof Chart === 'undefined') {
        const container = ctx.parentElement;
        if (container) container.innerHTML = '<p style="padding: 20px; text-align: center; color: #666;">Gráfico indisponível (verifique sua conexão)</p>';
        return;
    }

    const fVisits = typeof getGlobalFilteredVisits === 'function' ? getGlobalFilteredVisits() : visits;

    // Determinar range de datas para o eixo X
    let startDate, endDate;
    const now = new Date();

    if (globalFilterDateStart && globalFilterDateEnd) {
        startDate = new Date(globalFilterDateStart + 'T12:00:00');
        endDate = new Date(globalFilterDateEnd + 'T12:00:00');
    } else if (globalFilterDateStart) {
        startDate = new Date(globalFilterDateStart + 'T12:00:00');
        endDate = now;
    } else if (globalFilterDateEnd) {
        endDate = new Date(globalFilterDateEnd + 'T12:00:00');
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 29);
    } else {
        endDate = now;
        startDate = new Date();
        startDate.setDate(now.getDate() - 29);
    }

    // Limitar a no máximo 60 dias para não sobrecarregar o grï¿½fico
    const diffDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
    const totalDays = Math.min(diffDays, 60);
    
    const labels = [];
    for (let i = totalDays; i >= 0; i--) {
        const d = new Date(endDate);
        d.setDate(endDate.getDate() - i);
        labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    }

    // Agrupar visitas por Rede e Data
    const fStores = typeof getGlobalFilteredStores === 'function' ? getGlobalFilteredStores() : stores;
    
    // Cores por rede para o gráfico
    const networkColors = {
        'Bretas': '#E60000',     // Vermelho
        'Bahamas': '#FF8C00',    // Laranja
        'Supermercados BH': '#003366', // Azul Escuro
        'Mart Minas': '#009933'  // Verde
    };

    const chartNetworks = (typeof globalFilterNetworks !== 'undefined' && globalFilterNetworks.length > 0)
        ? globalFilterNetworks
        : Array.from(new Set(fStores.map(s => s.network).filter(Boolean).filter(net => !EXCLUDED_NETWORKS.has(net))));

    const datasets = chartNetworks.map((net, index) => {
        const data = labels.map(label => {
            const visitCount = fVisits.filter(v => {
                const store = stores.find(s => s.id === v.storeId);
                const vDateObj = new Date(v.date + 'T12:00:00');
                const vDateStr = vDateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                return store && store.network === net && vDateStr === label;
            }).length;
            return visitCount;
        });

        // Cores variadas
        const colors = ['#E53935', '#0047AB', '#FFC107', '#4CAF50', '#9C27B0', '#FF9800'];
        return {
            label: net,
            data: data,
            borderColor: colors[index % colors.length],
            backgroundColor: 'transparent',
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 4
        };
    });

    new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, usePointStyle: true } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderStoresListView() {
    contentArea.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h2>Gestão de Lojas (${stores.length})</h2>
                <div class="search-bar" style="width: 300px;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="storePageSearch" placeholder="Filtrar lojas...">
                </div>
            </div>
            <div class="store-grid-full" id="storePageList">
                <!-- Injected by JS -->
            </div>
        </div>
    `;
    
    const searchInput = document.getElementById('storePageSearch');
    searchInput.addEventListener('input', (e) => {
        renderStorePageItems(e.target.value.toLowerCase());
    });
    
    renderStorePageItems();
}

function getStoreLatestExtraPoints(storeId) {
    const storeVisits = visits.filter(v => v.storeId === storeId).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (storeVisits.length > 0) {
        return storeVisits[0].extraPoints || [];
    }
    return [];
}

function renderStorePageItems(filter = '') {
    const container = document.getElementById('storePageList');
    if (!container) return;
    container.innerHTML = '';
    
    const filtered = stores.filter(s => 
        (s.name || '').toLowerCase().includes(filter) || 
        (s.network || '').toLowerCase().includes(filter)
    );

    filtered.forEach(store => {
        const item = document.createElement('div');
        const eps = getStoreLatestExtraPoints(store.id);
        item.className = 'store-card-full' + (eps.length > 0 ? ' has-extra-point' : '');
        item.innerHTML = `
            <div class="store-main-info">
                <span class="status-indicator ${store.currentStatus || 'pending'}"></span>
                <strong>${store.name}</strong>
                <span class="network-tag">${store.network}</span>
                ${eps.map(ep => `<span class="badge-extra-point">${ep}</span>`).join('')}
            </div>
            <div class="store-meta">
                <span>Frequência: ${store.frequency || 1}x/sem</span>
                <button class="btn btn-secondary btn-small" onclick="openVisitForStore('${store.id}')">Visitar</button>
            </div>
        `;
        container.appendChild(item);
    });
}

function renderProductsListView() {
    contentArea.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h2>Análise de Produtos e Rupturas</h2>
            </div>
            <div class="reports-container">
                <table class="reports-table">
                    <thead>
                        <tr>
                            <th>Produto</th>
                            <th>Total Rupturas</th>
                            <th>Lojas Afetadas</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody id="productsTableBody">
                        <!-- Injected by JS -->
                    </tbody>
                </table>
            </div>
        </div>
        <div id="productDetailModal" class="modal-detail" style="display:none">
            <!-- Modal dinâmico -->
        </div>
    `;
    renderProductsTable();
}

function renderProductsTable() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    const fRuptures = typeof getGlobalFilteredRuptures === 'function' ? getGlobalFilteredRuptures() : validatedRuptures;

    products.forEach(product => {
        // Calcular rupturas para este produto
        const productRuptures = fRuptures.filter(r => r.productId === product.id);
        const storesAffected = [...new Set(productRuptures.map(r => r.storeId))].length;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${product.name}</strong></td>
            <td><span class="badge-rupture">${productRuptures.length}</span></td>
            <td>${storesAffected} lojas</td>
            <td><span class="status-tag ${productRuptures.length > 0 ? 'warning' : 'ok'}">${productRuptures.length > 0 ? 'Com Ruptura' : 'Normal'}</span></td>
            <td>
                <button class="btn btn-secondary btn-small" onclick="showProductDetails('${product.id}')">
                    <i class="fa-solid fa-eye"></i> Detalhes
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.showProductDetails = function(productId) {
    const product = products.find(p => p.id === productId);
    const fRuptures = typeof getGlobalFilteredRuptures === 'function' ? getGlobalFilteredRuptures() : validatedRuptures;
    const productRuptures = fRuptures.filter(r => r.productId === productId);
    
    const modal = document.getElementById('productDetailModal');
    modal.style.display = 'flex';
    
    modal.innerHTML = `
        <div class="modal-content small">
            <div class="modal-header">
                <h2>Lojas em Ruptura: ${product.name}</h2>
                <span class="close-modal" onclick="document.getElementById('productDetailModal').style.display='none'">&times;</span>
            </div>
            <div class="modal-body">
                <ul class="detail-list">
                    ${productRuptures.length === 0 ? '<li>Nenhuma ruptura ativa.</li>' : 
                      productRuptures.map(r => `
                        <li>
                            <div class="detail-item">
                                <strong>${r.storeName}</strong>
                                <span class="rupture-time">${getTimeDiff(r.timestamp)}</span>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        </div>
    `;
};

function getHistoryFilterState() {
    const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
    const startDate = document.getElementById('historyStartDate')?.value || '';
    const endDate = document.getElementById('historyEndDate')?.value || '';
    const statusFilter = document.getElementById('historyStatusFilter')?.value || 'all';
    const selectedNetworks = Array.from(document.querySelectorAll('#historyNetworkDropdown .history-network-checkbox:checked')).map(cb => cb.value);
    const selectedProductIds = Array.from(document.querySelectorAll('#historyProductDropdown .history-product-checkbox:checked')).map(cb => cb.value);
    const onlyWithObservation = historyFilterOnlyObservation;

    return {
        searchTerm,
        startDate,
        endDate,
        statusFilter,
        selectedNetworks,
        selectedProductIds,
        onlyWithObservation,
        onlyWithExtraPoints: historyFilterOnlyExtraPoints,
        onlyExtraVisits: historyFilterOnlyExtraVisits
    };
}

function updateHistoryFilterLabels() {
    const networkLabel = document.getElementById('historyNetworkFilterLabel');
    if (networkLabel) {
        const selectedNetworks = Array.from(document.querySelectorAll('#historyNetworkDropdown .history-network-checkbox:checked')).map(cb => cb.value);
        if (selectedNetworks.length === 0) {
            networkLabel.textContent = 'Nenhuma rede';
        } else if (selectedNetworks.length === 1) {
            networkLabel.textContent = selectedNetworks[0];
        } else {
            networkLabel.textContent = `${selectedNetworks.length} redes`;
        }
    }

    const productLabel = document.getElementById('historyProductFilterLabel');
    if (productLabel) {
        const selectedProducts = Array.from(document.querySelectorAll('#historyProductDropdown .history-product-checkbox:checked')).map(cb => cb.value);
        if (selectedProducts.length === 0) {
            productLabel.textContent = 'Nenhum produto';
        } else if (selectedProducts.length === 1) {
            const product = products.find(p => String(p.id) === selectedProducts[0]);
            productLabel.textContent = product ? product.name : '1 produto';
        } else {
            productLabel.textContent = `${selectedProducts.length} produtos`;
        }
    }
}

window.toggleAllHistoryNetworks = function(master) {
    document.querySelectorAll('#historyNetworkDropdown .history-network-checkbox').forEach(cb => cb.checked = master.checked);
    document.getElementById('historySelectAllNetworks').checked = master.checked;
    updateHistoryFilterLabels();
    renderHistoryViewData();
};

window.toggleHistoryExtraVisitsFilter = function() {
    historyFilterOnlyExtraVisits = !historyFilterOnlyExtraVisits;
    const btn = document.getElementById('historyExtraVisitsFilterBtn');
    if (btn) {
        btn.style.background = historyFilterOnlyExtraVisits ? 'var(--primary-red)' : 'white';
        btn.style.color = historyFilterOnlyExtraVisits ? 'white' : 'var(--text-dark)';
        btn.style.borderColor = historyFilterOnlyExtraVisits ? 'var(--primary-red)' : '#eee';
    }
    renderHistoryViewData();
};

window.toggleHistoryNetworkSelection = function(net) {
    const allBoxes = document.querySelectorAll('#historyNetworkDropdown .history-network-checkbox');
    const checkedBoxes = Array.from(allBoxes).filter(cb => cb.checked);
    document.getElementById('historySelectAllNetworks').checked = checkedBoxes.length === allBoxes.length;
    updateHistoryFilterLabels();
    renderHistoryViewData();
};

window.toggleAllHistoryProducts = function(master) {
    document.querySelectorAll('#historyProductDropdown .history-product-checkbox').forEach(cb => cb.checked = master.checked);
    document.getElementById('historySelectAllProducts').checked = master.checked;
    updateHistoryFilterLabels();
    renderHistoryViewData();
};

window.toggleHistoryObservationFilter = function() {
    historyFilterOnlyObservation = !historyFilterOnlyObservation;
    const btn = document.getElementById('historyObservationFilterBtn');
    if (btn) {
        btn.style.background = historyFilterOnlyObservation ? 'var(--primary-red)' : 'white';
        btn.style.color = historyFilterOnlyObservation ? 'white' : 'var(--text-dark)';
        btn.style.borderColor = historyFilterOnlyObservation ? 'var(--primary-red)' : '#eee';
    }
    renderHistoryViewData();
};

window.toggleHistoryExtraPointsFilter = function() {
    historyFilterOnlyExtraPoints = !historyFilterOnlyExtraPoints;
    const btn = document.getElementById('historyExtraPointsFilterBtn');
    if (btn) {
        btn.style.background = historyFilterOnlyExtraPoints ? 'var(--primary-red)' : 'white';
        btn.style.color = historyFilterOnlyExtraPoints ? 'white' : 'var(--text-dark)';
        btn.style.borderColor = historyFilterOnlyExtraPoints ? 'var(--primary-red)' : '#eee';
    }
    renderHistoryViewData();
};

window.toggleHistoryProductSelection = function(productId) {
    const allBoxes = document.querySelectorAll('#historyProductDropdown .history-product-checkbox');
    const checkedBoxes = Array.from(allBoxes).filter(cb => cb.checked);
    document.getElementById('historySelectAllProducts').checked = checkedBoxes.length === allBoxes.length;
    updateHistoryFilterLabels();
    renderHistoryViewData();
};

function getFilteredHistoryData() {
    const filters = getHistoryFilterState();
    const statusFilter = filters.statusFilter;

    const filteredVisits = [...visits].filter(v => {
        const store = stores.find(s => s.id === v.storeId);
        if (!store) return false;

        const matchesText = !filters.searchTerm || (store?.name || '').toLowerCase().includes(filters.searchTerm) || (store?.network || '').toLowerCase().includes(filters.searchTerm) || (v.notes || '').toLowerCase().includes(filters.searchTerm) || (v.ruptures || []).some(r => {
            const p = products.find(prod => prod.id === r);
            return (p?.name || '').toLowerCase().includes(filters.searchTerm);
        });
        const matchesDate = (!filters.startDate || v.date >= filters.startDate) && (!filters.endDate || v.date <= filters.endDate);
        const matchesNetwork = filters.selectedNetworks.length === 0 ? false : filters.selectedNetworks.includes(store.network);
        const matchesProduct = filters.selectedProductIds.length === 0 ? true : (v.ruptures || []).some(r => filters.selectedProductIds.includes(r));
        const matchesObservation = !filters.onlyWithObservation || (v.notes || '').trim().length > 0;
        const matchesExtraPoints = !filters.onlyWithExtraPoints || (v.extraPoints && v.extraPoints.length > 0);
        const matchesExtraVisits = !filters.onlyExtraVisits || !!v.isExtra;
        let includeVisit = statusFilter !== 'resolved';
        if (statusFilter === 'active') {
            const summary = getVisitResolutionSummary(v);
            includeVisit = summary.totalItems > summary.resolvedCount;
        }
        return matchesText && matchesDate && matchesNetwork && matchesProduct && matchesObservation && matchesExtraPoints && matchesExtraVisits && includeVisit;
    });

    const filteredResolved = statusFilter === 'active' ? [] : [...resolvedRupturesHistory].filter(item => {
        const matchesText = !filters.searchTerm || (item.storeName || '').toLowerCase().includes(filters.searchTerm) || (item.productName || '').toLowerCase().includes(filters.searchTerm);
        const matchesDate = (!filters.startDate || item.resolvedAt >= filters.startDate) && (!filters.endDate || item.resolvedAt <= filters.endDate);
        const matchesProduct = filters.selectedProductIds.length === 0 || filters.selectedProductIds.includes(String(item.productId));
        return matchesText && matchesDate && matchesProduct;
    });

    return { filteredVisits, filteredResolved };
}

function renderHistoryViewData() {
    const { filteredVisits, filteredResolved } = getFilteredHistoryData();

    const noticeEl = document.getElementById('historyBackfillNotice');
    if (noticeEl) {
        noticeEl.style.display = historyBackfillNotice ? 'flex' : 'none';
        noticeEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${historyBackfillNotice}</span>`;
    }

    const tbodyVisits = document.getElementById('historyVisitsTableBody');
    if (tbodyVisits) {
        if (filteredVisits.length === 0) {
            tbodyVisits.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma visita encontrada para os filtros aplicados.</td></tr>';
        } else {
            tbodyVisits.innerHTML = '';
            
            const limit = window.historyVisitsLimit || 50;
            filteredVisits.slice(0, limit).forEach(visit => {
                const store = stores.find(s => s.id === visit.storeId);
                const summary = getVisitResolutionSummary(visit);
                const row = document.createElement('tr');
                row.style.background = summary.totalItems > 0 && summary.resolvedCount === summary.totalItems ? '#f4fff5' : '';
                row.innerHTML = `
                    <td>${formatDate(visit.date)}</td>
                    <td><strong>${store ? store.name : 'Loja Removida'}${visit.isExtra ? ' <span class="badge-visit-extra">⭐ Visita Extra</span>' : ''}</strong></td>
                    <td>${store ? store.network : '-'}</td>
                    <td><span class="badge-rupture">${(visit.ruptures || []).length} Itens</span></td>
                    <td>${getVisitResolutionBadge(visit)}</td>
                    <td>${(visit.extraPoints || []).map(ep => `<span class="badge-extra-point">${ep}</span>`).join('') || '-'}</td>
                    <td>${window.fixEncoding(visit.notes) || '-'}</td>
                `;
                tbodyVisits.appendChild(row);
            });
            
            if (filteredVisits.length > limit) {
                const loadMore = document.createElement('tr');
                loadMore.innerHTML = `<td colspan="7" style="text-align:center; padding:15px;"><button class="btn btn-secondary" onclick="window.historyVisitsLimit += 50; renderHistoryViewData();">Carregar mais ${Math.min(50, filteredVisits.length - limit)} (Restam ${filteredVisits.length - limit})</button></td>`;
                tbodyVisits.appendChild(loadMore);
            }
        }
    }

    const tbodyResolved = document.getElementById('historyResolvedTableBody');
    if (tbodyResolved) {
        if (filteredResolved.length === 0) {
            tbodyResolved.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma ruptura resolvida encontrada para os filtros aplicados.</td></tr>';
        } else {
            tbodyResolved.innerHTML = '';
            const limitResolved = window.historyResolvedLimit || 50;
            filteredResolved.slice(0, limitResolved).forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${item.productName || 'Produto'}</strong></td>
                    <td>${item.storeName || 'Loja'}</td>
                    <td>${item.visitDate ? formatDate(item.visitDate) : '-'}</td>
                    <td>${item.resolvedAt ? formatDate(item.resolvedAt) : '-'}</td>
                    <td><span class="status-tag ok">Resolvido</span></td>
                `;
                tbodyResolved.appendChild(row);
            });
            if (filteredResolved.length > limitResolved) {
                const loadMore = document.createElement('tr');
                loadMore.innerHTML = `<td colspan="5" style="text-align:center; padding:15px;"><button class="btn btn-secondary" onclick="window.historyResolvedLimit = (window.historyResolvedLimit || 50) + 50; renderHistoryViewData();">Carregar mais ${Math.min(50, filteredResolved.length - limitResolved)} (Restam ${filteredResolved.length - limitResolved})</button></td>`;
                tbodyResolved.appendChild(loadMore);
            }
        }
    }

    updateHistoryFilterLabels();
}

function renderReportsTable() {
    const tbody = document.getElementById('reportsTableBody');
    const searchTerm = document.getElementById('reportSearch')?.value.toLowerCase() || '';
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const checkboxes = document.querySelectorAll('.network-checkbox');
    const selectedNetworks = checkboxes.length > 0 ? Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value) : ['all'];
    const isAllSelected = document.getElementById('selectAllNetworks')?.checked ?? true;
    
    if (!tbody) return;

    if (visits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma visita registrada ainda.</td></tr>';
        return;
    }

    const filteredVisits = getFilteredReportVisits();

    if (filteredVisits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum resultado para os filtros aplicados.</td></tr>';
        return;
    }

    // Ordenar por data (mais recente primeiro)
    const sortedVisits = [...filteredVisits].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = '';
    const limit = window.reportsTableLimit || 50;
    
    sortedVisits.slice(0, limit).forEach(visit => {
        const store = stores.find(s => s.id === visit.storeId);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox" class="visit-checkbox" value="${visit.id}" onchange="updateBulkDeleteButton()"></td>
            <td>
                <div class="editable-date">
                    <span>${formatDate(visit.date)}</span>
                    <button class="btn-edit-small" onclick="editVisitDate(${visit.id})" title="Alterar Data">
                        <i class="fa-solid fa-calendar-day"></i>
                    </button>
                </div>
            </td>
            <td><strong style="cursor: pointer; color: var(--primary-blue);" onclick="showVisitDetails(${visit.id})" title="Ver detalhes da visita">${store ? store.name : 'Loja Removida'}${visit.isExtra ? ' <span class="badge-visit-extra">⭐ Visita Extra</span>' : ''}</strong></td>
            <td><span class="network-tag">${store ? store.network : '-'}</span></td>
            <td><span class="badge-rupture">${visit.ruptures.length} Itens</span></td>
            <td>
                <div class="history-photos">
                    ${(photoCache[visit.id] && photoCache[visit.id].length > 0) ? `<button class="btn btn-secondary btn-small" onclick="viewVisitPhotos('${visit.id}')" style="display:flex; align-items:center; gap:5px;"><i class="fa-solid fa-camera"></i> ${photoCache[visit.id].length} Fotos</button>` : '<span style="color:#ccc; font-size: 0.7rem;">Sem fotos</span>'}
                </div>
            </td>
            <td>${(visit.extraPoints || []).map(ep => `<span class="badge-extra-point">${ep}</span>`).join('') || '-'}</td>
            <td class="notes-cell" title="${visit.notes || ''}">${window.fixEncoding(visit.notes) || '-'}</td>
            <td>
                <div style="display: flex; gap: 8px; flex-wrap: nowrap; align-items: center;">
                    <button class="btn-icon text-blue" onclick="openEditVisit(${visit.id})" title="Editar Visita">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon text-red" onclick="deleteVisit(${visit.id})" title="Excluir Visita">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (sortedVisits.length > limit) {
        const loadMore = document.createElement('tr');
        loadMore.innerHTML = `<td colspan="9" style="text-align:center; padding:15px;"><button class="btn btn-secondary" onclick="window.reportsTableLimit = (window.reportsTableLimit || 50) + 50; renderReportsTable();">Carregar mais ${Math.min(50, sortedVisits.length - limit)} (Restam ${sortedVisits.length - limit})</button></td>`;
        tbody.appendChild(loadMore);
    }
}

window.toggleSelectAll = function(masterCb) {
    const checkboxes = document.querySelectorAll('.visit-checkbox');
    checkboxes.forEach(cb => cb.checked = masterCb.checked);
    updateBulkDeleteButton();
};

window.updateBulkDeleteButton = function() {
    const checkedCount = document.querySelectorAll('.visit-checkbox:checked').length;
    const btn = document.getElementById('bulkDeleteBtn');
    if (btn) {
        btn.style.display = checkedCount > 0 ? 'inline-flex' : 'none';
        btn.innerHTML = `<i class="fa-solid fa-trash"></i> Excluir (${checkedCount})`;
    }
};

window.deleteSelectedVisits = function() {
    const selectedIds = Array.from(document.querySelectorAll('.visit-checkbox:checked'))
                            .map(cb => cb.value);
    
    if (confirm(`Deseja realmente excluir as ${selectedIds.length} visitas selecionadas?`)) {
        // Captura lojas afetadas antes de remover as visitas
        const affectedStoreIds = new Set(visits.filter(v => selectedIds.includes(v.id)).map(v => v.storeId));

        // Remove visitas
        visits = visits.filter(v => !selectedIds.includes(v.id));

        // Persistência e sincronização
        saveAppStateLocally();
        if (typeof Storage !== 'undefined' && Storage.isServer) syncAppStateServer();

        // Recalcula status das lojas afetadas e atualiza views
        affectedStoreIds.forEach(id => recomputeStoreStatus(id));
        checkOverdueStores();
        renderPage('reports');
        updateStats();
        alert("Visitas selecionadas foram removidas.");
    }
};

window.deleteVisit = async function(id) {
    if (confirm("Deseja realmente excluir esta visita e todas as suas fotos permanentemente?")) {
        // Identifica loja afetada antes de remover
        const visitObj = visits.find(v => v.id === id);
        const storeId = visitObj ? visitObj.storeId : null;

        // Remove a visita do histórico
        visits = visits.filter(v => v.id !== id);
        saveAppStateLocally();

        // Se tiver Storage server
        if (typeof Storage !== 'undefined' && Storage.isServer) {
            await Storage.deleteVisitPhotos(id);
            await syncAppStateServer();
        }

        // Recalcula status da loja afetada
        if (storeId) {
            recomputeStoreStatus(storeId);
            checkOverdueStores();
        }

        renderPage('reports'); // Recarregar a view
        updateStats(); // Atualizar contadores
        alert("Visita removida com sucesso.");
    }
};

// Recalcula o lastVisit e o status de uma loja com base no histórico de visits
function recomputeStoreStatus(storeId) {
    const storeIdx = stores.findIndex(s => s.id === storeId);
    if (storeIdx === -1) return;

    // Encontra as visitas restantes dessa loja (mais recente primeiro)
    const storeVisits = visits
        .filter(v => v.storeId === storeId)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (storeVisits.length === 0) {
        stores[storeIdx].lastVisit = null;
        stores[storeIdx].status = null;
        stores[storeIdx].currentStatus = 'pending';
    } else {
        stores[storeIdx].lastVisit = storeVisits[0].date;
        stores[storeIdx].status = 'visited';
        // currentStatus será recalculado por checkOverdueStores()
    }
}

window.editVisitDate = function(id) {
    const visit = visits.find(v => v.id === id);
    if (!visit) return;

    const newDate = prompt("Digite a nova data (AAAA-MM-DD):", visit.date);
    if (newDate && newDate !== visit.date) {
        // Validação simples de formato AAAA-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
            visit.date = newDate;
            recomputeStoreStatus(visit.storeId);
            saveAppStateLocally();
            if (typeof Storage !== 'undefined' && Storage.isServer) syncAppStateServer();
            renderPage('reports');
            updateStats();
            alert("Data atualizada!");
        } else {
            alert("Formato de data inválido. Use AAAA-MM-DD.");
        }
    }
};

window.viewPhoto = function(src) {
    const win = window.open();
    win.document.write(`<img src="${src}" style="max-width:100%; height:auto; display:block; margin:auto; border-radius:10px; margin-top:20px;">`);
};

window.viewVisitPhotos = function(visitId) {
    const photos = photoCache[visitId];
    if (!photos || photos.length === 0) return;
    const win = window.open();
    win.document.write(`
        <html style="background:#f4f7f6; font-family:sans-serif;">
        <head><title>Fotos da Visita</title></head>
        <body style="padding: 20px; text-align: center;">
            <h2 style="color:#203a4c; margin-bottom:20px;">Fotos da Visita</h2>
            ${photos.map(p => `<img src="${p}" style="max-width:100%; height:auto; display:block; margin:auto; margin-bottom:20px; border-radius:10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border:1px solid #ddd;">`).join('')}
        </body>
        </html>
    `);
};

function calculateRuptureRate() {
    const fStores = typeof getGlobalFilteredStores === 'function' ? getGlobalFilteredStores() : stores;
    
    // Calcula o total de produtos esperados nas lojas filtradas
    const totalPossible = fStores.reduce((acc, s) => acc + (s.productIds && s.productIds.length > 0 ? s.productIds.length : products.length), 0);
    if (totalPossible === 0) return "0.0";

    // Pega as rupturas ativas das lojas filtradas
    const activeRups = validatedRuptures.filter(r => fStores.some(s => s.id === r.storeId)).length;
    
    return ((activeRups / totalPossible) * 100).toFixed(1);
}

function updateStats() {
    const totalStoresEl = document.getElementById('totalStores');
    const totalVisitsEl = document.getElementById('totalVisits');
    const ruptureRateEl = document.getElementById('ruptureRate');

    const fStores = typeof getGlobalFilteredStores === 'function' ? getGlobalFilteredStores() : stores;
    const fVisits = typeof getGlobalFilteredVisits === 'function' ? getGlobalFilteredVisits() : visits;

    if (totalStoresEl) totalStoresEl.textContent = fStores.length;
    
    if (totalVisitsEl) {
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const visitsThisMonth = fVisits.filter(v => {
            const vDate = new Date(v.date + 'T12:00:00');
            return vDate.getMonth() === currentMonth && vDate.getFullYear() === currentYear;
        });
        totalVisitsEl.textContent = visitsThisMonth.length;
    }
    
    if (ruptureRateEl) ruptureRateEl.textContent = calculateRuptureRate() + '%';
    
    // Atualizar alertas de produtos se estiver na dashboard
    const alertsContainer = document.getElementById('dashboardProductAlerts');
    if (alertsContainer) {
        renderValidatedRuptures();
    }
}

window.getResolvedItemStatus = function(productId, storeId, visitId) {
    // 1. Tenta achar resoluo exata (mesma visita e produto) no histrico
    if (visitId) {
        const exactMatch = resolvedRupturesHistory.find(r => 
            String(r.productId) === String(productId) && 
            String(r.storeId) === String(storeId) &&
            String(r.visitId) === String(visitId)
        );
        if (exactMatch) return { isResolved: true, resolvedAt: exactMatch.resolvedAt };
    }
    
    // 2. Verifica se existe ruptura ativa no momento
    const isActive = validatedRuptures.some(r => 
        String(r.productId) === String(productId) && String(r.storeId) === String(storeId)
    );
    
    // 3. Se no est ativa e foi citada numa visita, consideramos resolvida
    if (!isActive) {
        const latestResolve = resolvedRupturesHistory.find(r => 
            String(r.productId) === String(productId) && String(r.storeId) === String(storeId)
        );
        return { isResolved: true, resolvedAt: latestResolve ? latestResolve.resolvedAt : null };
    }
    
    return { isResolved: false, resolvedAt: null };
};

window.exportVisitsCSV = function() {
    const searchTerm = document.getElementById('reportSearch')?.value.toLowerCase() || '';
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const checkboxes = document.querySelectorAll('.network-checkbox');
    const selectedNetworks = checkboxes.length > 0 ? Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value) : ['all'];
    const isAllSelected = document.getElementById('selectAllNetworks')?.checked ?? true;

    const filtered = visits.filter(v => {
        const store = stores.find(s => s.id === v.storeId);
        if (!store) return false;
        const matchesNetwork = isAllSelected || selectedNetworks.includes(store.network);
        const matchesSearch = (store.name || '').toLowerCase().includes(searchTerm) || 
                             (v.notes && v.notes.toLowerCase().includes(searchTerm));
        const matchesDate = (!startDate || v.date >= startDate) && (!endDate || v.date <= endDate);
        const matchesRupture = !reportFilterOnlyRuptures || (v.ruptures && v.ruptures.length > 0);
        return matchesNetwork && matchesSearch && matchesDate && matchesRupture;
    });

    if (filtered.length === 0) {
        alert('Não hï¿½ dados filtrados para exportar.');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,Data;Loja;Rede;Qtd Rupturas;Itens em Ruptura;Pontos Extras;Observações\n";
    
    filtered.forEach(v => {
        const store = stores.find(s => s.id === v.storeId);
        const ruptureNames = v.ruptures.map(id => {
            const p = products.find(prod => prod.id === id);
            return p ? p.name : id;
        }).join(" | ");
        const extraPointsNames = (v.extraPoints || []).join(" | ");
        
        const row = [
            formatDate(v.date),
            store ? store.name : 'N/A',
            store ? store.network : 'N/A',
            v.ruptures.length,
            ruptureNames,
            extraPointsNames,
            v.notes || ''
        ].join(";");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_visitas_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

function getReportFilterSettings() {
    const searchTerm = document.getElementById('reportSearch')?.value.toLowerCase() || '';
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const checkboxes = document.querySelectorAll('.network-checkbox');
    const selectedNetworks = checkboxes.length > 0 ? Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value) : ['all'];
    const isAllSelected = document.getElementById('selectAllNetworks')?.checked ?? true;

    return { searchTerm, startDate, endDate, selectedNetworks, isAllSelected };
}

function getFilteredReportVisits() {
    const { searchTerm, startDate, endDate, selectedNetworks, isAllSelected } = getReportFilterSettings();

    return visits.filter(v => {
        const store = stores.find(s => s.id === v.storeId);
        if (!store) return false;

        const matchesNetwork = isAllSelected || selectedNetworks.includes(store.network);
        const matchesSearch = (store.name || '').toLowerCase().includes(searchTerm) ||
                             (v.notes && v.notes.toLowerCase().includes(searchTerm));
        const matchesDate = (!startDate || v.date >= startDate) && (!endDate || v.date <= endDate);
        const matchesRupture = !reportFilterOnlyRuptures || (v.ruptures && v.ruptures.length > 0);
        const matchesObservation = !reportFilterOnlyObservation || (v.notes && v.notes.trim().length > 0);
        const matchesExtraPoints = !reportFilterOnlyExtraPoints || (v.extraPoints && v.extraPoints.length > 0);
        const matchesExtraVisits = !reportFilterOnlyExtraVisits || !!v.isExtra;

            return matchesNetwork && matchesSearch && matchesDate && matchesRupture && matchesObservation && matchesExtraPoints && matchesExtraVisits;
    });
}

function buildReportInsightsHTML(filteredVisits) {
    const storeMap = new Map();
    const networkCounts = {};
    let totalRuptureItems = 0;
    const productRuptureCounts = {};

    filteredVisits.forEach(v => {
        const store = stores.find(s => s.id === v.storeId);
        if (!store) return;
        
        const rupCount = (v.ruptures || []).length;
        totalRuptureItems += rupCount;

        (v.ruptures || []).forEach(pId => {
            productRuptureCounts[pId] = (productRuptureCounts[pId] || 0) + 1;
        });

        const networkName = store.network || 'Não informada';
        networkCounts[networkName] = (networkCounts[networkName] || 0) + 1;

        if (!storeMap.has(store.id)) {
            storeMap.set(store.id, []);
        }
        storeMap.get(store.id).push(v);
    });

    const totalPossibleRuptures = filteredVisits.length * products.length;
    const generalRuptureRate = totalPossibleRuptures > 0 
        ? ((totalRuptureItems / totalPossibleRuptures) * 100).toFixed(1) 
        : "0.0";

    const topProducts = Object.entries(productRuptureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([pId, count]) => {
            const p = products.find(prod => String(prod.id) === String(pId));
            return { name: p ? p.name : `Prod #${pId}`, count };
        });

    const storeSummaries = [];
    storeMap.forEach((storeVisits, storeId) => {
        const store = stores.find(s => s.id === storeId);
        const visitsSorted = [...storeVisits].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstCount = (visitsSorted[0].ruptures || []).length;
        const lastCount = (visitsSorted[visitsSorted.length - 1].ruptures || []).length;
        const delta = firstCount - lastCount;
        const percent = firstCount === 0
            ? (lastCount === 0 ? 0 : -100)
            : Math.round((delta / Math.max(firstCount, 1)) * 100);

        storeSummaries.push({
            store,
            firstCount,
            lastCount,
            delta,
            percent,
            visits: visitsSorted.length
        });
    });

    const improvedStores = storeSummaries.filter(s => s.delta > 0).sort((a, b) => b.delta - a.delta);
    const worsenedStores = storeSummaries.filter(s => s.delta < 0).sort((a, b) => a.delta - b.delta);
    const mostVisitedStore = [...storeSummaries].sort((a, b) => b.visits - a.visits)[0] || null;
    const topNetwork = Object.entries(networkCounts).sort((a, b) => b[1] - a[1])[0] || ['Nenhum', 0];

    const improvedText = improvedStores.length > 0
        ? `${improvedStores.length} ${improvedStores.length === 1 ? 'loja' : 'lojas'} reduziram rupturas.`
        : 'Nenhuma loja apresentou redução de rupturas neste período.';
    const worsenedText = worsenedStores.length > 0
        ? `${worsenedStores.length} ${worsenedStores.length === 1 ? 'loja' : 'lojas'} tiveram acréscimo de rupturas.`
        : 'Nenhuma loja apresentou aumento de rupturas neste período.';

    const highlightImprov = improvedStores[0];
    const highlightWorse = worsenedStores[0];

    const sentences = [];
    sentences.push(`Total de visitas no relatório: <strong>${filteredVisits.length}</strong>.`);
    sentences.push(`Lojas diferentes no recorte: <strong>${storeMap.size}</strong>.`);
    sentences.push(`Rede mais registrada: <strong>${topNetwork[0]}</strong> (${topNetwork[1]} visitas).`);
    sentences.push(`Taxa Geral de Ruptura: <strong style="color: #E53935;">${generalRuptureRate}%</strong> (Média de ${(totalRuptureItems / Math.max(1, filteredVisits.length)).toFixed(1)} Itens/visita).`);
    sentences.push(improvedText);
    sentences.push(worsenedText);

    let details = '';
    
    if (topProducts.length > 0) {
        const topList = topProducts.map(p => `${p.name} (${p.count}x)`).join(', ');
        details += `<li><strong>Top 5 Produtos Críticos:</strong> ${topList}</li>`;
    }

    if (highlightImprov) {
        details += `<li><strong>${highlightImprov.store.name}</strong> apresentou a maior melhora: de ${highlightImprov.firstCount} para ${highlightImprov.lastCount} Itens (${highlightImprov.percent}% de melhoria).</li>`;
    }
    if (highlightWorse) {
        details += `<li><strong>${highlightWorse.store.name}</strong> teve a maior piora: de ${highlightWorse.firstCount} para ${highlightWorse.lastCount} Itens.</li>`;
    }
    if (mostVisitedStore) {
        details += `<li><strong>${mostVisitedStore.store.name}</strong> foi a loja com mais visitas no período (${mostVisitedStore.visits}).</li>`;
    }

    return `
        <div style="background: #f4f8ff; border: 1px solid #d8e7ff; border-radius: 16px; padding: 18px 20px; margin-bottom: 24px; font-family: 'Outfit', sans-serif; color: #24305e; page-break-inside: avoid; break-inside: avoid;">
            <h2 style="margin: 0 0 12px; font-size: 18px; color: #0d3b7f;">Principais Insights</h2>
            <div style="display: grid; gap: 10px;">
                ${sentences.map(text => `<p style="margin: 0; line-height: 1.6; font-size: 13px;">${text}</p>`).join('')}
            </div>
            ${details ? `<ul style="margin: 12px 0 0 18px; padding: 0; list-style-type: disc; color: #2d3f69; font-size: 13px;">${details}</ul>` : ''}
        </div>
    `;
}

function buildReportTableHTML(filteredVisits) {
    const rows = filteredVisits.map(v => {
        const store = stores.find(s => s.id === v.storeId) || { name: 'Loja Removida', network: 'N/A' };
        const ruptureCount = (v.ruptures || []).length;
        const notesText = v.notes ? v.notes.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '-';
        const extraPts = (v.extraPoints || []).map(ep => `<span style="display:inline-block; padding: 2px 6px; border-radius: 5px; background:#f3e5f5; color:#8e44ad; font-weight:600; font-size:10px; margin-right:3px;">${ep}</span>`).join('') || '-';

        return `
            <tr style="border-bottom: 1px solid #ececec; page-break-inside: avoid; break-inside: avoid;">
                <td style="padding: 10px; font-weight: 600; color: #2b3a55;">${formatDate(v.date)}</td>
                <td style="padding: 10px; color: #2b3a55;">${store.name}</td>
                <td style="padding: 10px; color: #0c5db8; font-weight: 700;">${store.network}</td>
                <td style="padding: 10px; color: #333;">${ruptureCount}</td>
                <td style="padding: 10px; white-space: normal; word-break: break-word;">${extraPts}</td>
                <td style="padding: 10px; color: #555;">${notesText}</td>
            </tr>
        `;
    }).join('');

    return `
        <div style="background: white; padding: 16px 18px; border-radius: 18px; border: 1px solid #e8edff; margin-bottom: 24px; font-family: 'Outfit', sans-serif; page-break-inside: avoid; break-inside: avoid;">
            <h2 style="margin: 0 0 12px; color: #0d3b7f; font-size: 16px;">Visitas Incluídas no Relatório</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background: #f3f6ff; color: #2b3a55; text-align: left;">
                        <th style="padding: 12px; border-bottom: 1px solid #dfe7f5;">Data</th>
                        <th style="padding: 12px; border-bottom: 1px solid #dfe7f5;">Loja</th>
                        <th style="padding: 12px; border-bottom: 1px solid #dfe7f5;">Rede</th>
                        <th style="padding: 12px; border-bottom: 1px solid #dfe7f5;">Rupturas</th>
                        <th style="padding: 12px; border-bottom: 1px solid #dfe7f5;">Pontos Extras</th>
                        <th style="padding: 12px; border-bottom: 1px solid #dfe7f5;">Observações</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function generateChartImage(config, width = 500, height = 300) {
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.position = 'absolute';
        canvas.style.left = '-9999px';
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);

        if (!config.options) config.options = {};
        if (!config.options.animation) config.options.animation = false;
        config.options.responsive = false;

        new Chart(ctx, config);

        setTimeout(() => {
            const dataUrl = canvas.toDataURL('image/png');
            document.body.removeChild(canvas);
            resolve(dataUrl);
        }, 150);
    });
}

function exportHtmlToPdf(container, options) {
    if (!container || !container.innerHTML.trim()) {
        alert('Não há conteúdo para exportar em PDF.');
        return;
    }

    if (typeof window.html2pdf !== 'function') {
        alert('A biblioteca de PDF não está disponível no momento.');
        return;
    }

    const source = container;
    const clone = source.cloneNode(true);
    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.width = '1000px';
    clone.style.maxWidth = '1000px';
    clone.style.margin = '0 auto';
    clone.style.padding = '16px';
    clone.style.background = 'white';
    clone.style.boxSizing = 'border-box';
    clone.style.display = 'block';
    clone.style.zIndex = '1';
    clone.style.overflow = 'visible';
    clone.style.fontFamily = 'Outfit, Arial, sans-serif';

    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-9999px';
    wrapper.style.top = '0';
    wrapper.style.width = '1000px';
    wrapper.style.maxWidth = '1000px';
    wrapper.style.background = 'white';
    wrapper.style.zIndex = '-1';
    wrapper.style.overflow = 'visible';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    const cleanup = () => {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    };

    const renderPdf = () => {
        const safeOptions = {
            ...options,
            html2canvas: {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                letterRendering: true,
                scrollX: 0,
                scrollY: 0,
                ...(options?.html2canvas || {})
            },
            pagebreak: {
                mode: ['avoid', 'css', 'legacy'],
                ...(options?.pagebreak || {})
            }
        };

        window.html2pdf()
            .set(safeOptions)
            .from(clone)
            .save()
            .then(() => cleanup())
            .catch(err => {
                console.error('Erro ao gerar PDF:', err);
                cleanup();
                alert('Não foi possível gerar o PDF. Verifique o conteúdo e tente novamente.');
            });
    };

    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        document.fonts.ready.then(renderPdf).catch(renderPdf);
    } else {
        requestAnimationFrame(() => setTimeout(renderPdf, 250));
    }
}

window.exportHistoryCSV = function() {
    const { filteredVisits, filteredResolved } = getFilteredHistoryData();

    if (filteredVisits.length === 0 && filteredResolved.length === 0) {
        alert('Não há dados para exportar no histórico com os filtros atuais.');
        return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,Tipo;Data;Loja;Rede;Produto;Produtos Pendentes;Status;Visita;Pontos Extras;Observações\n';
    filteredVisits.forEach(v => {
        const store = stores.find(s => s.id === v.storeId);
        const ruptureNames = (v.ruptures || []).map(r => {
            const p = products.find(prod => prod.id === r);
            return p ? p.name : String(r);
        }).join(' | ');
        const pendingRuptureNames = (v.ruptures || []).filter(r => {
            const status = getResolvedItemStatus(r, v.storeId, v.id);
            return !status.isResolved;
        }).map(r => {
            const p = products.find(prod => prod.id === r);
            return p ? p.name : String(r);
        }).join(' | ');
        const extraPointsNames = (v.extraPoints || []).join(" | ");
        const summary = getVisitResolutionSummary(v);
        csvContent += [
            'Visita',
            formatDate(v.date),
            store ? store.name : 'N/A',
            store ? store.network : 'N/A',
            ruptureNames,
            pendingRuptureNames,
            summary.label,
            summary.totalItems === 0 ? 'Sem rupturas' : `${summary.resolvedCount}/${summary.totalItems}`,
            extraPointsNames,
            v.notes || ''
        ].join(';') + '\n';
    });

    filteredResolved.forEach(item => {
        csvContent += [
            'Resolvido',
            item.resolvedAt ? formatDate(item.resolvedAt) : '-',
            item.storeName || 'N/A',
            '-',
            item.productName || 'N/A',
            '-',
            'Resolvido',
            item.visitDate ? formatDate(item.visitDate) : '-',
            ''
        ].join(';') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `historico_hiperroll_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.exportHistoryPDF = async function() {
    const { filteredVisits, filteredResolved } = getFilteredHistoryData();

    if (filteredVisits.length === 0 && filteredResolved.length === 0) {
        alert('Não há dados para exportar no histórico com os filtros atuais.');
        return;
    }

    const opt = {
        margin: [6, 6],
        filename: `Historico_Hiperroll_${new Date().toLocaleDateString()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid', 'css', 'legacy'] }
    };

    const visitsRows = filteredVisits.map(v => {
        const store = stores.find(s => s.id === v.storeId) || { name: 'N/A', network: 'N/A' };
        const summary = getVisitResolutionSummary(v);
        const badgeColor = summary.tone === 'ok' ? '#e8f5e9' : '#fff4e5';
        const badgeText = summary.tone === 'ok' ? '#2e7d32' : '#c2410c';
        const extraPts = (v.extraPoints || []).map(ep => `<span style="display:inline-block; padding: 2px 5px; border-radius: 5px; background:#f3e5f5; color:#8e44ad; font-weight:600; font-size:9px; margin-right:2px;">${ep}</span>`).join('') || '-';
        return `
            <tr>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${formatDate(v.date)}</td>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${store.name}</td>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${store.network}</td>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${(v.ruptures || []).length}</td>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;"><span style="display:inline-block; padding: 3px 7px; border-radius: 999px; background:${badgeColor}; color:${badgeText}; font-weight:700;">${summary.label}</span></td>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${extraPts}</td>
                <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${(v.notes || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
            </tr>`;
    }).join('');

    const resolvedRows = filteredResolved.map(item => `
        <tr>
            <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${item.productName || 'Produto'}</td>
            <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${item.storeName || 'Loja'}</td>
            <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${item.visitDate ? formatDate(item.visitDate) : '-'}</td>
            <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">${item.resolvedAt ? formatDate(item.resolvedAt) : '-'}</td>
            <td style="padding: 6px 7px; border-bottom: 1px solid #eee; white-space: normal; word-break: break-word;">Resolvido</td>
        </tr>`).join('');

    const container = document.createElement('div');
    container.innerHTML = `
        <div style="width: 100%; max-width: 1000px; margin: 0 auto; box-sizing: border-box; font-family: 'Outfit', sans-serif; color: #24305e; overflow: visible;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                <div style="flex: 1; min-width: 0;">
                    <h1 style="color: #0047AB; margin: 0 0 4px; font-size: 20px;">Histórico Hiperroll</h1>
                    <p style="margin: 0; color: #666; font-size: 11px;">Gerado em ${new Date().toLocaleString()}</p>
                </div>
                <div style="text-align: right; min-width: 220px; max-width: 260px; color: #0047AB; font-weight: 700; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">
                    <div style="font-size: 13px;">Nicole Portela</div>
                    <div style="font-size: 10px; color: #666; font-weight: 600; margin-top: 4px;">Trade Marketing</div>
                </div>
            </div>
            <div style="margin-bottom: 18px; page-break-inside: avoid; break-inside: avoid;">
                <h3 style="margin: 0 0 8px; font-size: 13px;">Rupturas não resolvidas</h3>
                <table style="width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 10px; margin-bottom: 0;">
                    <thead><tr style="background: #f3f6ff;"><th style="padding: 6px 7px; text-align: left; width: 11%;">Data</th><th style="padding: 6px 7px; text-align: left; width: 18%;">Loja</th><th style="padding: 6px 7px; text-align: left; width: 10%;">Rede</th><th style="padding: 6px 7px; text-align: left; width: 8%;">Rupturas</th><th style="padding: 6px 7px; text-align: left; width: 15%;">Status</th><th style="padding: 6px 7px; text-align: left; width: 16%;">Pontos Extras</th><th style="padding: 6px 7px; text-align: left; width: 22%;">Observações</th></tr></thead>
                    <tbody>${visitsRows || '<tr><td colspan="7" style="padding: 8px;">Nenhuma visita no filtro</td></tr>'}</tbody>
                </table>
            </div>
            <div style="page-break-inside: avoid; break-inside: avoid; margin-top: 12px;">
                <h3 style="margin: 0 0 8px; font-size: 13px;">Rupturas resolvidas</h3>
                <table style="width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 10px;">
                    <thead><tr style="background: #f3f6ff;"><th style="padding: 6px 7px; text-align: left; width: 22%;">Produto</th><th style="padding: 6px 7px; text-align: left; width: 22%;">Loja</th><th style="padding: 6px 7px; text-align: left; width: 18%;">Visita</th><th style="padding: 6px 7px; text-align: left; width: 18%;">Resolvido em</th><th style="padding: 6px 7px; text-align: left; width: 20%;">Status</th></tr></thead>
                    <tbody>${resolvedRows || '<tr><td colspan="5" style="padding: 8px;">Nenhuma ruptura resolvida no filtro</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;

    exportHtmlToPdf(container, opt);
};

window.exportVisitsPDF = async function() {
    const element = document.querySelector('.reports-container');
    const filteredVisits = getFilteredReportVisits();
    const { selectedNetworks, isAllSelected, startDate, endDate } = getReportFilterSettings();

    if (filteredVisits.length === 0) {
        alert('Não há dados para exportar. Ajuste os filtros ou registre visitas antes.');
        return;
    }

    const filenameNetwork = !isAllSelected ? selectedNetworks.join('_').substring(0, 40).replace(/\s+/g, '_') : 'Geral';
    const opt = {
        margin:       [10, 10],
        filename:     `Relatorio_Trade_Hiperroll_${filenameNetwork}_${new Date().toLocaleDateString()}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    // Calculate Top 5 Products for the Bar Chart
    // Calculate Top 5 Products for the Bar Chart
    const productRuptureData = {};
    filteredVisits.forEach(v => {
        const store = stores.find(s => s.id === v.storeId);
        const net = store && store.network ? store.network : 'Outros';
        (v.ruptures || []).forEach(pId => {
            if (!productRuptureData[pId]) {
                productRuptureData[pId] = { count: 0, networks: {} };
            }
            productRuptureData[pId].count += 1;
            productRuptureData[pId].networks[net] = (productRuptureData[pId].networks[net] || 0) + 1;
        });
    });

    const topProductsList = Object.entries(productRuptureData)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([pId, data]) => {
            const p = products.find(prod => String(prod.id) === String(pId));
            return { 
                name: p ? p.name : `Produto ${pId}`, 
                count: data.count, 
                networks: data.networks 
            };
        });

    const formatProductNetStr = (netObj) => {
        return Object.entries(netObj)
            .sort((a, b) => b[1] - a[1])
            .map(([n, c]) => `${n} (${c}x)`)
            .join(', ');
    };

    let barLegendHtml = '';
    if (topProductsList.length > 0) {
        barLegendHtml += `<div style="text-align: left; font-size: 10px; margin-top: 12px; background: #f9f9f9; padding: 10px 14px; border-radius: 8px; width: 85%; border: 1px solid #eee; font-family: 'Outfit', sans-serif;">`;
        barLegendHtml += `<strong style="color: #0047AB; display: block; margin-bottom: 6px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px;">Detalhamento das Faltas (Por Rede)</strong>`;
        topProductsList.forEach(p => {
            barLegendHtml += `<p style="margin: 0 0 3px; color: #555;"><strong style="color: #333;">${p.name}:</strong> ${formatProductNetStr(p.networks)}</p>`;
        });
        barLegendHtml += `</div>`;
    }

    const barChartConfig = {
        type: 'bar',
        data: {
            labels: topProductsList.map(p => p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name),
            datasets: [{
                label: 'Faltas Registradas',
                data: topProductsList.map(p => p.count),
                backgroundColor: '#0047AB',
                borderRadius: 4
            }]
        },
        options: {
            plugins: { title: { display: true, text: 'Top 5 Produtos em Ruptura', font: { size: 14 } } },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    ticks: { stepSize: 1 },
                    title: { display: true, text: 'Lojas Afetadas (Qtd)', font: { size: 11, weight: 'bold' } }
                } 
            }
        }
    };

    // Calculate visits with/without ruptures for Donut Chart
    const visitsWithRupture = filteredVisits.filter(v => v.ruptures && v.ruptures.length > 0).length;
    const visitsWithout = filteredVisits.length - visitsWithRupture;

    // Calculate network breakdowns for the HTML legend
    const okNetworks = {};
    const rupNetworks = {};
    filteredVisits.forEach(v => {
        const store = stores.find(s => s.id === v.storeId);
        const net = store && store.network ? store.network : 'Outros';
        if (v.ruptures && v.ruptures.length > 0) {
            rupNetworks[net] = (rupNetworks[net] || 0) + 1;
        } else {
            okNetworks[net] = (okNetworks[net] || 0) + 1;
        }
    });

    const formatNetStr = (netObj, totalCat) => {
        return Object.entries(netObj)
            .sort((a, b) => b[1] - a[1])
            .map(([n, c]) => `<strong>${n}</strong> (${Math.round((c/totalCat)*100)}%)`)
            .join(', ');
    };

    const strOk = visitsWithout > 0 ? formatNetStr(okNetworks, visitsWithout) : 'N/A';
    const strRup = visitsWithRupture > 0 ? formatNetStr(rupNetworks, visitsWithRupture) : 'N/A';

    const donutChartConfig = {
        type: 'doughnut',
        data: {
            labels: ['Com Ruptura', 'Sem Ruptura'],
            datasets: [{
                data: [visitsWithRupture, visitsWithout],
                backgroundColor: ['#E53935', '#27ae60']
            }]
        },
        plugins: [{
            id: 'textInside',
            afterDraw: function(chart) {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, i) => {
                    chart.getDatasetMeta(i).data.forEach((element, index) => {
                        const data = dataset.data[index];
                        if (data > 0) {
                            const total = dataset.data.reduce((a, b) => a + b, 0);
                            const percent = Math.round((data / total) * 100) + '%';
                            ctx.fillStyle = 'white';
                            ctx.font = 'bold 16px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            const position = element.tooltipPosition();
                            ctx.fillText(percent, position.x, position.y);
                        }
                    });
                });
            }
        }],
        options: {
            plugins: { 
                title: { display: true, text: 'Status das Visitas', font: { size: 14 } },
                legend: { position: 'bottom' }
            }
        }
    };

    // Generate Chart Images
    const barChartUrl = await generateChartImage(barChartConfig, 500, 250);
    const donutChartUrl = await generateChartImage(donutChartConfig, 350, 250);

    const header = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; font-family: 'Outfit', sans-serif; border-bottom: 2px solid #0047AB; padding-bottom: 14px; width: 100%; box-sizing: border-box;">
            <div style="text-align: left; flex: 1; padding-right: 20px;">
                <h1 style="color: #0047AB; margin: 0; font-size: 24px; font-weight: 700;">Hiperroll Embalagens</h1>
                <h3 style="color: #E53935; margin: 6px 0 0; font-size: 16px; font-weight: 600;">Relatório de Visitas Trade Marketing</h3>
                <p style="font-size: 10px; color: #666; margin: 6px 0 0; font-weight: 400;">Gerado em: ${new Date().toLocaleString()}</p>
                <p style="font-size: 11px; color: #333; margin: 4px 0 0; font-weight: 600; white-space: normal; overflow-wrap: anywhere;">Responsável: Nicole Portela - Trade Marketing</p>
            </div>
            <div style="text-align: center; min-width: 220px; max-width: 260px;">
                <div style="background: #0047AB; color: white; padding: 14px 20px; border-radius: 10px; font-weight: 700; font-size: 16px; letter-spacing: 0.5px; display: inline-block; margin-bottom: 8px;">
                    HIPERROLL
                </div>
                <p style="font-size: 11px; color: #0047AB; margin: 0; font-weight: 700; letter-spacing: 0.3px; white-space: normal; overflow-wrap: anywhere; line-height: 1.35;">INTELIGÊNCIA EM TRADE</p>
            </div>
        </div>
    `;

    const filtersSummary = `
        <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; font-family: 'Outfit', sans-serif;">
            <div style="background: white; padding: 12px 16px; border-radius: 12px; border: 1px solid #e1e9ff; min-width: 220px;">
                <strong style="display:block; margin-bottom: 4px; color: #0d3b7f; font-size: 12px;">Período</strong>
                <span style="font-size: 12px; color: #333;">${startDate || 'Início'} até ${endDate || 'Fim'}</span>
            </div>
            <div style="background: white; padding: 12px 16px; border-radius: 12px; border: 1px solid #e1e9ff; min-width: 220px;">
                <strong style="display:block; margin-bottom: 4px; color: #0d3b7f; font-size: 12px;">Rede</strong>
                <span style="font-size: 12px; color: #333;">${isAllSelected ? 'Todas as Redes' : selectedNetworks.join(', ')}</span>
            </div>
            <div style="background: white; padding: 12px 16px; border-radius: 12px; border: 1px solid #e1e9ff; min-width: 220px;">
                <strong style="display:block; margin-bottom: 4px; color: #0d3b7f; font-size: 12px;">Rupturas</strong>
                <span style="font-size: 12px; color: #333;">${reportFilterOnlyRuptures ? 'Somente visitas com ruptura' : 'Todas as visitas'}</span>
            </div>
        </div>
    `;

    const chartsSection = `
        <div style="display: flex; justify-content: space-around; align-items: flex-start; margin-bottom: 24px; background: white; padding: 16px; border-radius: 16px; border: 1px solid #e8edff; page-break-inside: avoid; break-inside: avoid;">
            <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center;">
                <img src="${donutChartUrl}" style="max-width: 100%; height: auto; max-height: 220px;" />
                <div style="text-align: left; font-size: 11px; margin-top: 12px; background: #f9f9f9; padding: 10px 14px; border-radius: 8px; width: 85%; border: 1px solid #eee; font-family: 'Outfit', sans-serif;">
                    <div style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0;">
                        <strong style="color: #27ae60; display: block; margin-bottom: 2px; white-space: nowrap;">Sem Ruptura (Composição por Rede)</strong>
                        <span style="color: #555;">${strOk}</span>
                    </div>
                    <div>
                        <strong style="color: #E53935; display: block; margin-bottom: 2px; white-space: nowrap;">Com Ruptura (Composição por Rede)</strong>
                        <span style="color: #555;">${strRup}</span>
                    </div>
                </div>
            </div>
            <div style="flex: 1.2; text-align: center; display: flex; flex-direction: column; align-items: center;">
                <img src="${barChartUrl}" style="max-width: 100%; height: auto; max-height: 220px;" />
                ${barLegendHtml}
            </div>
        </div>
    `;

    const insightsSection = buildReportInsightsHTML(filteredVisits);
    const tableSection = buildReportTableHTML(filteredVisits);
    
    const container = document.createElement('div');
    container.innerHTML = header + filtersSummary + chartsSection + insightsSection + tableSection;

    exportHtmlToPdf(container, opt);
};

function buildPendingStoresInsightsHTML(pendingStores) {
    const overdueCounts = pendingStores.filter(s => s.currentStatus === 'overdue').length;
    const pendingCounts = pendingStores.filter(s => s.currentStatus === 'pending' || s.status === 'pending').length;
    const networkMap = {};
    const neverVisited = pendingStores.filter(s => !s.lastVisit).length;
    
    pendingStores.forEach(s => {
        const net = s.network || 'Não informada';
        networkMap[net] = (networkMap[net] || 0) + 1;
    });
    
    const topNetwork = Object.entries(networkMap).sort((a, b) => b[1] - a[1])[0] || ['Nenhuma', 0];
    const overduePct = Math.round((overdueCounts / pendingStores.length) * 100);
    
    return `
        <div style="background: #fff3cd; border: 1px solid #ffeeba; border-radius: 16px; padding: 16px 18px; margin-bottom: 20px; font-family: 'Outfit', sans-serif;">
            <h2 style="margin: 0 0 12px; font-size: 16px; color: #8b6914;">Resumo Executivo</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px; color: #555; line-height: 1.6;">
                <div><strong>Lojas no relatório:</strong> ${pendingStores.length}</div>
                <div><strong>Em atraso:</strong> ${overdueCounts} (${overduePct}%)</div>
                <div><strong>Pendentes de visita:</strong> ${pendingCounts}</div>
                <div><strong>Nunca visitadas:</strong> ${neverVisited}</div>
                <div><strong>Rede mais afetada:</strong> ${topNetwork[0]} (${topNetwork[1]} lojas)</div>
                <div style="color: #d9534f; font-weight: 600;"><i class="fa-solid fa-exclamation-circle"></i> Prioridade: Agendar visitas</div>
            </div>
        </div>
    `;
}

window.exportDashboardPDF = function() {
    const fStores = typeof getGlobalFilteredStores === 'function' ? getGlobalFilteredStores() : stores;
    const pendingStores = fStores.filter(s => s.currentStatus === 'overdue' || s.currentStatus === 'pending' || s.status === 'pending');

    if (pendingStores.length === 0) {
        alert('Não há lojas pendentes ou em atraso para exportar.');
        return;
    }

    const opt = {
        margin:       [10, 10],
        filename:     `Relatorio_Lojas_Pendentes_${new Date().toLocaleDateString()}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    const header = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; font-family: 'Outfit', sans-serif; border-bottom: 2px solid #0047AB; padding-bottom: 15px; width: 100%; box-sizing: border-box;">
            <div style="text-align: left; flex: 1; padding-right: 20px;">
                <h1 style="color: #0047AB; margin: 0; font-size: 24px; font-weight: 700;">Hiperroll Embalagens</h1>
                <h3 style="color: #E53935; margin: 5px 0 0; font-size: 16px; font-weight: 600;">Relatório de Lojas Pendentes / Em Atraso</h3>
                <p style="font-size: 11px; color: #666; margin: 6px 0 0; font-weight: 400;">Gerado em: ${new Date().toLocaleString()}</p>
                <p style="font-size: 12px; color: #333; margin-top: 5px; font-weight: 600; white-space: normal; overflow-wrap: anywhere;">Responsável: Nicole Portela - Trade Marketing</p>
            </div>
            <div style="text-align: center; min-width: 220px; max-width: 260px;">
                <div style="background: #0047AB; color: white; padding: 14px 20px; border-radius: 10px; font-weight: 700; font-size: 18px; letter-spacing: 0.5px; display: inline-block; margin-bottom: 8px;">
                    HIPERROLL
                </div>
                <p style="font-size: 11px; color: #0047AB; margin: 0; font-weight: 700; letter-spacing: 0.3px; white-space: normal; overflow-wrap: anywhere; line-height: 1.35;">INTELIGÊNCIA EM TRADE</p>
            </div>
        </div>
    `;

    const insightsHtml = buildPendingStoresInsightsHTML(pendingStores);

    let tableHtml = `
        <table style="width: 100%; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 12px; text-align: left;">
            <thead>
                <tr style="background-color: #f5f5f5; border-bottom: 1px solid #ddd;">
                    <th style="padding: 10px;">Loja</th>
                    <th style="padding: 10px;">Rede</th>
                    <th style="padding: 10px;">Status</th>
                    <th style="padding: 10px;">Última Visita</th>
                </tr>
            </thead>
            <tbody>
    `;

    pendingStores.forEach(s => {
        let statusStr = "Pendente";
        let statusColor = "#FFC107";
        if (s.currentStatus === 'overdue') {
            statusStr = "Atrasado";
            statusColor = "#E53935";
        }

        let lastVisitStr = "Nunca visitada";
        if (s.lastVisit) {
            lastVisitStr = formatDate(s.lastVisit);
        }

        tableHtml += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; font-weight: 600; color: #333;">${s.name}</td>
                <td style="padding: 10px; font-weight: bold; color: var(--primary-blue);">${s.network}</td>
                <td style="padding: 10px; color: ${statusColor}; font-weight: bold;">${statusStr}</td>
                <td style="padding: 10px; color: #666;">${lastVisitStr}</td>
            </tr>
        `;
    });

    tableHtml += `
            </tbody>
        </table>
    `;

    const container = document.createElement('div');
    container.innerHTML = header + insightsHtml + tableHtml;

    exportHtmlToPdf(container, opt);
};

window.toggleRuptureFilter = function() {
    reportFilterOnlyRuptures = !reportFilterOnlyRuptures;
    const btn = document.getElementById('reportRuptureFilterBtn');
    if (btn) {
        if (reportFilterOnlyRuptures) {
            btn.style.background = 'var(--primary-red, #E53935)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--primary-red, #E53935)';
        } else {
            btn.style.background = 'white';
            btn.style.color = 'var(--text-dark)';
            btn.style.borderColor = '#eee';
        }
    }
    renderReportsTable();
};

window.toggleReportObservationFilter = function() {
    reportFilterOnlyObservation = !reportFilterOnlyObservation;
    const btn = document.getElementById('reportObservationFilterBtn');
    if (btn) {
        if (reportFilterOnlyObservation) {
            btn.style.background = 'var(--primary-red, #E53935)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--primary-red, #E53935)';
        } else {
            btn.style.background = 'white';
            btn.style.color = 'var(--text-dark)';
            btn.style.borderColor = '#eee';
        }
    }
    renderReportsTable();
};

window.toggleReportExtraVisitsFilter = function() {
    reportFilterOnlyExtraVisits = !reportFilterOnlyExtraVisits;
    const btn = document.getElementById('reportExtraVisitsFilterBtn');
    if (btn) {
        if (reportFilterOnlyExtraVisits) {
            btn.style.background = 'var(--primary-red, #E53935)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--primary-red, #E53935)';
        } else {
            btn.style.background = 'white';
            btn.style.color = 'var(--text-dark)';
            btn.style.borderColor = '#eee';
        }
    }
    renderReportsTable();
};

window.toggleReportExtraPointsFilter = function() {
    reportFilterOnlyExtraPoints = !reportFilterOnlyExtraPoints;
    const btn = document.getElementById('reportExtraPointsFilterBtn');
    if (btn) {
        if (reportFilterOnlyExtraPoints) {
            btn.style.background = 'var(--primary-red, #E53935)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--primary-red, #E53935)';
        } else {
            btn.style.background = 'white';
            btn.style.color = 'var(--text-dark)';
            btn.style.borderColor = '#eee';
        }
    }
    renderReportsTable();
};

function updateNotifications() {
    const badge = document.getElementById('notificationBadge');
    const list = document.getElementById('notificationList');
    if (!badge || !list) return;

    const notifications = [];

    // 1. Alertas de Atraso Crítico (+14 dias)
    stores.forEach(s => {
        if (s.lastVisit) {
            const last = new Date(s.lastVisit + 'T12:00:00');
            const diff = Math.floor((new Date() - last) / (1000 * 60 * 60 * 24));
            if (diff >= 14) {
                const notifId = `overdue-${s.id}-${s.lastVisit}`;
                if (!dismissedNotifications.includes(notifId)) {
                    notifications.push({
                        id: notifId,
                        type: 'danger',
                        icon: 'fa-calendar-xmark',
                        title: 'Atraso Crítico',
                        text: `${s.name} sem visita há ${diff} dias.`
                    });
                }
            }
        }
    });

    // 2. Rupturas não validadas (Alertas Recentes)
    visits.forEach(v => {
        if (v.ruptures && v.ruptures.length > 0) {
            v.ruptures.forEach(pId => {
                const store = stores.find(s => s.id === v.storeId);
                const prod = products.find(p => p.id === pId);
                const notifId = `rupture-${v.id}-${pId}`;
                
                // Só mostra se não foi validada e não foi "limpa/dismissed"
                const isValidated = validatedRuptures.some(r => r.productId === pId && r.storeId === v.storeId);
                if (!isValidated && !dismissedNotifications.includes(notifId)) {
                    notifications.push({
                        id: notifId,
                        type: 'warning',
                        icon: 'fa-triangle-exclamation',
                        title: 'Ruptura Detectada',
                        text: `${prod ? prod.name : 'Item'} em falta no ${store ? store.name : 'PDV'}.`
                    });
                }
            });
        }
    });

    // Atualizar Badge
    if (notifications.length > 0) {
        badge.textContent = notifications.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }

    // Renderizar Lista
    if (notifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">Nenhuma notificação nova</div>';
    } else {
        list.innerHTML = notifications.map(n => `
            <div class="notification-item">
                <i class="fa-solid ${n.icon} ${n.type === 'danger' ? 'noti-red' : 'noti-orange'}"></i>
                <div class="noti-content">
                    <strong>${n.title}</strong>
                    <p>${n.text}</p>
                </div>
            </div>
        `).join('');
    }
}

window.clearNotifications = function() {
    const badge = document.getElementById('notificationBadge');
    const list = document.getElementById('notificationList');
    
    const currentNotifs = [];
    stores.forEach(s => {
        if (s.lastVisit) {
            const last = new Date(s.lastVisit + 'T12:00:00');
            const diff = Math.floor((new Date() - last) / (1000 * 60 * 60 * 24));
            if (diff >= 14) currentNotifs.push(`overdue-${s.id}-${s.lastVisit}`);
        }
    });
    visits.forEach(v => {
        if (v.ruptures) {
            v.ruptures.forEach(pId => currentNotifs.push(`rupture-${v.id}-${pId}`));
        }
    });

    dismissedNotifications = [...new Set([...dismissedNotifications, ...currentNotifs])];
    saveAppStateLocally();
    if (typeof Storage !== 'undefined' && Storage.isServer) syncAppStateServer();

    updateNotifications();
};

// Update badge on init
setTimeout(updateNotifications, 1000);

function renderStatusBadge(store) {
    if (store.currentStatus === 'overdue') return '<span style="color: #e74c3c; font-size: 0.8rem;"><i class="fa-solid fa-triangle-exclamation"></i> Em Atraso</span>';
    if (store.currentStatus === 'visited' || store.status === 'visited') return '<span style="color: #27ae60; font-size: 0.8rem;"><i class="fa-solid fa-circle-check"></i> OK</span>';
    return '<span style="color: #f39c12; font-size: 0.8rem;"><i class="fa-solid fa-clock"></i> Pendente</span>';
}

function populateSelects() {
    storeSelect.innerHTML = '<option value="">Selecione uma loja...</option>';
    stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.id;
        option.textContent = store.name;
        storeSelect.appendChild(option);
    });
}

function renderChecklist(searchTerm = '', storeProductIds = null) {
    productListChecklist.innerHTML = '';
    
    let filteredProducts = products;
    
    // Filtro por termo de busca
    if (searchTerm) {
        filteredProducts = filteredProducts.filter(p => 
            (p.name || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
    
    // Filtro por Loja (Opï¿½ï¿½o 2: Apenas itens daquela loja específica)
    if (storeProductIds) {
        filteredProducts = filteredProducts.filter(p => 
            storeProductIds.includes(p.id)
        );
    }

    if (filteredProducts.length === 0) {
        productListChecklist.innerHTML = `<p style="padding: 10px; color: var(--text-muted);">
            ${storeProductIds ? 'Nenhum item cadastrado para esta loja específica.' : 'Selecione uma loja para ver os produtos.'}
        </p>`;
        return;
    }

    filteredProducts.forEach(product => {
        const item = document.createElement('div');
        item.className = 'checklist-item';
        item.innerHTML = `
            <input type="checkbox" id="prod-${product.id}" value="${product.id}" class="rupture-check">
            <label for="prod-${product.id}">${product.name}</label>
        `;
        productListChecklist.appendChild(item);
    });
}

async function handleVisitSubmit(e) {
    e.preventDefault();

    // Trava de segurança contra cliques duplos
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;

    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    const storeId = storeSelect.value;
    const notes     = document.getElementById('visitNotes').value;
    const checkedProducts = Array.from(document.querySelectorAll('.rupture-check:checked'))
                                 .map(cb => cb.value);
    const checkedExtraPoints = Array.from(document.querySelectorAll('.extra-point-check:checked'))
                                    .map(cb => cb.value);
    const visitDate = document.getElementById('visitDate').value;
    const isExtra = !!document.getElementById('visitIsExtra')?.checked;

    // ============================================================
    // MODO EDIï¿½AO: sobrepõe a visita existente, sem criar duplicata
    // ============================================================
    if (editingVisitId !== null) {
        const idx = visits.findIndex(v => v.id === editingVisitId);
        if (idx !== -1) {
            const oldVisit = visits[idx];
            const oldStoreId = oldVisit.storeId;

            // Atualiza os campos editáveis (mantém id e fotos originais)
            visits[idx] = {
                ...oldVisit,
                storeId,
                date: visitDate,
                ruptures: checkedProducts,
                extraPoints: checkedExtraPoints,
                isExtra,
                notes,
            };

            // ----------------------------------------------------------
            // Atualiza rupturas validadas:
            // Remove as antigas vinculadas a esta visita (pela loja antiga)
            // e garante que as novas existam.
            // ----------------------------------------------------------
            const oldRuptureIds = oldVisit.ruptures || [];
            const newRuptureIds = checkedProducts;

            // Remove rupturas que foram DESMARCADAS nesta ediï¿½ï¿½o
            oldRuptureIds.forEach(pId => {
                if (!newRuptureIds.includes(pId)) {
                    // Só remove se nenhuma OUTRA visita da mesma loja também reporta esta ruptura
                    const stillReported = visits.some(
                        (v, i) => i !== idx && v.storeId === storeId && v.ruptures && v.ruptures.includes(pId)
                    );
                    if (!stillReported) {
                        validatedRuptures = validatedRuptures.filter(
                            r => !(r.productId === pId && r.storeId === storeId)
                        );
                    }
                }
            });

            // Adiciona rupturas NOVAS que não existiam antes
            newRuptureIds.forEach(pId => {
                const exists = validatedRuptures.find(r => r.productId === pId && r.storeId === storeId);
                if (!exists) {
                    const product = products.find(p => p.id === pId);
                    const store   = stores.find(s => s.id === storeId);
                    const existingRupture = validatedRuptures.find(r => r.productId === pId && r.storeId === storeId);
                    if (existingRupture) {
                        existingRupture.visitId = editingVisitId;
                        existingRupture.visitDate = visitDate;
                        existingRupture.timestamp = new Date().getTime();
                    } else {
                        validatedRuptures.push({
                            id: Date.now() + Math.random(),
                            productId: pId,
                            productName: product ? product.name : 'Produto',
                            storeId,
                            storeName: store ? store.name : 'Loja',
                            visitId: editingVisitId,
                            visitDate,
                            timestamp: new Date().getTime()
                        });
                    }
                }
            });

            // Recalcula status das lojas envolvidas
            recomputeStoreStatus(storeId);
            if (oldStoreId !== storeId) recomputeStoreStatus(oldStoreId);

            try {
                await persistAppState();
                renderValidatedRuptures();
                selectedPhotos = [];
                document.getElementById('photoPreviewContainer').innerHTML = '';
                e.target.reset();
                visitModal.style.display = 'none';
                _resetEditMode();
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
                checkOverdueStores();
                renderPage(currentPage || 'dashboard');
                updateStats();
                updateNotifications();
                showToast('Visita atualizada com sucesso!');
            } catch (err) {
                console.error('Erro ao salvar ediï¿½ï¿½o:', err);
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
                alert('Erro ao salvar a ediï¿½ï¿½o. Tente novamente.');
            }
            return; // Encerra aqui é não executa o fluxo de nova visita
        }
    }

    // ============================================================
    // MODO NOVA VISITA (comportamento original)
    // ============================================================
    const newVisit = {
        id: Date.now(),
        storeId,
        date: visitDate,
        ruptures: checkedProducts,
        extraPoints: checkedExtraPoints,
        isExtra,
        notes,
        photos: []  // fotos ficam apenas em memória (photoCache), não no localStorage
    };

    // Guarda fotos só em memória para a sessão atual
    if (selectedPhotos.length > 0) {
        photoCache[newVisit.id] = [...selectedPhotos];
        
        // ?? Upload para o servidor (em background)
        if (typeof Storage !== 'undefined' && Storage.isServer) {
            const urls = [];
            for (const b64 of selectedPhotos) {
                const u = await Storage.uploadPhoto(b64, newVisit.id);
                if (u) urls.push(u);
            }
            if (urls.length > 0) photoCache[newVisit.id] = urls;
        }
    }
    
    // Atualiza Estado
    visits.push(newVisit);
    
    recomputeStoreStatus(storeId);
    
    let autoResolvedCount = 0;

    // Auto-resolver rupturas validadas: se houver uma ruptura ativa
    // para esta loja que NÃO aparece na nova visita (checkedProducts),
    // e a nova visita tem data igual ou posterior à visita que gerou
    // a ruptura, então consideramos a ruptura resolvida automaticamente.
    (function autoResolveFromNewVisit() {
        const visitDateStr = newVisit.date;
        const newDate = visitDateStr ? new Date(visitDateStr) : new Date();
        const toResolve = [];

        validatedRuptures.forEach(r => {
            if (r.storeId === storeId && !(newVisit.ruptures || []).includes(r.productId)) {
                // compare dates when available
                const rDate = r.visitDate ? new Date(r.visitDate) : null;
                if (!rDate || newDate >= rDate) {
                    toResolve.push(r);
                }
            }
        });

        if (toResolve.length > 0) {
            autoResolvedCount = toResolve.length;
            toResolve.forEach(r => {
                const store = stores.find(s => s.id === r.storeId);
                resolvedRupturesHistory.unshift({
                    ...r,
                    network: store?.network || r.network || '',
                    resolvedAt: visitDateStr,
                    resolvedAtTime: new Date(`${visitDateStr}T12:00:00`).toLocaleString('pt-BR'),
                    visitId: newVisit.id,
                    visitDate: visitDateStr,
                    timestamp: new Date(`${visitDateStr}T12:00:00`).getTime()
                });

                validatedRuptures = validatedRuptures.filter(vr => !(vr.productId === r.productId && vr.storeId === r.storeId));
            });
            // Keep history bounded
            resolvedRupturesHistory = resolvedRupturesHistory.slice(0, 500);
        }
    })();
    
    // Sugerir rupturas para validaï¿½ï¿½o (em lote para performance)
    newVisit.ruptures.forEach(pId => {
        const exists = validatedRuptures.find(r => r.productId === pId && r.storeId === storeId);
        if (!exists) {
            const product = products.find(p => p.id === pId);
            const store = stores.find(s => s.id === storeId);
            const existingRupture = validatedRuptures.find(r => r.productId === pId && r.storeId === storeId);
            if (existingRupture) {
                existingRupture.visitId = newVisit.id;
                existingRupture.visitDate = visitDate;
                existingRupture.timestamp = new Date().getTime();
            } else {
                validatedRuptures.push({
                    id: Date.now() + Math.random(),
                    productId: pId,
                    productName: product ? product.name : 'Produto',
                    storeId,
                    storeName: store ? store.name : 'Loja',
                    visitId: newVisit.id,
                    visitDate,
                    timestamp: new Date().getTime()
                });
            }
        }
    });

    // Feedback e Reset imediato
    try {
        await persistAppState();
        renderValidatedRuptures();
        
        selectedPhotos = [];
        const photoPreview = document.getElementById('photoPreviewContainer');
        if (photoPreview) photoPreview.innerHTML = '';
        e.target.reset();
        
        visitModal.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;

        checkOverdueStores();
        renderPage(currentPage || 'dashboard');
        updateStats();
        updateNotifications();
        
        if (autoResolvedCount > 0) {
            showToast(`${autoResolvedCount} rupturas resolvidas automaticamente nesta visita.`,
                      'success');
        } else {
            showToast("Visita registrada com sucesso!");
        }
    } catch (err) {
        console.error("Erro ao salvar:", err);
        // Libera chaves legadas e tenta salvar novamente automaticamente
        localStorage.removeItem('hr_stores');
        localStorage.removeItem('hr_products');
        // Segunda tentativa após limpar espaço
        try {
            localStorage.setItem('hr_visits', JSON.stringify(visits));
            saveStoreUpdates();
            localStorage.setItem('hr_validated_ruptures', JSON.stringify(validatedRuptures));
            showToast("Visita salva após liberar espaço!", 'success');
        } catch(err2) {
            alert("Armazenamento cheio mesmo após limpeza. Exporte o relatério em CSV e limpe o histórico de visitas antigas.");
        }
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
}

function suggestRupture(productId, storeId) {
    // Verifica se já não está validada
    const exists = validatedRuptures.find(r => r.productId === productId && r.storeId === storeId);
    if (!exists) {
        // Por enquanto, vamos validar automaticamente para demonstraï¿½ï¿½o, 
        // ou adicionar a uma lista de "pendentes"
        const product = products.find(p => p.id === productId);
        const store = stores.find(s => s.id === storeId);
        
        // Adicionar botão de validaï¿½ï¿½o na UI ou validar direto se for a chefe
        // Vamos criar a entrada de ruptura validada
        const newRupture = {
            id: Date.now() + Math.random(),
            productId,
            productName: product ? product.name : 'Produto',
            storeId,
            storeName: store ? store.name : 'Loja',
            timestamp: new Date().getTime()
        };
        
        validatedRuptures.push(newRupture);
        localStorage.setItem('hr_validated_ruptures', JSON.stringify(validatedRuptures));
        renderValidatedRuptures();
    }
}

function renderValidatedRuptures(storeFilter) {
    const container = document.getElementById('dashboardProductAlerts');
    const fRuptures = typeof getGlobalFilteredRuptures === 'function' ? getGlobalFilteredRuptures() : validatedRuptures;
    const countEl = document.getElementById('activeRupturesCount');
    if (countEl) countEl.textContent = fRuptures.length;
    if (!container) return;

    container.innerHTML = '';

    // Se não recebeu filtro, tenta ler do input
    if (storeFilter === undefined) {
        const searchInput = document.getElementById('ruptureStoreSearch');
        storeFilter = searchInput ? searchInput.value : '';
    }

    // Normaliza o filtro (remove acentos e lowercase)
    const normalizeStr = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const filterNorm = normalizeStr(storeFilter || '');

    // Filtra rupturas pela loja
    const filtered = filterNorm
        ? fRuptures.filter(r => normalizeStr(r.storeName || '').includes(filterNorm))
        : fRuptures;

    if (fRuptures.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhuma ruptura ativa para os filtros atuais.</p>';
        return;
    }

    if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhuma ruptura encontrada para esta loja.</p>';
        return;
    }

    // Pré-calcular reincidências: contagem de visitas consecutivas mais recentes
    // reportando o mesmo produto em ruptura na mesma loja
    const recurrenceMap = {};
    fRuptures.forEach(r => {
        const key = `${r.productId}-${r.storeId}`;
        if (!recurrenceMap[key]) {
            const storeVisits = visits.filter(v => v.storeId === r.storeId)
                                      .sort((a, b) => new Date(b.date) - new Date(a.date));
            let streak = 0;
            for (const v of storeVisits) {
                if (v.ruptures && v.ruptures.includes(r.productId)) {
                    streak++;
                } else {
                    break;
                }
            }
            recurrenceMap[key] = streak;
        }
    });

    filtered.forEach(rupture => {
        // Encontra a loja para pegar a data da última visita
        const store = stores.find(s => s.id === rupture.storeId);
        
        let referenceTime = rupture.timestamp;
        if (store && store.lastVisit) {
            // lastVisit é uma string "YYYY-MM-DD"; converter para timestamp
            const parsed = new Date(store.lastVisit + 'T12:00:00').getTime();
            if (!isNaN(parsed)) referenceTime = parsed;
        }
        
        const timeDiff = getTimeDiff(referenceTime);
        const key = `${rupture.productId}-${rupture.storeId}`;
        const visitCount = recurrenceMap[key] || 0;
        const isRecurrent = visitCount >= 2;

        const item = document.createElement('div');
        item.className = 'rupture-item' + (isRecurrent ? ' rupture-recurrent' : '');
        item.innerHTML = `
            <div class="rupture-item-header">
                <span class="rupture-product">${rupture.productName}</span>
                <span class="rupture-time">${timeDiff}</span>
            </div>
            <div class="rupture-store-row">
                <span class="rupture-store">${rupture.storeName}</span>
                ${isRecurrent ? `
                    <span class="rupture-recurrence-badge" title="Produto em ruptura em ${visitCount} visitas é mesma loja">
                        <i class="fa-solid fa-fire"></i> ${visitCount}ª visita sem resolver
                    </span>
                ` : ''}
            </div>
            <div class="rupture-actions">
                <button class="btn btn-secondary btn-small" onclick="resolveRupture(${rupture.id})">
                    <i class="fa-solid fa-check"></i> Resolvido
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

// Funï¿½ï¿½o chamada pelo input de busca por loja no painel de rupturas
window.filterRupturesByStore = function() {
    const searchInput = document.getElementById('ruptureStoreSearch');
    renderValidatedRuptures(searchInput ? searchInput.value : '');
};

function getTimeDiff(timestamp) {
    const now = new Date().getTime();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60) ;
    const days = Math.floor(hours / 24);

    if (days > 0) return `Há ${days}d`;
    if (hours > 0) return `Há ${hours}h`;
    return `Há ${minutes}min`;
}

window.resolveRupture = function(id) {
    const rupture = validatedRuptures.find(r => r.id === id);
    if (rupture) {
        const store = stores.find(s => s.id === rupture.storeId);
        resolvedRupturesHistory = [{
            ...rupture,
            network: store?.network || rupture.network || '',
            resolvedAt: new Date().toISOString().slice(0, 10),
            resolvedAtTime: new Date().toLocaleString('pt-BR'),
            visitId: rupture.visitId || null,
            visitDate: rupture.visitDate || null
        }, ...resolvedRupturesHistory].slice(0, 300);
    }

    validatedRuptures = validatedRuptures.filter(r => r.id !== id);
    saveAppStateLocally();
    if (typeof Storage !== 'undefined' && Storage.isServer) syncAppStateServer();
    if (currentPage === 'dashboard') {
        renderValidatedRuptures();
        renderProductAlerts();
    } else if (currentPage === 'history') {
        renderHistoryViewData();
    } else {
        renderValidatedRuptures();
    }
    updateStats();
};

// (updateStats unificado)

function renderProductAlerts() {
    const alertsContainer = document.getElementById('dashboardProductAlerts');
    alertsContainer.innerHTML = '';
    
    // Contar quantas vezes cada produto entrou em ruptura
    const ruptureCounts = {};
    visits.forEach(v => {
        v.ruptures.forEach(pId => {
            ruptureCounts[pId] = (ruptureCounts[pId] || 0) + 1;
        });
    });
    
    // Criar lista ordenada por maior ruptura
    const sortedAlerts = Object.entries(ruptureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
        
    if (sortedAlerts.length === 0) {
        alertsContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Nenhuma ruptura registrada ainda.</p>';
        return;
    }

    sortedAlerts.forEach(([pId, count]) => {
        const product = products.find(p => p.id == pId);
        const item = document.createElement('div');
        item.style.marginBottom = '12px';
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 500;">${product ? product.name : 'Desconhecido'}</span>
                <span class="badge" style="position: static; background: var(--primary-red);">${count}x</span>
            </div>
            <div style="height: 6px; background: #eee; border-radius: 3px; margin-top: 5px;">
                <div style="width: ${(count/visits.length)*100}%; height: 100%; background: var(--primary-red); border-radius: 3px;"></div>
            </div>
        `;
        alertsContainer.appendChild(item);
    });
}

function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorMsg = document.getElementById('loginError');

    // Credenciais Personalizadas - liberado temporariamente para testes
    if (true || (user.toLowerCase() === 'nicole.portela' && pass === 'lasanha10')) {
        safeSetItem('hr_logged_in', 'true');
        document.body.classList.add('logged-in');
        document.body.classList.remove('not-logged-in');
        updateNotifications(); // Atualizar alertas após login
        updateStats(); // Garantir que as estatísticas carreguem no login
    } else {
        errorMsg.style.display = 'block';
    }
}

window.logout = function() {
    safeRemoveItem('hr_logged_in');
    location.reload();
};

window.openVisitForStore = function(storeId) {
    _resetEditMode();
    visitModal.style.display = 'flex';
    storeSelect.value = storeId;
    document.getElementById('visitDate').valueAsDate = new Date();
    const store = stores.find(s => s.id === storeId);
    renderChecklist('', store ? store.productIds : null);
};

// Restaura o modal para o estado padrão de "Nova Visita"
function _resetEditMode() {
    editingVisitId = null;
    // Desbloqueia o select de loja (pode ter sido travado em modo ediï¿½ï¿½o)
    if (storeSelect) storeSelect.disabled = false;
    const modalTitle = document.querySelector('#visitModal .modal-header h2');
    if (modalTitle) modalTitle.textContent = 'Registrar Visita';
    const submitBtn = document.querySelector('#visitForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = 'Salvar Visita';
        submitBtn.className = 'btn btn-success';
    }
    // Remove banner de modo ediï¿½ï¿½o se existir
    const editBanner = document.getElementById('editModeBanner');
    if (editBanner) editBanner.remove();
    // limpar checkbox de Visita Extra
    const extraCb = document.getElementById('visitIsExtra');
    if (extraCb) extraCb.checked = false;
}

// Abre o modal prï¿½-populado com os dados da visita para ediï¿½ï¿½o
window.openEditVisit = function(visitId) {
    const visit = visits.find(v => v.id === visitId);
    if (!visit) { alert('Visita não encontrada.'); return; }

    const store = stores.find(s => s.id === visit.storeId);

    // Define o ID em ediï¿½ï¿½o ANTES de qualquer renderizaï¿½ï¿½o
    editingVisitId = visitId;

    // Abre o modal
    visitModal.style.display = 'flex';

    // Ajusta título e botão para indicar modo ediï¿½ï¿½o
    const modalTitle = document.querySelector('#visitModal .modal-header h2');
    if (modalTitle) modalTitle.textContent = 'Editar Visita';

    const submitBtn = document.querySelector('#visitForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
        submitBtn.className = 'btn btn-primary';
    }

    // Adiciona banner visual de aviso (se não existir ainda)
    if (!document.getElementById('editModeBanner')) {
        const form = document.getElementById('visitForm');
        const banner = document.createElement('div');
        banner.id = 'editModeBanner';
        banner.style.cssText = `
            background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;
            padding: 10px 14px; margin-bottom: 14px; font-size: 0.85rem;
            color: #856404; display: flex; align-items: center; gap: 8px;
        `;
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>
            <span>Você está <strong>editando</strong> uma visita existente. As alterações substituirão os dados anteriores.</span>`;
        form.insertBefore(banner, form.firstChild);
    }

    // Pré-preenche a loja
    storeSelect.value = visit.storeId;
    // Bloqueia troca de loja durante ediï¿½ï¿½o para evitar inconsistência
    storeSelect.disabled = true;

    // Pré-preenche a data
    document.getElementById('visitDate').value = visit.date;

    // Pré-preenche observaï¿½ï¿½es
    document.getElementById('visitNotes').value = window.fixEncoding(visit.notes) || '';

    // Renderiza checklist da loja e depois marca os produtos em ruptura
    renderChecklist('', store ? store.productIds : null);

    // Aguarda o DOM da checklist ser montado antes de marcar os checkboxes
    requestAnimationFrame(() => {
        const checkboxes = document.querySelectorAll('.rupture-check');
        checkboxes.forEach(cb => {
            cb.checked = visit.ruptures && visit.ruptures.includes(cb.value);
        });
        const extraCheckboxes = document.querySelectorAll('.extra-point-check');
        extraCheckboxes.forEach(cb => {
            cb.checked = visit.extraPoints && visit.extraPoints.includes(cb.value);
        });
        const isExtraCb = document.getElementById('visitIsExtra');
        if (isExtraCb) isExtraCb.checked = !!visit.isExtra;
    });

    // Garante que ao fechar o modal (pelo X ou fundo) a loja seja desbloqueada
    const unlockStore = () => { storeSelect.disabled = false; };
    visitModal.addEventListener('click', function onBgClick(e) {
        if (e.target === visitModal) { unlockStore(); visitModal.removeEventListener('click', onBgClick); }
    }, { once: true });
    const xBtn = document.querySelector('#visitModal .close-modal');
    if (xBtn) xBtn.addEventListener('click', unlockStore, { once: true });
};

window.toggleNetworkDropdown = function() {
    const dropdown = document.getElementById('networkDropdown');
    if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
};

window.toggleAllNetworks = function(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll('.network-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateNetworkFilterLabel();
};

window.updateNetworkFilterLabel = function() {
    const checkboxes = document.querySelectorAll('.network-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    const someChecked = Array.from(checkboxes).some(cb => cb.checked);
    
    const selectAllCb = document.getElementById('selectAllNetworks');
    if (selectAllCb) selectAllCb.checked = allChecked;
    
    const label = document.getElementById('networkFilterLabel');
    if (label) {
        if (allChecked || checkboxes.length === 0) {
            label.textContent = "Todas as Redes";
        } else if (someChecked) {
            const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
            label.textContent = `${checkedCount} rede(s) selecionada(s)`;
        } else {
            label.textContent = "Nenhuma rede";
        }
    }
    renderReportsTable();
};

document.addEventListener('click', function(event) {
    const multiselect = document.querySelector('.custom-multiselect');
    if (multiselect && !multiselect.contains(event.target)) {
        const dropdown = document.getElementById('networkDropdown');
        if (dropdown) dropdown.style.display = 'none';
    }
});

// Start the app
window.addEventListener('unhandledrejection', function(event) {
    alert("Erro assíncrono detectado: " + event.reason);
});
init().catch(err => {
    alert("Erro crítico ao inicializar o painel: " + err.message);
    console.error(err);
});

window.showVisitDetails = function(visitId) {
    const visit = visits.find(v => v.id === visitId);
    if (!visit) return;
    const store = stores.find(s => s.id === visit.storeId);
    const modal = document.getElementById('visitDetailsModal');
    const body = document.getElementById('visitDetailsBody');
    
    if (!modal || !body) return;
    
    const ruptureNames = visit.ruptures.map(pId => {
        const prod = products.find(p => p.id === pId);
        return prod ? prod.name : 'Produto Desconhecido';
    });

    const itemDetailsHtml = (visit.ruptures || []).map(pId => {
        const prod = products.find(p => p.id === pId);
        const name = prod ? prod.name : 'Produto Desconhecido';
        const status = getResolvedItemStatus(pId, visit.storeId, visit.id);
        const resolvedLabel = status.isResolved
            ? `<span style="font-size: 0.72rem; background: #e8f5e9; color: #2e7d32; padding: 3px 6px; border-radius: 999px; font-weight: 700;"><i class="fa-solid fa-check"></i> Resolvido${status.resolvedAt ? ` · ${formatDate(status.resolvedAt)}` : ''}</span>`
            : `<span style="font-size: 0.72rem; background: #ffebee; color: var(--primary-red); padding: 3px 6px; border-radius: 999px; font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> Pendente</span>`;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:8px; padding:8px 10px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px;">
                <span style="font-weight:600; color: var(--text-dark);">${name}</span>
                ${resolvedLabel}
            </div>`;
    }).join('');
    
    // Busca outras visitas para a mesma loja
    const otherVisits = visits.filter(v => v.storeId === visit.storeId && v.id !== visitId)
                              .sort((a, b) => new Date(b.date) - new Date(a.date));

    let historyHtml = '';
    if (otherVisits.length > 0) {
        historyHtml = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 2px dashed var(--border-color);">
                <h3 style="font-size: 1rem; margin-bottom: 12px; color: var(--primary-blue);">
                    <i class="fa-solid fa-clock-rotate-left"></i> Outras Visitas é ${store ? store.name : 'Loja'}
                </h3>
                <ul style="list-style: none; padding: 0; font-size: 0.85rem;">
        `;
        otherVisits.forEach(v => {
            let itemsHtml = '';
            
            if (v.ruptures && v.ruptures.length > 0) {
                const itemsList = v.ruptures.map(pId => {
                    const prod = products.find(p => p.id === pId);
                    const name = prod ? prod.name : 'Produto Desconhecido';
                    
                    // Verifica se já foi resolvido (se o produto Nï¿½O está mais na lista de rupturas validadas/ativas para esta loja)
                    const isResolved = !validatedRuptures.some(r => r.productId === pId && r.storeId === v.storeId);
                    
                    if (isResolved) {
                        return `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-bottom: 4px; border-bottom: 1px solid #e0e0e0;">
                                    <span style="color: var(--text-muted); text-decoration: line-through;">${name}</span>
                                    <span style="font-size: 0.65rem; background: #e8f5e9; color: #2e7d32; padding: 3px 6px; border-radius: 4px; font-weight: bold;"><i class="fa-solid fa-check"></i> Resolvido</span>
                                </div>`;
                    } else {
                        return `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-bottom: 4px; border-bottom: 1px solid #e0e0e0;">
                                    <span style="color: var(--text-dark); font-weight: 500;">${name}</span>
                                    <span style="font-size: 0.65rem; background: #ffebee; color: var(--primary-red); padding: 3px 6px; border-radius: 4px; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Pendente</span>
                                </div>`;
                    }
                }).join('');
                
                itemsHtml = `<div style="margin-top: 8px;">${itemsList}</div>`;
            } else {
                itemsHtml = `<span style="color: #27ae60; font-weight: 500; display: block; margin-top: 8px;">Tudo Ok (Sem rupturas)</span>`;
            }
            
            historyHtml += `
                    <li style="margin-bottom: 12px; padding: 12px; background: var(--bg-light); border-radius: 8px; border-left: 3px solid ${(v.ruptures && v.ruptures.length > 0) ? 'var(--primary-red)' : '#27ae60'}">
                        <strong style="display: block; margin-bottom: 4px; color: var(--primary-blue); border-bottom: 1px solid #ddd; padding-bottom: 6px;">
                            <i class="fa-solid fa-calendar-day"></i> ${formatDate(v.date)}
                        </strong>
                        ${itemsHtml}
                    </li>
            `;
        });
        historyHtml += `
                </ul>
            </div>
        `;
    }

    const summary = getVisitResolutionSummary(visit);
    const resolvedCount = summary.resolvedCount;
    const pendingCount = Math.max(0, summary.totalItems - resolvedCount);

    body.innerHTML = `
        <div style="margin-bottom: 15px;">
            <strong style="font-size: 1.1rem; color: var(--primary-blue);">${store ? store.name : 'Removida'}</strong><br>
            <span style="color: var(--text-muted); font-size: 0.9rem;">Data da Visita: ${formatDate(visit.date)}</span>
        </div>
        <div style="margin-bottom: 14px; padding: 10px 12px; border-radius: 10px; background: ${summary.totalItems > 0 && resolvedCount === summary.totalItems ? '#f4fff5' : '#f8fafc'}; border: 1px solid ${summary.totalItems > 0 && resolvedCount === summary.totalItems ? '#c8e6c9' : '#e5e7eb'};">
            <strong style="display:block; margin-bottom: 4px; color: var(--primary-blue);">Progresso de resolução</strong>
            <span style="font-size: 0.92rem; color: var(--text-muted);">${summary.label}</span>
        </div>
        <h3 style="font-size: 1rem; margin-bottom: 10px; color: var(--primary-red);">Evolução dos Itens</h3>
        ${ruptureNames.length > 0
            ? `<div style="display:grid; gap:8px;">${itemDetailsHtml}</div>`
            : '<p class="empty-state">Nenhuma ruptura registrada nesta visita.</p>'}
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color); display:grid; gap:8px;">
            <div style="font-size: 0.9rem; color: #2e7d32;"><i class="fa-solid fa-check"></i> Resolvidos: ${resolvedCount}</div>
            <div style="font-size: 0.9rem; color: var(--primary-red);"><i class="fa-solid fa-triangle-exclamation"></i> Pendentes: ${pendingCount}</div>
        </div>
        ${visit.notes ? `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color);">
                <strong>Observações:</strong>
                <p style="margin-top: 5px; font-size: 0.9rem; color: var(--text-muted);">${window.fixEncoding(visit.notes)}</p>
            </div>
        ` : ''}
        ${(visit.extraPoints && visit.extraPoints.length > 0) ? `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color);">
                <strong style="color: #8e44ad;"><i class="fa-solid fa-star"></i> Pontos Extras:</strong>
                <div style="margin-top: 8px;">
                    ${visit.extraPoints.map(ep => `<span class="badge-extra-point">${ep}</span>`).join('')}
                </div>
            </div>
        ` : ''}
        ${historyHtml}
    `;
    
    modal.style.display = 'flex';
};











function getVisitResolutionSummary(visit) {
    if (!visit || !visit.ruptures) return { totalItems: 0, resolvedCount: 0 };
    const totalItems = visit.ruptures.length;
    let resolvedCount = 0;
    
    visit.ruptures.forEach(productId => {
        const isResolved = resolvedRupturesHistory.some(r => 
            r.visitId === visit.id && String(r.productId) === String(productId)
        );
        if (isResolved) {
            resolvedCount++;
        }
    });
    
    return { totalItems, resolvedCount };
}

function getVisitResolutionBadge(visit) {
    const summary = getVisitResolutionSummary(visit);
    if (summary.totalItems === 0) return '<span class="status-tag ok">Sem Rupturas</span>';
    if (summary.resolvedCount === 0) return '<span class="status-tag error">Pendente</span>';
    if (summary.resolvedCount < summary.totalItems) return `<span class="status-tag warning">Parcial (${summary.resolvedCount}/${summary.totalItems})</span>`;
    return '<span class="status-tag ok">Resolvido</span>';
}





