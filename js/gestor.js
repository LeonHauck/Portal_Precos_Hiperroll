// Gestor: detalhes do pedido, aprovações e rejeições.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// Orders in the gestor's views may also be in the trash (an order under analysis that the
// representative deleted still needs a decision).
function findOrderAnywhere(submissionId) {
    return orderSubmissionManager.getById(submissionId) || deletedSubmissionsManager.getById(submissionId);
}

// Plain-text summary (alert); kept for quick checks from the browser console.
function showSubmissionDetails(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const discountParts = describeOrderDiscounts(pricing.conditions);
    const status = ORDER_STATUS[submission.status] || { label: submission.status };
    const timestamp = submission.status === 'rascunho' ? submission.savedAt : submission.submittedAt;

    alert(`Pedido: ${submission.orderNumber}
Cliente: ${submission.clientName}
Representante: ${describeOrderAuthor(submission)}
Status: ${status.label}
Descontos: ${discountParts.length ? `${formatPercent(pricing.discountPercent)} (${discountParts.join(' + ')})` : 'Nenhum'}
Margem do pedido: ${formatPercent(pricing.margin)} (${pricing.status.label})
Valor total do pedido: ${formatCurrency(pricing.totalInvoice)}
${pricing.requiresJustification ? `Alerta: ${pricing.alerts.join('. ')}\nJustificativa: ${pricing.conditions.lowMarginJustification || '(não informada)'}\n` : ''}${submission.status === 'rascunho' ? 'Salvo em' : 'Enviado em'}: ${formatDateTime(timestamp)}
${submission.rejectionReason ? `Motivo da rejeição: ${submission.rejectionReason}\n` : ''}${submission.supervisorNote ? `Observação do gestor: ${submission.supervisorNote}` : ''}`);
}

// Header line used by the gestor's modals: who sent it, when, for whom.
function describeOrderOrigin(submission) {
    const timestamp = submission.status === 'rascunho' ? submission.savedAt : submission.submittedAt;
    return `${escapeHtml(submission.clientName || 'Cliente não informado')} · ${escapeHtml(describeOrderAuthor(submission))} · ${escapeHtml(formatDateTime(timestamp))}`;
}

