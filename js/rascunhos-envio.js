// Rascunhos, notas fiscais anexadas, envio do pedido, repetir e excluir pedidos.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

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
        panel.innerHTML = '<div class="empty-state empty-state--compact">Nenhum rascunho salvo ainda.</div>';
        return;
    }

    panel.innerHTML = drafts.map(draft => {
        const totals = calculateOrderTotals(draft.cart, draft.conditions);
        const itemCount = (draft.cart || []).reduce((sum, item) => sum + (item.qty || 0), 0);
        const id = escapeHtml(draft.id);
        return `
            <div class="draft-card ${draft.id === activeDraftId ? 'active' : ''}">
                <div class="draft-card__main">
                    <div class="draft-card-title">${escapeHtml(draft.orderNumber || 'Sem número')} <span class="muted">· ${escapeHtml(draft.clientName || 'Cliente não informado')}</span></div>
                    <div class="draft-card-meta">${itemCount} item(ns) · ${formatCurrency(totals.totalInvoice)} · margem <strong class="tone-${totals.status.tone}">${formatPercent(totals.margin)}</strong> · salvo em ${escapeHtml(formatDateTime(draft.savedAt))}</div>
                </div>
                <div class="draft-card-actions">
                    <button class="btn btn--secondary btn--sm" data-action="loadDraft" data-id="${id}" data-silent="true">${icon('edit')}Carregar</button>
                    <button class="btn btn--primary btn--sm" data-action="prepareDraftForSubmission" data-id="${id}">${icon('send')}Enviar</button>
                    <button class="btn btn--ghost btn--sm" data-action="showDraftModal" data-id="${id}">${icon('eye')}Ver</button>
                    <button class="btn btn--ghost btn--icon btn--danger-text" data-action="deleteSubmission" data-id="${id}" title="Excluir rascunho" aria-label="Excluir rascunho">${icon('trash')}</button>
                </div>
            </div>
        `;
    }).join('');
}

// Formats an attached invoice may have (same list as INVOICE_TYPES in api/lib/orders.php).
const INVOICE_VIEWABLE_TYPES = Object.freeze(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Attached invoices are files on the server. Each one gets two links that go through the API,
// which checks who may see the order: the name opens the PDF/image in another tab and the arrow
// saves it. An entry that still carries the file itself (the local demo keeps it in the browser)
// is opened by openEmbeddedInvoice() instead.
function renderInvoiceLinks(submission) {
    const invoices = Array.isArray(submission.invoices) ? submission.invoices : [];
    return invoices.map((invoice, index) => {
        const name = invoice.name || `NF ${index + 1}`;
        const label = `${icon('file')}${escapeHtml(name)}`;
        const viewTitle = 'title="Abrir a nota fiscal em outra aba"';
        const downloadTitle = `title="Baixar a nota fiscal" aria-label="Baixar ${escapeHtml(name)}"`;
        let view, download;
        if (invoice.data) {
            view = `href="#" data-action="openEmbeddedInvoice" data-id="${escapeHtml(submission.id)}" data-index="${index}"`;
            download = `href="${escapeHtml(invoice.data)}" download="${escapeHtml(`${name}_${submission.orderNumber || ''}`)}"`;
        } else {
            const url = extra => escapeHtml(`${API_BASE}?${new URLSearchParams({ action: 'orders.invoice', id: submission.id, file: invoice.id || '', ...extra })}`);
            view = `href="${url({})}" target="_blank" rel="noopener"`;
            download = `href="${url({ download: 1 })}" target="_blank" rel="noopener"`;
        }
        return `<span class="invoice-chip">`
            + `<a class="invoice-link" ${view} ${viewTitle}>${label}</a>`
            + `<a class="invoice-link invoice-link--download" ${download} ${downloadTitle}>${icon('download')}</a>`
            + `</span>`;
    }).join('');
}

// Demo only: the file is inside the order, so it becomes a temporary address the browser can show.
function openEmbeddedInvoice(submissionId, index) {
    const submission = orderSubmissionManager.getById(submissionId);
    const invoice = submission && Array.isArray(submission.invoices) ? submission.invoices[index] : null;
    const match = invoice && typeof invoice.data === 'string' ? invoice.data.match(/^data:([^;,]+);base64,(.*)$/) : null;
    if (!match || !INVOICE_VIEWABLE_TYPES.includes(match[1])) {
        alert('Não foi possível abrir esta nota fiscal. Use o botão de baixar ao lado do nome.');
        return;
    }
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: match[1] })), '_blank');
}

// "Ver": read-only summary of an order (items, totals and attached invoices).
function showDraftModal(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    const existing = document.getElementById('draftModalBackdrop');
    if (existing) existing.remove();

    const totals = calculateOrderTotals(submission.cart, submission.conditions);
    const rows = totals.lines.map(line => `
        <tr>
            <td class="cell-product"><strong>${escapeHtml(line.item.codigo)}</strong><span>${escapeHtml(line.item.descricao || '')}</span></td>
            <td class="num">${line.qty}</td>
            <td class="num">${formatCurrency(line.negotiatedUnit)}</td>
            <td class="num">${formatCurrency(line.subtotal)}</td>
        </tr>`).join('');
    const invoicesHtml = submission.invoices && submission.invoices.length
        ? `<h4 class="section-label">Notas fiscais</h4><div class="invoice-links">${renderInvoiceLinks(submission)}</div>`
        : '';

    const backdrop = document.createElement('div');
    backdrop.id = 'draftModalBackdrop';
    backdrop.className = 'modal-backdrop is-open';
    backdrop.innerHTML = `
        <div class="modal-panel modal-panel--md">
            <div class="modal-header">
                <div class="modal-header-title">
                    <span class="modal-icon">${icon('file')}</span>
                    <div>
                        <h3 class="modal-title">Pedido ${escapeHtml(submission.orderNumber || 'sem número')}</h3>
                        <p class="modal-subtitle">${escapeHtml(submission.clientName || 'Cliente não informado')}</p>
                    </div>
                </div>
                <button class="modal-close-btn" data-action="removeModal" aria-label="Fechar">${icon('x')}</button>
            </div>
            <div class="modal-body">
                <div class="table-wrap">
                    <table class="table table--compact">
                        <thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Valor unit.</th><th class="num">Subtotal</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <p class="total-line">Total com condições: <strong>${formatCurrency(totals.totalInvoice)}</strong></p>
                ${invoicesHtml}
            </div>
            <div class="modal-footer">
                <button class="btn btn--ghost" data-action="removeModal">Fechar</button>
            </div>
        </div>`;
    backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
}

