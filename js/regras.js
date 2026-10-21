// Regras comerciais e cálculos do pedido (margem, descontos, modalidades), mais utilitários usados por todas as telas.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

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

// ===== Regras comerciais =====
// The numbers are NOT written here: the server sends them with the session (api/lib/pricing.php,
// pricing_rules_for_client) and applyServerRules() fills these two objects. The screen uses them
// only to show the calculations while the order is being built; the server recalculates to decide.
const PRICING_RULES = {
    DEFAULT_PRODUCT_MARGIN: 0,     // produto sem margem informada na tabela
    EARLY_PAYMENT_DISCOUNT: 0,
    FOB_FREIGHT_DISCOUNT: 0,
    MIN_JUSTIFICATION_LENGTH: 0
};
// Modalidade da nota (Livre / Aval / Garantia): maxDiscount é o desconto total permitido contra o
// preço de tabela; notice aparece para o representante e o gestor quando o pedido tem desconto.
const INVOICE_MODES = {};
let DEFAULT_INVOICE_MODE = '';

function applyServerRules(rules) {
    if (!rules) return;
    PRICING_RULES.DEFAULT_PRODUCT_MARGIN = Number(rules.defaultProductMargin) || 0;
    PRICING_RULES.EARLY_PAYMENT_DISCOUNT = Number(rules.earlyPaymentDiscount) || 0;
    PRICING_RULES.FOB_FREIGHT_DISCOUNT = Number(rules.fobFreightDiscount) || 0;
    PRICING_RULES.MIN_JUSTIFICATION_LENGTH = Number(rules.minJustificationLength) || 0;
    Object.keys(INVOICE_MODES).forEach(key => delete INVOICE_MODES[key]);
    (rules.invoiceModes || []).forEach(mode => {
        INVOICE_MODES[mode.key] = {
            name: mode.name,
            invoiceShare: mode.invoiceShare,
            short: `${mode.name} (${mode.invoiceShare})`,
            maxDiscount: Number(mode.maxDiscount) || 0,
            notice: mode.notice || ''
        };
    });
    DEFAULT_INVOICE_MODE = rules.defaultInvoiceMode || Object.keys(INVOICE_MODES)[0] || '';
    if (typeof renderInvoiceModeOptions === 'function') renderInvoiceModeOptions();
    if (typeof applyPricingRuleLabels === 'function') applyPricingRuleLabels();
}

// Colour of a margin. Green = at (or above) the product's margin at full price; yellow = reduced
// by discounts; red = negative. The margin is information for the gestor: what blocks an order
// is the modality's discount range, not the margin.
// tone is the CSS class suffix (tone-good / tone-warn / tone-bad); color is only for the PDF.
function getMarginStatus(margin, referenceMargin) {
    if (margin >= referenceMargin - 0.005) {
        return { label: 'Margem cheia', tone: 'good', color: '#15803d', description: 'Margem cheia' };
    }
    if (margin >= 0) {
        return { label: 'Reduzida', tone: 'warn', color: '#b45309', description: 'Margem reduzida pelos descontos' };
    }
    return { label: 'Negativa', tone: 'bad', color: '#c53030', description: 'Margem negativa' };
}

// The order keeps the percentages it was sent with, so a later rule change never rewrites what
// was already submitted; an order without them uses today's rules.
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
        invoiceMode: Object.prototype.hasOwnProperty.call(INVOICE_MODES, c.invoiceMode) ? c.invoiceMode : DEFAULT_INVOICE_MODE,
        lowMarginJustification: String(c.lowMarginJustification || '').trim()
    };
}

function getOrderDiscountPercent(conditions) {
    const c = normalizeOrderConditions(conditions);
    return c.manualDiscount
        + (c.earlyPayment ? c.earlyPaymentPercent : 0)
        + (c.fobFreight ? c.fobFreightPercent : 0);
}

