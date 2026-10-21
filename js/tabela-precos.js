// Aba Tabela de Preços (gestor edita; administrador consulta).
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

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
    table_margin: 'Margem do produto (%)',
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
        ['lines', 'Grupos de preço', 'tag'],
        ['freight', 'Frete', 'truck'],
        ['products', 'Produtos', 'package'],
        ['bulk', 'Reajuste em lote', 'trending'],
        ['history', 'Histórico', 'clock']
    ];
    container.innerHTML = `
        <div class="pricing-toolbar">
            <div class="pricing-sections" role="tablist">
                ${sections.map(([id, label, iconName]) => `<button type="button" role="tab" class="pricing-section-btn${id === pricingTabSection ? ' active' : ''}" onclick="switchPricingSection('${id}')">${icon(iconName)}${label}</button>`).join('')}
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
            <button type="button" class="btn btn--ghost" onclick="renderPricingTab()">Descartar</button>
            <button type="button" id="pricingSaveBtn" class="btn btn--primary" onclick="${onSave}" disabled>Salvar alterações</button>
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
                <button type="button" class="btn btn--primary" onclick="importPricingCatalog()">Tentar de novo</button>
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
            <td class="col-cost pricing-computed" data-computed="markup">${formatMarkup(line)}</td>            <td class="pricing-computed">${describeLineProducts(line.key)}</td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="pricing-filterbar">
            <p class="pricing-hint">${editable ? 'Altere o <strong>preço por kg</strong> do grupo e aperte <strong>Enter</strong>. ' : ''}Cada grupo de preço tem um preço por kg; o preço FOB de cada produto do grupo = preço por kg × peso do produto. Produtos com <strong>preço próprio</strong> (seção Produtos) não mudam quando o grupo muda.</p>
            <label class="pricing-check"><input type="checkbox" ${pricingShowCosts ? 'checked' : ''} onchange="pricingShowCosts = this.checked; this.closest('#pricingSectionBody').querySelector('.pricing-table').classList.toggle('pricing-table--simple', !this.checked)"> Mostrar custos</label>
        </div>
        <div class="table-wrap table-wrap--scroll">
            <table class="table pricing-table${pricingShowCosts ? '' : ' pricing-table--simple'}">
                <thead><tr><th>Grupo de preço</th><th class="col-cost">Custo produto</th><th class="col-cost">Desp. comercial</th><th class="col-cost">Desp. adm.</th><th class="col-cost">Total custos</th><th title="Preço 100% NF">Preço por kg (R$)</th><th class="col-cost">Markup s/ custos</th><th>Produtos</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${editable ? `
        <details class="pricing-new">
            <summary>${icon('plus')}Novo grupo de preço</summary>
            <div class="pricing-form-grid">
                <label>Nome<input id="newLineName" class="pricing-input pricing-input--text" maxlength="80"></label>
                <label>Custo produto<input id="newLineCustoBase" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Desp. comercial<input id="newLineDespCom" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Desp. adm.<input id="newLineDespAdm" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Preço por kg<input id="newLinePrice100" type="number" step="0.01" min="0" class="pricing-input"></label>
                <button type="button" class="btn btn--ghost" onclick="createPricingLine()">Criar grupo</button>
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
    row.querySelector('[data-computed="markup"]').textContent = formatMarkup(line);    markPricingDirty(row);
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
        <div class="table-wrap table-wrap--scroll">
            <table class="table pricing-table">
                <thead><tr><th>UF</th><th>Praça</th><th>Descrição</th><th>150 a 199 kg</th><th>Acima de 200 kg</th>${editable ? '<th></th>' : ''}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${editable ? `
        <details class="pricing-new">
            <summary>${icon('plus')}Nova praça</summary>
            <div class="pricing-form-grid">
                <label>UF<input id="newFreightUf" class="pricing-input" maxlength="2" placeholder="Ex.: MG"></label>
                <label>Praça<select id="newFreightType" class="pricing-input">${PRACA_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('')}</select></label>
                <label>Descrição<input id="newFreightLabel" class="pricing-input pricing-input--text" maxlength="200" placeholder="Ex.: Belo Horizonte"></label>
                <label>150 a 199 kg<input id="newFreightTier1" type="number" step="0.01" min="0" class="pricing-input"></label>
                <label>Acima de 200 kg<input id="newFreightTier2" type="number" step="0.01" min="0" class="pricing-input"></label>
                <button type="button" class="btn btn--ghost" onclick="createFreightRow()">Adicionar praça</button>
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
        <p class="pricing-hint">Clique em uma ou mais categorias para filtrar. ${editable ? 'Altere quantos produtos quiser e clique em <strong>Salvar alterações</strong> (ou aperte Enter). ' : ''}Um produto <strong>sem preço próprio</strong> segue o grupo de preço dele: preço por kg do grupo × peso. <strong>Margem</strong> é a margem do produto vendido no preço cheio; cada desconto do pedido reduz esse valor. O CIF de cada região é calculado a partir do preço FOB.</p>
        ${editable ? `
        <div class="pricing-bulkbar">
            <span>Com os <strong id="pricingFilteredCount">0</strong> produtos listados:</span>
            <span class="pricing-bulkbar-group">
                <input id="bulkProductPercent" type="number" step="0.1" class="pricing-input pricing-input--narrow" placeholder="%">
                <button type="button" class="btn btn--secondary btn--sm" onclick="bulkUpdateFilteredProducts('percent')" title="Aumenta (ou reduz, com número negativo) o preço FOB de cada produto listado. Eles passam a ter preço próprio.">Reajustar preço</button>
            </span>
            <span class="pricing-bulkbar-group">
                <select id="bulkProductLine" class="pricing-input">${lineOptions}</select>
                <button type="button" class="btn btn--secondary btn--sm" onclick="bulkUpdateFilteredProducts('setLine')" title="Os produtos listados passam a pertencer a este grupo de preço e a usar o preço por kg dele.">Mover para o grupo</button>
            </span>
            <button type="button" class="btn btn--ghost btn--sm" onclick="bulkUpdateFilteredProducts('clearPrice')" title="Apaga o preço próprio dos produtos listados: eles voltam a custar preço por kg do grupo × peso.">Voltar ao preço do grupo</button>
        </div>
        <div class="pricing-pending" id="pricingProductPending" hidden>
            <span>${icon('edit')}<strong id="pricingPendingCount">0</strong> produto(s) com alteração ainda não salva</span>
            <button type="button" class="btn btn--ghost" onclick="discardPricingProductEdits()">Descartar</button>
            <button type="button" class="btn btn--primary" onclick="savePricingProducts()">Salvar alterações</button>
        </div>` : ''}
        <div class="table-wrap table-wrap--scroll">
            <table class="table pricing-table">
                <thead><tr><th>Código</th><th>Descrição</th><th>Grupo de preço</th><th>Peso (kg)</th><th>Preço FOB (R$)</th><th title="Margem do produto vendido no preço cheio (coluna Margem da planilha). Os descontos do pedido reduzem esse valor.">Margem (%)</th><th>Ativo</th></tr></thead>
                <tbody id="pricingProductRows"></tbody>
            </table>
        </div>
        ${editable ? `
        <details class="pricing-new">
            <summary>${icon('plus')}Novo produto</summary>
            <div class="pricing-form-grid">
                <label>Código<input id="newProductCodigo" class="pricing-input" maxlength="40" placeholder="Ex.: P-09999"></label>
                <label>Descrição<input id="newProductDescricao" class="pricing-input pricing-input--text" maxlength="200"></label>
                <label>Categoria<input id="newProductCategoria" class="pricing-input pricing-input--text" maxlength="80" placeholder="Ex.: Bobina Fundo Estrela"></label>
                <label>Subcategoria<input id="newProductSubcat" class="pricing-input pricing-input--text" maxlength="80"></label>
                <label>Grupo de preço<select id="newProductLine" class="pricing-input">${lineOptions}</select></label>
                <label>Peso (kg)<input id="newProductWeight" type="number" step="0.001" min="0" class="pricing-input"></label>
                <label>Preço FOB próprio (opcional)<input id="newProductPrice" type="number" step="0.01" min="0" class="pricing-input" placeholder="vazio = preço do grupo"></label>
                <label>Margem no preço cheio (%)<input id="newProductTableMargin" type="number" step="0.5" min="0" max="100" class="pricing-input" value="${PRICING_RULES.DEFAULT_PRODUCT_MARGIN}"></label>
                <button type="button" class="btn btn--ghost" onclick="createPricingProduct()">Cadastrar produto</button>
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
            ? `<span class="price-badge">preço próprio</span>${editable ? ` <button type="button" class="pricing-link-btn" onclick="resetPricingProductPrice(this)" title="Voltar a seguir o grupo de preço (R$ ${formatBRL(lineFobFor(p))})">${icon('rotate')}usar grupo</button>` : ''}`
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
            <td><input type="number" step="0.5" min="0" max="100" class="pricing-input pricing-input--narrow" data-field="tableMargin" value="${shown.tableMargin}" ${dis} oninput="onPricingProductInput(this)"></td>
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
        tableMargin: readPricingNumber(row, 'tableMargin'),
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
    const product = { ...current, descricao: edit.descricao.trim(), costLineKey: edit.costLineKey, weight: edit.weight, tableMargin: edit.tableMargin, active: edit.active };
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
            tableMargin: parseFloat(value('newProductTableMargin')) || 0,
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
                <button type="button" class="btn btn--ghost" onclick="previewBulkAdjust()">${icon('eye')}Pré-visualizar</button>
                <button type="button" id="bulkApplyBtn" class="btn btn--primary" onclick="applyBulkAdjust()" disabled>Aplicar reajuste</button>
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
    if (field === 'table_margin') return `${formatMarginPercent(parseFloat(value))}%`;
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
            <div class="table-wrap table-wrap--scroll"><table class="table pricing-table">
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
            <div class="table-wrap table-wrap--scroll"><table class="table pricing-table">
                <thead><tr><th>Quando</th><th>Quem</th><th>Item</th><th>Campo</th><th>De</th><th>Para</th><th>Motivo</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;
    } catch (e) {
        body.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
}