function populateSubmitOrderDraftSelection() {
    const select = document.getElementById('submitDraftSelect');
    if (!select) return;

    const drafts = getCurrentUserDrafts();
    const currentValue = activeDraftId && drafts.some(draft => draft.id === activeDraftId) ? activeDraftId : '';

    select.innerHTML = '<option value="__new__">Enviar como novo pedido</option>' + drafts.map(draft => {
        const label = `${draft.orderNumber || 'Sem número'} · ${draft.clientName || 'Cliente não informado'}`;
        return `<option value="${escapeHtml(draft.id)}" ${currentValue === draft.id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
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
    if (submitClientName) submitClientName.textContent = clientName || 'Não informado';
    if (submitItemCount) submitItemCount.textContent = cart.length;

    const totals = calculateOrderTotals(cart, getCurrentOrderConditions());
    if (submitTotalCif) submitTotalCif.textContent = formatCurrency(totals.totalInvoice);

    const submitMode = document.getElementById('submitMode');
    if (submitMode) submitMode.textContent = totals.mode ? totals.mode.short : '—';

    const discountParts = describeOrderDiscounts(totals.conditions);
    const submitDiscounts = document.getElementById('submitDiscounts');
    if (submitDiscounts) {
        submitDiscounts.textContent = `${formatPercent(totals.effectiveDiscount)} sobre a tabela`
            + (discountParts.length ? ` (${discountParts.join(' + ')})` : '');
    }

    const submitMargin = document.getElementById('submitMargin');
    if (submitMargin) submitMargin.textContent = `${formatPercent(totals.margin)} (${totals.status.label})`;

    const submitNotice = document.getElementById('submitModeNotice');
    if (submitNotice) {
        submitNotice.hidden = !totals.modeNotice;
        submitNotice.innerHTML = totals.modeNotice ? `${icon('pin')}<span>${escapeHtml(totals.modeNotice)}</span>` : '';
    }

    const summaryBox = document.getElementById('submitSummaryBox');
    const summaryTitle = document.getElementById('submitSummaryTitle');
    if (summaryBox) summaryBox.classList.toggle('is-warning', totals.requiresJustification);
    if (summaryTitle) {
        summaryTitle.textContent = totals.requiresJustification
            ? totals.alerts.join('. ')
            : 'Pedido pronto para envio';
    }

    const lowMarginBlock = document.getElementById('submitLowMarginBlock');
    const justificationInput = document.getElementById('submitLowMarginJustification');
    if (lowMarginBlock) lowMarginBlock.hidden = !totals.requiresJustification;
    if (justificationInput && !totals.requiresJustification) justificationInput.value = '';

    const modal = document.getElementById('submitOrderModal');
    if (modal) modal.style.display = 'flex';
}

function closeSubmitOrderModal() {
    const modal = document.getElementById('submitOrderModal');
    if (modal) modal.style.display = 'none';
    const msg = document.getElementById('submitOrderMessage');
    if (msg) {
        msg.textContent = '';
        msg.className = 'modal-msg';
    }
}

async function submitOrder() {
    if (cart.length === 0) {
        alert('Adicione itens ao pedido antes de enviar.');
        return;
    }

    const selectedDraftValue = document.getElementById('submitDraftSelect')?.value || '';
    const draftIdToUse = selectedDraftValue && selectedDraftValue !== '__new__' ? selectedDraftValue : null;
    const msg = document.getElementById('submitOrderMessage');
    const submitButton = document.querySelector('#submitOrderModal .btn-submit-order');
    if (submitButton) submitButton.disabled = true;

    try {
        const order = await orderSubmissionManager.submitOrder(draftIdToUse, buildCurrentOrderInput({
            lowMarginJustification: document.getElementById('submitLowMarginJustification')?.value || ''
        }));

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
                refreshedMsg.textContent = 'Os preços foram revisados com a tabela nova. Confira a margem e clique em "Enviar pedido" novamente.';
                refreshedMsg.className = 'modal-msg modal-msg--warn';
            }
            return;
        }
        if (msg) {
            msg.textContent = e.message;
            msg.className = 'modal-msg';
        }
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function resetCurrentOrderForm() {
    activeDraftId = null;
    statusManager.setStatus('rascunho');
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
        statusManager.setStatus('rascunho');
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
    statusManager.setStatus('rascunho');
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
    statusManager.setStatus('rascunho');
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
    card.open = true;
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
        confirmMsg += '\n\nAtenção: este pedido está em análise e continua visível para o gestor dar andamento.';
    } else if (submission.status === 'aprovado') {
        confirmMsg += '\n\nAtenção: este pedido já foi aprovado e continua visível para o gestor, para rastreamento.';
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