// "10" or "12,35": a percentage for messages.
function formatMarginPercent(value) {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// MARGEM. Each product has a margin at full price (item.tableMargin, the "Margem" column of the
// product spreadsheet): a product sold at its table price of R$ 100 with 8% of margin must keep
// R$ 92. Discounts lower the price while that R$ 92 stays put:
//
//   margem = (preço líquido − preço de tabela × (1 − margem do produto)) ÷ valor da nota
//
// A discount on one item changes only that item; a discount on the order changes every item.
// The contract % raises the invoice, but Hiperroll pays that amount out, so it lowers the margin.
//
// DESCONTO E MODALIDADE. The effective discount compares what the customer pays with the table
// price (item discounts, order discount, pagamento antecipado and frete FOB all count). Each
// modality allows a maximum (INVOICE_MODES); above it the order can only be sent with a
// justification and reaches the gestor flagged. The margin itself blocks nothing.
function calculateOrderTotals(items, conditions) {
    const c = normalizeOrderConditions(conditions);
    const discountPercent = getOrderDiscountPercent(c);
    const discountFactor = Math.max(1 - discountPercent / 100, 0);
    const contractFactor = 1 + c.contract / 100;

    const totals = { totalQty: 0, totalWeight: 0, totalFob: 0, totalGross: 0, totalNet: 0, totalInvoice: 0, totalProfit: 0, totalTable: 0 };
    let tableProfit = 0;
    const lines = (Array.isArray(items) ? items : []).map(item => {
        const qty = parseFloat(item.qty) || 0;
        const fobUnit = parseFloat(item.fob) || 0;
        const negotiatedUnit = Math.max(parseFloat(item.negotiatedPrice || item.cif) || 0, 0);
        const tableUnit = parseFloat(item.cif) > 0 ? parseFloat(item.cif) : negotiatedUnit;
        const netUnit = negotiatedUnit * discountFactor;
        const invoiceUnit = netUnit * contractFactor;

        const productMargin = parseFloat(item.tableMargin);
        const tableMargin = Number.isFinite(productMargin) && productMargin >= 0 ? productMargin : PRICING_RULES.DEFAULT_PRODUCT_MARGIN;
        const keepUnit = tableUnit * (1 - tableMargin / 100);
        const profitUnit = netUnit - keepUnit;
        const marginPercent = invoiceUnit > 0 ? (profitUnit / invoiceUnit) * 100 : 0;
        const itemDiscount = tableUnit > 0 ? Math.max((1 - netUnit / tableUnit) * 100, 0) : 0;

        totals.totalQty += qty;
        totals.totalWeight += (parseFloat(item.weight) || 0) * qty;
        totals.totalFob += fobUnit * qty;
        totals.totalGross += negotiatedUnit * qty;
        totals.totalNet += netUnit * qty;
        totals.totalInvoice += invoiceUnit * qty;
        totals.totalProfit += profitUnit * qty;
        totals.totalTable += tableUnit * qty;
        tableProfit += tableUnit * (tableMargin / 100) * qty;

        return {
            item, qty, fobUnit, negotiatedUnit, tableUnit, netUnit, invoiceUnit, profitUnit, marginPercent, tableMargin,
            discountPercent: itemDiscount,
            status: getMarginStatus(marginPercent, tableMargin),
            subtotal: invoiceUnit * qty
        };
    });

    const margin = totals.totalInvoice > 0 ? (totals.totalProfit / totals.totalInvoice) * 100 : 0;
    // Margin the order would have at full table price (null while it is empty).
    const tableMargin = totals.totalTable > 0 ? Math.round((tableProfit / totals.totalTable) * 1e6) / 1e4 : null;
    // Rounded to cents of a percent so float noise never turns "exactly 10%" into "above 10%".
    const effectiveDiscount = totals.totalTable > 0 ? Math.max(Math.round((1 - totals.totalNet / totals.totalTable) * 1e4) / 100, 0) : 0;

    const mode = INVOICE_MODES[c.invoiceMode] || null;
    const hasItems = lines.length > 0;
    const discountExceeded = hasItems && mode !== null && effectiveDiscount > mode.maxDiscount;
    const alerts = [];
    if (discountExceeded) {
        alerts.push(mode.maxDiscount === 0
            ? `Desconto de ${formatMarginPercent(effectiveDiscount)}% na modalidade ${mode.short}, que não permite desconto`
            : `Desconto de ${formatMarginPercent(effectiveDiscount)}% acima do limite de ${formatMarginPercent(mode.maxDiscount)}% da modalidade ${mode.short}`);
    }

    return {
        ...totals,
        conditions: c,
        discountPercent,
        effectiveDiscount,
        lines,
        margin,
        tableMargin,
        mode,
        modeNotice: hasItems && mode !== null && mode.notice && effectiveDiscount > 0 ? mode.notice : '',
        discountExceeded,
        requiresJustification: discountExceeded,
        alerts,
        status: getMarginStatus(margin, tableMargin !== null ? tableMargin : PRICING_RULES.DEFAULT_PRODUCT_MARGIN)
    };
}

function describeOrderDiscounts(conditions) {
    const c = normalizeOrderConditions(conditions);
    const parts = [];
    if (c.manualDiscount > 0) parts.push(`Desconto manual ${formatPercent(c.manualDiscount)}`);
    if (c.earlyPayment) parts.push(`Pagamento antecipado ${formatPercent(c.earlyPaymentPercent)}`);
    if (c.fobFreight) parts.push(`Frete FOB ${formatPercent(c.fobFreightPercent)}`);
    return parts;
}

// ===== Utilitários de tela =====

// Every text typed by someone (client, notes, names...) goes through here before entering HTML:
// "<" becomes "&lt;" and so on, so it is shown as text and can never run as code.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Money in the Brazilian format: 1234.5 → "1.234,50". Every amount on screen uses it.
function formatBRL(value, decimals = 2) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// 1234.5 → "R$ 1.234,50" (non-breaking space, so "R$" never ends a line alone).
function formatCurrency(value) {
    return `R$ ${formatBRL(value)}`;
}

// 12.5 → "12,50%".
function formatPercent(value, decimals = 2) {
    return `${formatBRL(value, decimals)}%`;
}

function formatNumber(value, decimals = 2) {
    return formatBRL(value, decimals);
}

// Line icon from the sprite at the top of Portal_Hiperroll_Final.html (ids "i-<name>").
function icon(name, extraClass = '') {
    return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

// How each order status looks everywhere (cards, lists, the order form).
const ORDER_STATUS = Object.freeze({
    rascunho: { label: 'Rascunho', tone: 'draft', icon: 'edit' },
    analise: { label: 'Em análise', tone: 'review', icon: 'clock' },
    aprovado: { label: 'Aprovado', tone: 'approved', icon: 'check-circle' },
    rejeitado: { label: 'Rejeitado', tone: 'rejected', icon: 'x-circle' }
});

function renderStatusChip(status) {
    const info = ORDER_STATUS[status] || { label: status || 'Desconhecido', tone: 'neutral', icon: 'info' };
    return `<span class="chip chip--${info.tone}">${icon(info.icon)}${escapeHtml(info.label)}</span>`;
}

const BILLING_STATUS = Object.freeze({
    pendente: { label: 'Aguardando faturamento', tone: 'neutral', icon: 'package' },
    parcial: { label: 'Faturado parcialmente', tone: 'warn', icon: 'package' },
    completo: { label: 'Faturado', tone: 'approved', icon: 'package' }
});

function renderBillingChip(billingStatus) {
    const info = BILLING_STATUS[billingStatus || 'pendente'] || BILLING_STATUS.pendente;
    return `<span class="chip chip--${info.tone}">${icon(info.icon)}${info.label}</span>`;
}

// Whoever saved/sent the order, by name when the order carries it.
function describeOrderAuthor(submission) {
    return submission.representativeName || submission.submittedBy || submission.savedBy || '—';
}

function formatDateTime(value) {
    return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function formatDate(value) {
    return value ? new Date(value).toLocaleDateString('pt-BR') : '—';
}

// Items of a saved order, with each item's margin (and how much was billed, when asked).
// Used by the gestor's screens, the order list and the trash.
function renderOrderItemsTable(submission, { showBilling = false } = {}) {
    const totals = calculateOrderTotals(submission.cart, submission.conditions);
    const billed = submission.billedQuantities || {};
    const rows = totals.lines.map(line => {
        const item = line.item;
        const billedQty = Math.min(billed[item.codigo] || 0, line.qty);
        const billingTone = billedQty >= line.qty ? 'good' : billedQty > 0 ? 'warn' : 'muted';
        return `
            <tr>
                <td class="cell-product"><strong>${escapeHtml(item.codigo)}</strong><span>${escapeHtml(item.descricao || '')}</span></td>
                <td class="num">${line.qty}</td>
                ${showBilling ? `<td class="num tone-${billingTone}">${billedQty} / ${line.qty}</td>` : ''}
                <td class="num">${formatCurrency(line.negotiatedUnit)}</td>
                <td class="num tone-${line.status.tone}">${formatPercent(line.marginPercent)}</td>
                <td class="num">${formatCurrency(line.subtotal)}</td>
            </tr>`;
    }).join('');
    return `
        <div class="table-wrap">
            <table class="table table--compact">
                <thead>
                    <tr>
                        <th>Produto</th>
                        <th class="num">Qtd</th>
                        ${showBilling ? '<th class="num">Faturado</th>' : ''}
                        <th class="num">Valor unit.</th>
                        <th class="num">Margem</th>
                        <th class="num">Subtotal</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// Shared block shown to the supervisor (details, actions, history): modality, discounts,
// margin, the "PEDIDO DEVE SER IMPLANTADO..." notice and, when the order broke a rule,
// what it broke and the representative's justification.
function renderOrderConditionsSummary(submission) {
    const totals = calculateOrderTotals(submission?.cart, submission?.conditions);
    const c = totals.conditions;
    const discounts = describeOrderDiscounts(c);
    const modeHtml = totals.mode
        ? `<span class="chip chip--navy">Modalidade: ${escapeHtml(totals.mode.short)}</span>`
        : '';
    const discountsHtml = discounts.length
        ? discounts.map(d => `<span class="chip chip--info">${escapeHtml(d)}</span>`).join('')
        : '<span class="chip">Sem descontos de pedido</span>';
    const contractHtml = c.contract > 0
        ? `<span class="chip">Contrato +${formatPercent(c.contract)}</span>`
        : '';
    const noticeHtml = totals.modeNotice
        ? `<div class="alert alert--warn">${icon('pin')}<span>${escapeHtml(totals.modeNotice)}</span></div>`
        : '';

    const justificationHtml = totals.requiresJustification
        ? `<div class="alert alert--danger low-margin-alert">${icon('alert')}
                <div>
                    ${totals.alerts.map(alert => `<strong>${escapeHtml(alert)}</strong>`).join('')}
                    <div>${c.lowMarginJustification
                        ? `Justificativa do representante: <em>${escapeHtml(c.lowMarginJustification)}</em>`
                        : 'Nenhuma justificativa registrada.'}</div>
                </div>
            </div>`
        : '';

    return `
        <div class="order-conditions-summary">
            <div class="chip-row">${modeHtml}${discountsHtml}${contractHtml}</div>
            <div class="kv-row">
                <span>Desconto sobre a tabela <strong>${formatPercent(totals.effectiveDiscount)}</strong></span>
                <span>Margem do pedido <strong class="tone-${totals.status.tone}">${formatPercent(totals.margin)}</strong> <span class="muted">(${totals.status.label})</span></span>
            </div>
            ${noticeHtml}
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

