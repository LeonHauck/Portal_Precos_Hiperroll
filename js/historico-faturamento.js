// Abas, aba Histórico e Entregas e faturamento.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// ========== ABAS ==========

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');
    const btn = document.getElementById('btn-' + tabId);
    if (btn) btn.classList.add('active');

    if (tabId === 'tab-history') {
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        renderHistoryTab();
    }
    if (tabId === 'tab-pricing') {
        renderPricingTab();
    }
}

// ========== ABA PEDIDOS E ENTREGAS ==========

// Billing forecast of an approved order that is not fully billed yet (null otherwise).
function describeBillingForecast(submission) {
    const value = submission.predictedBillingDate ? new Date(submission.predictedBillingDate) : null;
    if (!value || Number.isNaN(value.getTime()) || submission.status !== 'aprovado' || submission.billingStatus === 'completo') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = today > new Date(value.getFullYear(), value.getMonth(), value.getDate());
    return { date: value.toLocaleDateString('pt-BR'), overdue };
}

// One order of the list: a summary line (number, client, total, status) that opens the details.
function renderOrderRow(submission, isGestor) {
    const id = escapeHtml(submission.id);
    const isDraft = submission.status === 'rascunho';
    const isOwnOrder = submission.ownerId === authManager.getCurrentUserId();
    const pricing = calculateOrderTotals(submission.cart, submission.conditions);
    const billingStatus = submission.billingStatus || (submission.status === 'aprovado' ? 'pendente' : null);
    const forecast = describeBillingForecast(submission);
    const showBilling = submission.status === 'aprovado' || Boolean(submission.billedQuantities && Object.keys(submission.billedQuantities).length);

    const chips = [renderStatusChip(submission.status)];
    if (billingStatus) chips.push(renderBillingChip(billingStatus));
    if (forecast) {
        chips.push(forecast.overdue
            ? `<span class="chip chip--rejected">${icon('alert')}Faturamento atrasado: ${forecast.date}</span>`
            : `<span class="chip chip--info">${icon('clock')}Previsão: ${forecast.date}</span>`);
    }

    const notes = [];
    if (submission.status === 'rejeitado' && submission.rejectionReason) {
        notes.push(`<div class="alert alert--danger">${icon('x-circle')}<div><strong>Motivo da rejeição</strong><div>${escapeHtml(submission.rejectionReason)}</div></div></div>`);
    }
    if (submission.supervisorNote) {
        notes.push(`<div class="alert alert--info">${icon('message')}<div><strong>Observação do gestor</strong><div>${escapeHtml(submission.supervisorNote)}</div></div></div>`);
    }

    const cartArray = Array.isArray(submission.cart) ? submission.cart : [];
    const totalOrdered = cartArray.reduce((sum, item) => sum + (item.qty || 0), 0);
    const totalBilled = cartArray.reduce((sum, item) => sum + ((submission.billedQuantities && submission.billedQuantities[item.codigo]) || 0), 0);
    const billingFacts = [];
    if (billingStatus) billingFacts.push(`<span>Faturado <strong>${totalBilled} de ${totalOrdered}</strong> unidades</span>`);
    if (forecast) billingFacts.push(`<span class="${forecast.overdue ? 'tone-bad' : ''}">${forecast.overdue ? 'Faturamento atrasado' : 'Previsão de faturamento'} <strong>${forecast.date}</strong></span>`);
    const billingHistory = (Array.isArray(submission.billingHistory) ? submission.billingHistory : []).map(entry =>
        `<li>Faturado em ${escapeHtml(formatDate(entry.date))} · próxima etapa: <strong>${entry.predictedNextDate ? escapeHtml(formatDate(entry.predictedNextDate)) : 'concluído'}</strong></li>`).join('');

    const actions = [];
    if (isDraft && isOwnOrder) {
        actions.push(`<button data-action="loadDraft" data-id="${id}" class="btn btn--secondary btn--sm">${icon('edit')}Continuar rascunho</button>`);
    } else if (!isDraft) {
        actions.push(`<button data-action="repeatOrder" data-id="${id}" class="btn btn--ghost btn--sm">${icon('repeat')}Repetir pedido</button>`);
    }
    actions.push(`<button data-action="showStatusHistory" data-id="${id}" class="btn btn--ghost btn--sm">${icon('clock')}Histórico</button>`);
    if (isGestor && submission.status === 'analise') {
        actions.push(`<button data-action="openSupervisorOrderActions" data-id="${id}" class="btn btn--secondary btn--sm">${icon('check-circle')}Analisar pedido</button>`);
    }
    if (isGestor && submission.status === 'aprovado' && submission.billingStatus !== 'completo') {
        actions.push(`<button data-action="openBillingModal" data-id="${id}" class="btn btn--secondary btn--sm">${icon('package')}Faturar / anexar NF</button>`);
    }
    actions.push(`<button data-action="deleteSubmission" data-id="${id}" class="btn btn--ghost btn--sm btn--danger-text">${icon('trash')}Excluir</button>`);

    return `
        <details class="order-row" id="historyCard_${id}">
            <summary class="order-row__summary">
                <span class="order-row__id">
                    <strong>Pedido ${escapeHtml(submission.orderNumber || 'sem número')}</strong>
                    <span class="muted">${escapeHtml(formatDateTime(submission.submittedAt || submission.savedAt))}</span>
                </span>
                <span class="order-row__client">
                    <strong>${escapeHtml(submission.clientName || 'Cliente não informado')}</strong>
                    <span class="muted">${escapeHtml(describeOrderAuthor(submission))}</span>
                </span>
                <span class="order-row__total">${formatCurrency(pricing.totalInvoice)}</span>
                <span class="order-row__chips">${chips.join('')}</span>
                ${icon('chevron-down', 'order-row__chevron')}
            </summary>
            <div class="order-row__body">
                ${renderOrderConditionsSummary(submission)}
                ${renderOrderItemsTable(submission, { showBilling })}
                <div class="kv-row">
                    <span>Validade da proposta <strong>${escapeHtml(normalizeProposalValidity(submission.proposalValidity || '') || 'não informada')}</strong></span>
                    ${billingFacts.join('')}
                </div>
                ${notes.join('')}
                ${billingHistory ? `<ul class="plain-list">${billingHistory}</ul>` : ''}
                ${submission.invoices && submission.invoices.length ? `<div class="invoice-links">${renderInvoiceLinks(submission)}</div>` : ''}
                <div class="order-row__actions">${actions.join('')}</div>
            </div>
        </details>`;
}