function openSupervisorOrderActions(submissionId) {
    const submission = findOrderAnywhere(submissionId);
    if (!submission) return;
    if (!authManager.isGestor()) {
        alert('Acesso negado. Somente o gestor pode gerenciar este pedido.');
        return;
    }

    const existing = document.getElementById('supervisorActionModalBackdrop');
    if (existing) existing.remove();

    const id = escapeHtml(submission.id);
    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const canDecide = submission.status === 'analise';
    const decisionAttrs = canDecide ? '' : 'disabled title="Somente pedidos em análise podem ser aprovados ou rejeitados"';

    const backdrop = document.createElement('div');
    backdrop.id = 'supervisorActionModalBackdrop';
    backdrop.className = 'modal-backdrop modal-backdrop--top is-open';
    backdrop.innerHTML = `
        <div class="modal-panel modal-panel--md">
            <div class="modal-header">
                <div class="modal-header-title">
                    <span class="modal-icon">${icon('check-circle')}</span>
                    <div>
                        <h3 class="modal-title">Pedido ${escapeHtml(submission.orderNumber || 'sem número')} ${renderStatusChip(submission.status)}</h3>
                        <p class="modal-subtitle">${describeOrderOrigin(submission)}</p>
                    </div>
                </div>
                <button onclick="closeSupervisorActionModal()" class="modal-close-btn" aria-label="Fechar">${icon('x')}</button>
            </div>
            <div class="modal-body form-stack">
                ${renderOrderConditionsSummary(submission)}
                ${renderOrderItemsTable(submission)}
                <p class="total-line">Total do pedido: <strong>${formatCurrency(pricing.totalInvoice)}</strong></p>
                <div class="field">
                    <label for="supervisorActionNote">Observação do gestor</label>
                    <textarea id="supervisorActionNote" rows="3">${escapeHtml(submission.supervisorNote || '')}</textarea>
                </div>
                <div class="field">
                    <label for="supervisorActionRejectionReason">Motivo da rejeição</label>
                    <textarea id="supervisorActionRejectionReason" rows="3" placeholder="Preencha apenas se for rejeitar.">${escapeHtml(submission.rejectionReason || '')}</textarea>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="handleSupervisorAction('${id}', 'saveNote')" class="btn btn--ghost modal-footer__start">${icon('message')}Salvar observação</button>
                <button onclick="handleSupervisorAction('${id}', 'reject')" class="btn btn--danger" ${decisionAttrs}>${icon('x-circle')}Rejeitar</button>
                <button onclick="handleSupervisorAction('${id}', 'approve')" class="btn btn--success" ${decisionAttrs}>${icon('check-circle')}Aprovar</button>
            </div>
        </div>
    `;
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeSupervisorActionModal(); });
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
    } catch (e) {
        console.error('Erro ao atualizar painel supervisor:', e);
        const list = document.getElementById('supervisorPendingOrdersList');
        if (list) list.innerHTML = '<div class="empty-state empty-state--compact tone-bad">Erro ao carregar pedidos. Verifique o console (F12).</div>';
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

// One order in the approval queue: what the gestor needs to decide without opening it.
function renderPendingOrder(submission) {
    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const totalItems = (Array.isArray(submission.cart) ? submission.cart : []).reduce((sum, item) => sum + (item.qty || 0), 0);
    const id = escapeHtml(submission.id);
    const chips = [];
    if (!orderSubmissionManager.getById(submission.id)) {
        chips.push(`<span class="chip">${icon('trash')}Na lixeira</span>`);
    }
    if (pricing.requiresJustification) {
        // Hover shows what broke the rule and the representative's justification.
        const title = `${pricing.alerts.join('. ')}. Justificativa: ${pricing.conditions.lowMarginJustification || 'sem justificativa'}`;
        const label = pricing.discountExceeded ? `Desconto ${formatPercent(pricing.effectiveDiscount)}` : `Margem ${formatPercent(pricing.margin)}`;
        chips.push(`<span class="chip chip--rejected low-margin-badge" title="${escapeHtml(title)}">${icon('alert')}${label}</span>`);
    }
    if (pricing.modeNotice) {
        chips.push(`<span class="chip chip--warn mode-notice-badge" title="${escapeHtml(pricing.modeNotice)}">${icon('pin')}${escapeHtml(pricing.mode.short)}</span>`);
    }
    return `
        <div class="pending-item">
            <input type="checkbox" class="pending-order-checkbox" value="${id}" aria-label="Selecionar pedido ${escapeHtml(submission.orderNumber || '')}">
            <div class="pending-item__main">
                <div class="pending-item__title">Pedido ${escapeHtml(submission.orderNumber || 'sem número')} ${chips.join('')}</div>
                <div class="pending-item__meta">${describeOrderOrigin(submission)} · ${totalItems} item(ns)</div>
                <div class="pending-item__figures">
                    <span>Total <strong>${formatCurrency(pricing.totalInvoice)}</strong></span>
                    <span>Desconto <strong>${formatPercent(pricing.effectiveDiscount)}</strong></span>
                    <span>Margem <strong class="tone-${pricing.status.tone}">${formatPercent(pricing.margin)}</strong></span>
                </div>
            </div>
            <button onclick="showPendingOrderDetails('${id}')" class="btn btn--ghost btn--sm">${icon('eye')}Detalhes</button>
        </div>`;
}

function updateSupervisorPanel() {
    refreshMissedForecastDates();
    const btn = document.getElementById('supervisorBtn');
    if (btn) btn.hidden = !authManager.isGestor();
    const pendingList = document.getElementById('supervisorPendingOrdersList');
    if (!pendingList) return;

    // Orders in analysis, plus the ones the representative deleted while still in analysis/approved.
    const deletedInAnalysis = deletedSubmissionsManager.getAll().filter(deletion => ['analise', 'aprovado'].includes(deletion.status));
    const pending = [...orderSubmissionManager.getPending(), ...deletedInAnalysis]
        .filter((item, index, self) => index === self.findIndex(t => t.id === item.id))
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    if (pending.length === 0) {
        const emptyMessage = authManager.isGestor()
            ? 'Nenhum pedido aguardando aprovação no momento.'
            : 'Somente o gestor visualiza a fila de aprovação.';
        pendingList.innerHTML = `<div class="empty-state empty-state--compact">${icon('check-circle')}${emptyMessage}</div>`;
        return;
    }

    pendingList.innerHTML = `
        <div class="pending-items">${pending.map(renderPendingOrder).join('')}</div>
        <div class="decision-box">
            <div class="field">
                <label for="supervisorObservationTextarea">Observação do gestor (opcional)</label>
                <textarea id="supervisorObservationTextarea" rows="2"></textarea>
            </div>
            <div class="field">
                <label for="rejectionReasonTextarea">Motivo da rejeição (só para rejeitar)</label>
                <textarea id="rejectionReasonTextarea" rows="2"></textarea>
            </div>
            <div class="decision-box__actions">
                <button onclick="rejectPendingOrders()" class="btn btn--danger">${icon('x-circle')}Rejeitar selecionados</button>
                <button onclick="approvePendingOrders()" class="btn btn--success">${icon('check-circle')}Aprovar selecionados</button>
            </div>
        </div>`;
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
    const submission = findOrderAnywhere(submissionId);
    if (!submission) return;

    const existing = document.getElementById('detailsModalBackdrop');
    if (existing) existing.remove();

    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const backdrop = document.createElement('div');
    backdrop.id = 'detailsModalBackdrop';
    backdrop.className = 'modal-backdrop modal-backdrop--top is-open';
    backdrop.innerHTML = `
        <div class="modal-panel modal-panel--lg">
            <div class="modal-header">
                <div class="modal-header-title">
                    <span class="modal-icon">${icon('file')}</span>
                    <div>
                        <h3 class="modal-title">Pedido ${escapeHtml(submission.orderNumber || 'sem número')}</h3>
                        <p class="modal-subtitle">${describeOrderOrigin(submission)} · validade: ${escapeHtml(submission.proposalValidity || 'não informada')}</p>
                    </div>
                </div>
                <button onclick="document.getElementById('detailsModalBackdrop').remove()" class="modal-close-btn" aria-label="Fechar">${icon('x')}</button>
            </div>
            <div class="modal-body form-stack">
                ${renderOrderConditionsSummary(submission)}
                ${renderOrderItemsTable(submission, { showBilling: true })}
                <div class="kv-row kv-row--totals">
                    <span>Margem do pedido <strong class="tone-${pricing.status.tone}">${formatPercent(pricing.margin)}</strong> <span class="muted">(${pricing.status.label})</span></span>
                    <span>Valor total <strong>${formatCurrency(pricing.totalInvoice)}</strong></span>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="document.getElementById('detailsModalBackdrop').remove()" class="btn btn--secondary">Fechar</button>
            </div>
        </div>
    `;
    backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
}
