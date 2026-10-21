// Proposta em PDF e impressão.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// The PDF is a separate document (html2pdf turns this node into the file), so it carries its own
// <style>: the portal's style.css and its dark theme never reach it.
function createPdfExportNode() {
    const pricing = calculateOrderTotals(cart, getCurrentOrderConditions());
    const field = id => document.getElementById(id)?.value.trim() || '';
    const orderNumberHiperroll = field('orderNumberHiperroll') || '—';
    const orderNumberClient = field('orderNumberClient');
    const orderNumber = field('loadedDraftNumber') || orderNumberClient || orderNumberHiperroll;
    const clientName = field('clientName') || '—';
    const representativeName = field('representativeName') || '—';
    const proposalValidity = normalizeProposalValidity(field('proposalValidity')) || '—';
    const dateStr = formatDateTime(new Date());
    const status = ORDER_STATUS[statusManager.currentStatus] || ORDER_STATUS.rascunho;

    const rowsHtml = pricing.lines.map(line => {
        const item = line.item;
        return `
            <tr>
                <td class="pdf-code">${escapeHtml(item.codigo)}</td>
                <td title="${escapeHtml(item.descricao)}">${escapeHtml(summarizeDescription(item.descricao || '', 36))}</td>
                <td class="pdf-num">${item.qty}</td>
                <td class="pdf-num">${formatBRL(item.weight * item.qty, 3)}</td>
                <td class="pdf-num">${formatCurrency(item.fob)}</td>
                <td class="pdf-num">${formatCurrency(item.cif)}</td>
                <td class="pdf-num">${formatCurrency(Math.max(item.unitDiscount || 0, 0))}</td>
                <td class="pdf-num">${formatCurrency(line.negotiatedUnit)}</td>
                <td class="pdf-num">${formatPercent(line.marginPercent)}</td>
                <td class="pdf-num">${formatCurrency(line.subtotal)}</td>
            </tr>`;
    }).join('');

    const pdfConditions = describeOrderDiscounts(pricing.conditions);
    const totalQuantity = cart.reduce((sum, item) => sum + (item.qty || 0), 0);
    const totalNegotiatedNoAdjust = cart.reduce((sum, item) => sum + Math.max(item.negotiatedPrice || item.cif, 0) * (item.qty || 0), 0);
    const totalDiscounts = cart.reduce((sum, item) => sum + Math.max(item.unitDiscount || 0, 0) * (item.qty || 0), 0);
    const totalCif = pricing.totalInvoice; // already includes the order discount and the contract

    const pdfNode = document.createElement('div');
    pdfNode.className = 'pdf-export';
    pdfNode.innerHTML = `
        <style>
            .pdf-export { background: #ffffff; color: #0f172a; font-family: 'Helvetica Neue', Arial, sans-serif; }
            .pdf-export table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .pdf-export th, .pdf-export td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; word-break: break-word; font-size: 10px; text-align: left; }
            .pdf-export thead th { background: #f1f5f9; font-weight: 700; text-transform: uppercase; color: #334155; }
            .pdf-export .pdf-num { text-align: right; white-space: nowrap; }
            .pdf-export .pdf-code { font-weight: 700; font-size: 11px; }
            .pdf-header { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 3px solid #e31e24; }
            .pdf-logo { width: 72px; height: 72px; object-fit: contain; }
            .pdf-title h1 { margin: 0; font-size: 20px; color: #0f172a; }
            .pdf-title p { margin: 2px 0 0; font-weight: 700; color: #e31e24; }
            .pdf-meta { margin-left: auto; text-align: right; font-size: 12px; }
            .pdf-box { display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 6px 24px; margin-bottom: 14px; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; font-size: 12px; break-inside: avoid; page-break-inside: avoid; }
            .pdf-box div { display: flex; justify-content: space-between; gap: 10px; }
            .pdf-box span { color: #475569; }
            .pdf-box .pdf-wide { grid-column: 1 / -1; }
            .pdf-highlight { color: #e31e24; }
            .pdf-totals { margin-top: 12px; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; break-inside: avoid; page-break-inside: avoid; }
            .pdf-totals div { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
            .pdf-totals .pdf-total { font-size: 14px; font-weight: 700; color: #e31e24; }
        </style>
        <div class="pdf-header">
            <img class="pdf-logo" src="logo.png" alt="Hiper Roll">
            <div class="pdf-title">
                <h1>Proposta de pedido</h1>
                <p>Hiperroll · Portal de Preços</p>
            </div>
            <div class="pdf-meta">
                <div><strong>Pedido nº:</strong> ${escapeHtml(orderNumber)}</div>
                <div><strong>Data:</strong> ${escapeHtml(dateStr)}</div>
            </div>
        </div>

        <div class="pdf-box">
            <div><span>Pedido Hiper Roll</span><strong class="pdf-highlight">${escapeHtml(orderNumberHiperroll)}</strong></div>
            <div><span>Pedido do cliente</span><strong>${escapeHtml(orderNumberClient || 'Não informado')}</strong></div>
            <div><span>Cliente</span><strong>${escapeHtml(clientName)}</strong></div>
            <div><span>Representante</span><strong>${escapeHtml(representativeName)}</strong></div>
            <div><span>Validade da proposta</span><strong>${escapeHtml(proposalValidity)}</strong></div>
            <div><span>Status</span><strong>${escapeHtml(status.label)}</strong></div>
        </div>

        <div class="pdf-box">
            <div><span>Desconto do pedido</span><strong>${formatPercent(pricing.discountPercent)}</strong></div>
            <div><span>Contrato</span><strong>${formatPercent(pricing.conditions.contract)}</strong></div>
            <div class="pdf-wide"><span>Condições comerciais</span><strong>${pdfConditions.length ? escapeHtml(pdfConditions.join(' · ')) : 'Nenhuma'}</strong></div>
            <div><span>Peso total</span><strong>${formatBRL(pricing.totalWeight, 3)} kg</strong></div>
            <div><span>Total FOB</span><strong>${formatCurrency(pricing.totalFob)}</strong></div>
            <div><span>Total CIF</span><strong>${formatCurrency(totalCif)}</strong></div>
            <div><span>Margem do pedido</span><strong>${formatPercent(pricing.margin)}</strong></div>
        </div>

        <table>
            <colgroup>
                <col width="8%"><col width="36%"><col width="5%"><col width="7%"><col width="8%">
                <col width="8%"><col width="7%"><col width="8%"><col width="5%"><col width="8%">
            </colgroup>
            <thead>
                <tr>
                    <th>Cód.</th><th>Descrição</th><th class="pdf-num">Qtd</th><th class="pdf-num">Peso</th>
                    <th class="pdf-num">FOB unit.</th><th class="pdf-num">CIF unit.</th><th class="pdf-num">Desc. unit.</th>
                    <th class="pdf-num">Preço neg.</th><th class="pdf-num">Margem</th><th class="pdf-num">Subtotal</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>

        <div class="pdf-totals">
            <div><span>Produtos (itens distintos)</span><strong>${cart.length}</strong></div>
            <div><span>Quantidade total</span><strong>${totalQuantity}</strong></div>
            <div><span>Valor negociado (sem desconto do pedido e contrato)</span><strong>${formatCurrency(totalNegotiatedNoAdjust)}</strong></div>
            <div><span>Descontos por item (R$)</span><strong>${formatCurrency(totalDiscounts)}</strong></div>
            <div><span>Valor total (com desconto e contrato)</span><span class="pdf-total">${formatCurrency(totalCif)}</span></div>
            <div><span>Economia (negociado − total)</span><strong>${formatCurrency(totalNegotiatedNoAdjust - totalCif)}</strong></div>
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

    // Visual feedback while the file is generated; the button gets its own label back afterwards.
    const btn = document.querySelector('.btn-export');
    const originalLabel = btn ? btn.innerHTML : '';
    const restoreButton = () => {
        if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
    };
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
                restoreButton();
            }).catch((err) => {
                console.error('html2pdf error:', err);
                restoreButton();
                enablePdfPrintFallback(pdfNode);
                window.print();
            });
        } catch (e) {
            console.warn('Export fallback, reason:', e.message);
            restoreButton();
            enablePdfPrintFallback(pdfNode);
            window.print();
        }
    }, 250);
}