function renderHistoryTab() {
  try {
    refreshMissedForecastDates();
    const historyContainer = document.getElementById('historyTabContent');
    if (!historyContainer) { console.error('historyTabContent não encontrado'); return; }
    const searchTerm = (document.getElementById('historySearchInput')?.value || '').toLowerCase();
    const isGestor = authManager.isGestor();

    // The server already returns only what this user may see (gestor: everyone's orders).
    let submissions = orderSubmissionManager.getAll().sort((a, b) =>
        new Date(b.submittedAt || b.savedAt || 0) - new Date(a.submittedAt || a.savedAt || 0));

    if (searchTerm) {
        submissions = submissions.filter(s => [s.orderNumber, s.clientName, s.representativeName, s.submittedBy, s.savedBy, s.hiperrollNumber]
            .some(value => value && String(value).toLowerCase().includes(searchTerm)));
    }

    if (submissions.length === 0) {
        const emptyMessage = authManager.getCurrentUser()
            ? 'Nenhum pedido encontrado.'
            : 'Faça login para carregar o histórico de pedidos.';
        historyContainer.innerHTML = `<div class="empty-state">${icon('list')}${emptyMessage}</div>`;
        return;
    }

    const scopeNote = isGestor ? 'Pedidos de todos os representantes' : 'Seus pedidos e rascunhos';
    historyContainer.innerHTML = `<p class="list-caption">${scopeNote} · ${submissions.length} pedido(s). Clique em um pedido para ver os detalhes.</p>`
        + submissions.map(submission => renderOrderRow(submission, isGestor)).join('');
  } catch (e) {
    console.error('Erro ao renderizar histórico:', e);
    const hc = document.getElementById('historyTabContent');
    if (hc) hc.innerHTML = `<div class="empty-state tone-bad"><strong>Erro ao carregar os pedidos:</strong> ${escapeHtml(e.message)}</div>`;
  }
}

