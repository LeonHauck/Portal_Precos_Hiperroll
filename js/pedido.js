// Tela Novo Pedido: busca de produtos, carrinho, condições do pedido e totais.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

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

// ----- Faixa de peso do frete: automática, pelo peso total do pedido -----
// Same rule as freight_tier_for_weight() in api/lib/catalog.php, which decides when the order is
// saved. tier1 = 150 to 199 kg; tier2 = 200 kg or more. Lighter orders use tier1 and go to the gestor.
const FREIGHT_TIER2_MIN_KG = 200;
const FREIGHT_TIER_LABELS = Object.freeze({ tier1: 'de 150 a 199 kg', tier2: 'acima de 200 kg' });

function cartTotalWeight() {
    return cart.reduce((sum, item) => sum + (parseFloat(item.weight) || 0) * (parseInt(item.qty, 10) || 0), 0);
}

function freightTierForWeight(totalWeight) {
    return totalWeight >= FREIGHT_TIER2_MIN_KG ? 'tier2' : 'tier1';
}

function currentWeightTier() {
    return freightTierForWeight(cartTotalWeight());
}

// When the order's weight crosses the 200 kg line, every item moves to the new band: the CIF
// changes with the freight and the discount in R$ the representative gave stays. Items of an
// order the gestor returned keep their prices (priceLocked).
function syncCartWeightTier() {
    const tier = currentWeightTier();
    let changed = false;
    cart.forEach(item => {
        if (item.priceLocked || !item.uf || item.weightTier === tier) return;
        const product = productsData.find(p => p.codigo === item.codigo);
        if (!product) return;
        const prices = computeItemPrices(product, { uf: item.uf, cityType: item.cityType, weightTier: tier });
        const discount = Math.max((item.cif || 0) - (item.negotiatedPrice || 0), 0);
        item.weightTier = tier;
        item.fob = prices.fob;
        item.cif = prices.cif;
        item.negotiatedPrice = Math.max(prices.cif - discount, 0);
        item.unitDiscount = Math.max(item.cif - item.negotiatedPrice, 0);
        changed = true;
    });
    return changed;
}

function renderWeightTierInfo() {
    const el = document.getElementById('weightTierInfo');
    if (!el) return;
    const weight = cartTotalWeight();
    el.textContent = `${FREIGHT_TIER_LABELS[freightTierForWeight(weight)]} · pedido com ${formatBRL(weight, 0)} kg`;
}

