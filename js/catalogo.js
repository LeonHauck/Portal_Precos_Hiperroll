// Tabela de preços em uso na tela: catálogo, cálculo de FOB/CIF, atualização automática e revisão de preços do pedido.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

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
        // Margin of the product at full price: "10%" (or 0,1 if the cell came as a fraction);
        // without the column, the default.
        let tableMargin = cols.margem >= 0 ? parseDecimal(row[cols.margem]) : PRICING_RULES.DEFAULT_PRODUCT_MARGIN;
        if (tableMargin > 0 && tableMargin <= 1 && !String(row[cols.margem]).includes('%')) tableMargin *= 100;
        if (!(tableMargin > 0)) tableMargin = PRICING_RULES.DEFAULT_PRODUCT_MARGIN;
        const product = { codigo, descricao, categoria: row[cols.linha] || '', subcat: row[cols.categoria] || '', weight, ncm: row[cols.ncm] || '', active: true, tableMargin };
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
            tableMargin: p.tableMargin ?? PRICING_RULES.DEFAULT_PRODUCT_MARGIN,
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
    return { fob, cif, rate };
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
            newTableMargin: product.tableMargin
        });
    });
    return { changes, missing, hasDifferences: missing.length > 0 || changes.some(c => c.changed) };
}

// 'keep'  = the negotiated price stays; the discount against the new table is recalculated.
// 'table' = the same R$ discount as before is applied on top of the new table price.
function applyCartRepricing(plan, choice) {
    plan.changes.forEach(({ item, newFob, newCif, newWeight, newTableMargin }) => {
        const previousDiscount = item.unitDiscount || 0;
        item.fob = newFob;
        item.cif = newCif;
        item.weight = newWeight;
        // The product's margin always follows the table in force, whatever the price choice.
        if (newTableMargin !== undefined) item.tableMargin = newTableMargin;
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
    const money = value => `<span class="nowrap">${formatCurrency(value)}</span>`;
    const arrow = (before, after) => Math.abs(before - after) < 0.005
        ? money(after)
        : `<span class="reprice-old">${money(before)}</span> → <strong>${money(after)}</strong>`;
    const rows = plan.changes.filter(c => c.changed).map(({ item, newFob, newCif }) => `
        <tr>
            <td class="cell-product"><strong>${escapeHtml(item.codigo)}</strong><span>${escapeHtml(item.descricao || '')}</span></td>
            <td class="num">${arrow(item.fob, newFob)}</td>
            <td class="num">${arrow(item.cif, newCif)}</td>
            <td class="num">${money(item.negotiatedPrice)}</td>
            <td class="num">${money(Math.max(newCif - (item.unitDiscount || 0), 0))}</td>
        </tr>`).join('');
    const missing = plan.missing.length
        ? `<div class="alert alert--warn">${icon('alert')}<div><strong>Saíram da tabela e serão retirados do pedido:</strong> ${plan.missing.map(i => escapeHtml(`${i.codigo} (${i.descricao || ''})`)).join(', ')}</div></div>`
        : '';

    document.getElementById('repriceReason').textContent = reason;
    document.getElementById('repriceKeepMargin').textContent = formatPercent(previewRepricingMargin(plan, 'keep'));
    document.getElementById('repriceTableMargin').textContent = formatPercent(previewRepricingMargin(plan, 'table'));
    body.innerHTML = `
        ${rows ? `<div class="table-wrap"><table class="table table--compact">
            <thead><tr><th>Produto</th><th class="num">FOB</th><th class="num">CIF de tabela</th><th class="num">Seu preço hoje</th><th class="num">Com a nova tabela</th></tr></thead>
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