// Faturamento Modal (Supervisor)
function openBillingModal(submissionId) {
    const submission = orderSubmissionManager.getById(submissionId);
    if (!submission) return;

    const itemsHtml = (Array.isArray(submission.cart) ? submission.cart : []).map((item, idx) => {
        const billed = (submission.billedQuantities && submission.billedQuantities[item.codigo]) || 0;
        const remaining = item.qty - billed;
        if (remaining <= 0) return '';
        return `
            <div class="billing-item">
                <div class="cell-product">
                    <strong>${escapeHtml(item.codigo)}</strong>
                    <span>${escapeHtml(item.descricao || '')}</span>
                    <span class="muted">Pedido: ${item.qty} · Já faturado: ${billed} · Restante: ${remaining}</span>
                </div>
                <input type="number" id="billQty_${idx}" class="input-sm w-qty bill-qty-input" data-codigo="${escapeHtml(item.codigo)}" data-max="${remaining}" value="${remaining}" min="0" max="${remaining}" aria-label="Quantidade a faturar de ${escapeHtml(item.codigo)}">
            </div>`;
    }).join('');

    const modalId = 'billingModalDynamic';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-backdrop modal-backdrop--top is-open';
    modal.innerHTML = `
        <div class="modal-panel modal-panel--sm">
            <div class="modal-header">
                <div class="modal-header-title">
                    <span class="modal-icon">${icon('package')}</span>
                    <div>
                        <h3 class="modal-title">Registrar faturamento</h3>
                        <p class="modal-subtitle">Pedido ${escapeHtml(submission.orderNumber || '')}</p>
                    </div>
                </div>
                <button data-action="removeModal" class="modal-close-btn" aria-label="Fechar">${icon('x')}</button>
            </div>
            <div class="modal-body form-stack">
                <div class="billing-items">${itemsHtml || '<div class="empty-state empty-state--compact">Todos os itens já foram faturados.</div>'}</div>
                <div class="field">
                    <label for="billingInvoiceFile">Nota fiscal (PDF ou imagem, até 2 MB)</label>
                    <input type="file" id="billingInvoiceFile" accept="application/pdf,image/*">
                </div>
            </div>
            <div class="modal-footer">
                <button data-action="removeModal" class="btn btn--ghost">Cancelar</button>
                <button data-action="submitBilling" data-id="${escapeHtml(submissionId)}" class="btn btn--primary">${icon('check')}Confirmar faturamento</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo da nota fiscal.'));
        reader.readAsDataURL(file);
    });
}

async function submitBilling(submissionId) {
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
        alert('Informe alguma quantidade ou anexe uma Nota Fiscal.');
        return;
    }
    if (file && file.size > 2 * 1024 * 1024) {
        alert('A nota fiscal deve ter no máximo 2 MB.');
        return;
    }

    try {
        const dataUrl = file ? await readFileAsDataUrl(file) : null;
        await orderSubmissionManager.registerBilling(submissionId, billedMap, dataUrl, file ? file.name : null);
        document.getElementById('billingModalDynamic').remove();
        renderHistoryTab();
        alert('Faturamento registrado com sucesso!');
    } catch (e) {
        alert(e.message);
    }
}