function updateResults() {
    let searchTerm = document.getElementById('productSearch').value.toLowerCase().trim();
    const uf = document.getElementById('stateSelect').value;
    const cityType = document.getElementById('cityType').value;
    const weightTier = currentWeightTier();
    const container = document.getElementById('resultsContainer');
    renderWeightTierInfo();

    if (!productsData.length && pricingCatalog.source !== 'server') {
        container.innerHTML = `<div class="empty-state">${icon('info')}A tabela de preços ainda não foi liberada pelo gestor. Tente de novo mais tarde.</div>`;
        return;
    }

    if (!uf) {
        container.innerHTML = `<div class="empty-state">${icon('map-pin')}Selecione o estado para ver os preços.</div>`;
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
        container.innerHTML = `<div class="empty-state">${icon('search')}Nenhum produto encontrado.</div>`;
        return;
    }

    const rows = filtered.map(p => {
        const { fob: fobPrice, cif: cifPrice } = computeItemPrices(p, { uf, cityType, weightTier });
        return `
            <tr>
                <td class="cell-product">
                    <strong>${escapeHtml(p.codigo)}</strong>
                    <span>${escapeHtml(p.descricao)}</span>
                </td>
                <td class="num">${formatBRL(p.peso, 3)}</td>
                <td class="num price-tag price-fob">${formatCurrency(fobPrice)}</td>
                <td class="num price-tag price-cif">${formatCurrency(cifPrice)}</td>
                <td class="col-action">
                    <button class="btn btn--primary btn--sm" data-action="addToCart" data-codigo="${escapeHtml(p.codigo)}">${icon('plus')}Adicionar</button>
                </td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <table class="table">
            <thead>
                <tr>
                    <th>Produto</th>
                    <th class="num">Peso (kg)</th>
                    <th class="num">Preço FOB</th>
                    <th class="num">Preço CIF</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// Prices are calculated here from the table in use and the region selected in the filters;
// the region is stored with the item so the CIF can be recalculated if the table changes.
function addToCart(codigo) {
    const p = productsData.find(item => item.codigo === codigo);
    if (!p) return;


    const existing = cart.find(item => item.codigo === codigo);
    if (existing) {
        existing.qty++;
    } else {
        const region = getCurrentRegionFilters();
        const { fob, cif } = computeItemPrices(p, region);
        cart.push({
            codigo: p.codigo,
            descricao: p.descricao,
            fob: fob,
            cif: cif, // Preço CIF original (referência)
            negotiatedPrice: cif,
            unitDiscount: 0,
            weight: p.weightRaw,
            tableMargin: p.tableMargin, // margem do produto no preço cheio (base da margem do item)
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
        fobFreight: document.getElementById('orderFobFreight')?.checked,
        invoiceMode: document.querySelector('input[name="orderInvoiceMode"]:checked')?.value || DEFAULT_INVOICE_MODE
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
    // Orders from before the modalities (and a new, empty order) start as "100% Livre".
    const mode = c.invoiceMode || DEFAULT_INVOICE_MODE;
    document.querySelectorAll('input[name="orderInvoiceMode"]').forEach(radio => {
        radio.checked = radio.value === mode;
    });
}

// The modality options (Livre / Aval / Garantia, each with its limit) come from the server rules.
function renderInvoiceModeOptions() {
    const fieldset = document.getElementById('orderInvoiceMode');
    if (!fieldset) return;
    const current = fieldset.querySelector('input:checked')?.value || DEFAULT_INVOICE_MODE;
    const options = Object.entries(INVOICE_MODES).map(([key, mode]) => {
        const hint = mode.maxDiscount > 0 ? `desconto até ${formatMarginPercent(mode.maxDiscount)}%` : 'sem desconto';
        return `
            <label class="invoice-mode-option" title="${escapeHtml(`${mode.short}: ${hint}`)}">
                <input type="radio" name="orderInvoiceMode" value="${escapeHtml(key)}" ${key === current ? 'checked' : ''} data-change="updateOrderTable">
                <span><strong>${escapeHtml(mode.invoiceShare)}</strong> ${escapeHtml(mode.name)}<small>${hint}</small></span>
            </label>`;
    }).join('');
    fieldset.innerHTML = `<legend class="sr-only">Modalidade do pedido</legend>${options}`;
}

function applyPricingRuleLabels() {
    document.querySelectorAll('[data-pricing-rule]').forEach(el => {
        const value = PRICING_RULES[el.dataset.pricingRule];
        if (value !== undefined) el.textContent = `${formatMarginPercent(value)}%`;
    });
}

let discountBlockedNotified = false;

// Below the order form: the negotiated discount with the modality's limit, the antecipado and
// frete FOB apart, the "PEDIDO DEVE SER IMPLANTADO..." notice, what will need a justification and
// what can't be sent at all.
function renderOrderDiscountBreakdown(totals) {
    const el = document.getElementById('orderDiscountBreakdown');
    if (!el) return;
    const c = totals.conditions;
    const limit = totals.mode
        ? (totals.mode.maxDiscount === 0 ? 'a modalidade não permite desconto' : `limite da modalidade: ${formatMarginPercent(totals.mode.maxDiscount)}%`)
        : '';
    const extras = [];
    if (c.earlyPayment) extras.push(`pagamento antecipado ${formatPercent(c.earlyPaymentPercent)}`);
    if (c.fobFreight) extras.push(`frete FOB ${formatPercent(c.fobFreightPercent)}`);
    el.innerHTML = `Desconto negociado: <strong>${formatPercent(totals.negotiatedDiscount)}</strong>`
        + (limit ? ` <span>(${escapeHtml(limit)})</span>` : '')
        + (extras.length
            ? `<br><span>À parte, fora do limite: ${escapeHtml(extras.join(' + '))}. Total sobre a tabela: <strong>${formatPercent(totals.effectiveDiscount)}</strong></span>`
            : '');

    const notice = document.getElementById('orderModeNotice');
    if (notice) {
        notice.hidden = !totals.modeNotice;
        notice.innerHTML = totals.modeNotice ? `${icon('pin')}<span>${escapeHtml(totals.modeNotice)}</span>` : '';
    }

    // The moment the discount goes over the ceiling, a balloon says so (the warning below the
    // conditions is easy to miss). It shows again only after the discount went back under it.
    if (totals.discountBlocked && !discountBlockedNotified) {
        showToast(`Desconto negociado de ${formatPercent(totals.negotiatedDiscount)}: passa do máximo de ${formatPercent(PRICING_RULES.MAX_NEGOTIATED_DISCOUNT)}. Este pedido não pode ser enviado; reduza o desconto.`);
    }
    discountBlockedNotified = totals.discountBlocked;

    const warning = document.getElementById('orderMinMarginWarning');
    if (warning) {
        const text = totals.discountBlocked
            ? `${totals.alerts.join('. ')}. Reduza o desconto para enviar.`
            : totals.requiresJustification
                ? `${totals.alerts.join('. ')}. O envio exigirá uma justificativa e chegará sinalizado ao gestor.`
                : '';
        warning.hidden = !text;
        warning.innerHTML = text ? `${icon('alert')}<span>${escapeHtml(text)}</span>` : '';
    }

    // Lighter orders use the 150-199 kg freight and always go to the gestor.
    const weightWarning = document.getElementById('orderWeightWarning');
    if (weightWarning) {
        const light = totals.lines.length > 0 && totals.totalWeight < FREIGHT_TIER2_MIN_KG;
        weightWarning.hidden = !light;
        weightWarning.innerHTML = light
            ? `${icon('package')}<span>Pedido com ${escapeHtml(formatBRL(totals.totalWeight, 1))} kg, abaixo de ${FREIGHT_TIER2_MIN_KG} kg: usa o frete de 150 a 199 kg e vai para análise do gestor.</span>`
            : '';
    }
}

function updateOrderTable() {
    const container = document.getElementById('orderTableContainer');
    const summaryDiv = document.getElementById('orderSummary');

    if (cart.length === 0) {
        container.innerHTML = `<div class="empty-state empty-state--compact">${icon('cart')}Nenhum item no pedido. Use <strong>Adicionar</strong> na lista de produtos acima.</div>`;
        summaryDiv.hidden = true;
        updateTableMarginLabels(null);
        renderWeightTierInfo();
        discountBlockedNotified = false;
        return;
    }

    summaryDiv.hidden = false;

    // The weight band follows the order's weight: crossing 200 kg reprices the items, and the
    // product list shows the prices of the new band.
    if (syncCartWeightTier() && document.getElementById('stateSelect')?.value) updateResults();
    renderWeightTierInfo();

    const totals = calculateOrderTotals(cart, getCurrentOrderConditions());
    updateTableMarginLabels(totals.tableMargin);
    const showMargin = canSeeMargins();

    const rows = totals.lines.map((line, idx) => {
        const item = line.item;
        const unitDiscount = Math.max(item.unitDiscount || 0, 0);
        const marginTitle = line.tableMargin !== null
            ? `No preço de tabela a margem deste produto é ${formatMarginPercent(line.tableMargin)}%; o desconto atual do item é ${formatPercent(line.discountPercent)}`
            : 'Margem do item';
        return `
            <tr>
                <td class="cell-product">
                    <strong>${escapeHtml(item.codigo)}</strong>
                    <span>${escapeHtml(item.descricao)}</span>
                    ${item.priceLocked ? `<span class="price-locked-note" title="Pedido devolvido pelo gestor: este item mantém o preço de tabela que tinha, mesmo que a tabela tenha mudado">${icon('pin')}preço mantido</span>` : ''}
                </td>
                <td class="num">
                    <input class="input-sm w-qty" type="number" value="${item.qty}" min="1" data-change="updateCartQty" data-index="${idx}" aria-label="Quantidade">
                    <span class="print-value">${item.qty}</span>
                </td>
                <td class="num">${formatBRL(item.weight * item.qty, 3)}&nbsp;kg</td>
                <td class="num">${formatCurrency(item.fob)}</td>
                <td class="num">${formatCurrency(item.cif)}</td>
                <td class="num">
                    <input class="input-sm w-money" type="number" step="0.01" min="0" value="${unitDiscount.toFixed(2)}" data-change="updateUnitDiscount" data-index="${idx}" title="Desconto unitário em reais" aria-label="Desconto unitário">
                    <span class="print-value">${formatCurrency(unitDiscount)}</span>
                </td>
                <td class="num">
                    <input class="input-sm w-money" type="number" step="0.01" min="0" value="${line.negotiatedUnit.toFixed(2)}" data-change="updateNegotiatedPrice" data-index="${idx}" title="Preço negociado unitário" aria-label="Preço negociado">
                    <span class="print-value">${formatCurrency(line.negotiatedUnit)}</span>
                </td>
                ${showMargin ? `<td class="num">
                    <span class="tone-${line.status.tone}" title="${escapeHtml(marginTitle)}">${formatPercent(line.marginPercent)}</span>
                    ${line.tableMargin !== null ? `<div class="item-table-margin">tabela ${formatMarginPercent(line.tableMargin)}%</div>` : ''}
                </td>` : ''}
                <td class="num price-tag">${formatCurrency(line.subtotal)}</td>
                <td class="col-action">
                    <button data-action="removeFromCart" data-index="${idx}" class="btn btn--icon btn--ghost" title="Remover item" aria-label="Remover item">${icon('trash')}</button>
                </td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <table class="table">
            <thead>
                <tr>
                    <th>Produto</th>
                    <th class="num">Qtd</th>
                    <th class="num">Peso total</th>
                    <th class="num">FOB unit.</th>
                    <th class="num">CIF unit.</th>
                    <th class="num">Desconto unit. (R$)</th>
                    <th class="num">Preço negociado</th>
                    ${showMargin ? '<th class="num" title="Margem do item depois dos descontos. No preço de tabela ela é a margem do produto; cada desconto reduz esse valor.">Margem</th>' : ''}
                    <th class="num">Subtotal</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;

    document.getElementById('totalWeight').textContent = formatBRL(totals.totalWeight, 3);
    document.getElementById('totalFob').textContent = formatBRL(totals.totalFob);
    document.getElementById('totalCif').textContent = formatBRL(totals.totalInvoice);

    const printDiscountEl = document.getElementById('printDiscount');
    const printContractEl = document.getElementById('printContract');
    if (printDiscountEl) printDiscountEl.textContent = formatPercent(totals.discountPercent);
    if (printContractEl) printContractEl.textContent = formatPercent(totals.conditions.contract);

    const marginPercentageElement = document.getElementById('marginPercentage');
    marginPercentageElement.textContent = formatPercent(totals.margin);
    marginPercentageElement.className = `tone-${totals.status.tone}`;
    currentOrderMargin = totals.margin;

    const totalsPriceContainer = document.getElementById('totalsPriceContainer');
    totalsPriceContainer.classList.remove('margin-alert', 'margin-warning', 'margin-good', 'margin-critical');
    if (showMargin) {
        totalsPriceContainer.classList.add({ good: 'margin-good', warn: 'margin-warning', bad: 'margin-alert', critical: 'margin-critical' }[totals.status.tone]);
    }

    renderOrderDiscountBreakdown(totals);
}

// The header box and the "(tabela X%)" next to the order margin show the margin the order being
// built would have at full table price (it depends on the products in it); "—" while it is empty.
function updateTableMarginLabels(tableMargin) {
    const text = tableMargin === null ? '—' : `${formatMarginPercent(tableMargin)}%`;
    const header = document.getElementById('marginThreshold');
    if (header) header.textContent = text;
    const inline = document.getElementById('orderTableMargin');
    if (inline) inline.textContent = text;
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

    return parsed === 1 ? '1 dia' : `${parsed} dias`;
}

// CNPJ do cliente: optional, but when typed it must be valid (the server checks it too). It is
// what identifies the client in the comparison with the last order (aprovação automática).
function checkClientCnpj() {
    const input = document.getElementById('clientCnpj');
    const hint = document.getElementById('clientCnpjHint');
    if (!input || !hint) return true;
    const value = normalizeCnpj(input.value);
    // While it is being typed (less than 14 characters) nothing is flagged yet.
    const invalid = value.length >= 14 && !isValidCnpj(value);
    hint.hidden = !invalid;
    input.classList.toggle('is-invalid', invalid);
    return !value || isValidCnpj(value);
}

function formatClientCnpjInput(input) {
    if (!input) return;
    input.value = formatCnpj(input.value);
    const hint = document.getElementById('clientCnpjHint');
    const value = normalizeCnpj(input.value);
    const invalid = value !== '' && !isValidCnpj(value);
    if (hint) hint.hidden = !invalid;
    input.classList.toggle('is-invalid', invalid);
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

