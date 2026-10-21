// Lixeira: pedidos excluídos, restaurar e excluir definitivamente.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// ========== LIXEIRA ==========
function describeBillingProgress(order) {
    const cartItems = Array.isArray(order.cart) ? order.cart : [];
    const billed = order.billedQuantities || {};
    const ordered = cartItems.reduce((sum, item) => sum + (item.qty || 0), 0);
    const done = cartItems.reduce((sum, item) => sum + (billed[item.codigo] || 0), 0);
    if (done === 0) return '—';
    return done >= ordered ? 'Completo' : 'Parcial';
}

function showTrashModal() {
    const deletedSubmissions = deletedSubmissionsManager.getAll();

    if (deletedSubmissions.length === 0) {
        alert('A lixeira está vazia.');
        return;
    }

    const rows = deletedSubmissions.map(deletion => {
        const id = escapeHtml(deletion.id);
        return `
            <tr>
                <td class="col-toggle">
                    <button class="btn btn--icon btn--ghost trash-expand-btn" data-id="${id}" onclick="toggleTrashDetails('${id}')" aria-expanded="false" aria-label="Ver itens">${icon('chevron-down')}</button>
                </td>
                <td><strong>${escapeHtml(deletion.orderNumber || '—')}</strong></td>
                <td>${escapeHtml(deletion.clientName || '—')}</td>
                <td>${renderStatusChip(deletion.status)}</td>
                <td>${describeBillingProgress(deletion)}</td>
                <td>${escapeHtml(formatDateTime(deletion.deletedAt))}<div class="muted">por ${escapeHtml(deletion.deletedBy || 'Sistema')}</div></td>
                <td class="col-actions">
                    <button class="btn btn--secondary btn--sm" onclick="restoreSubmission('${id}')">${icon('rotate')}Restaurar</button>
                    <button class="btn btn--ghost btn--sm btn--danger-text" onclick="permanentlyDeleteSubmission('${id}')">${icon('trash')}Excluir</button>
                </td>
            </tr>
            <tr id="trash-details-${id}" class="details-row" hidden>
                <td colspan="7"><div id="trash-details-content-${id}"></div></td>
            </tr>`;
    }).join('');

    const trashContent = document.getElementById('trashContent');
    if (trashContent) {
        trashContent.innerHTML = `
            <div class="table-wrap">
                <table class="table">
                    <thead>
                        <tr>
                            <th class="col-toggle"></th>
                            <th>Pedido</th>
                            <th>Cliente</th>
                            <th>Status</th>
                            <th>Faturamento</th>
                            <th>Excluído em</th>
                            <th class="col-actions">Ações</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        document.getElementById('trashModal').style.display = 'flex';
    }
}

function toggleTrashDetails(deletionId) {
    const detailsRow = document.getElementById(`trash-details-${deletionId}`);
    if (!detailsRow) return;
    const btn = document.querySelector(`.trash-expand-btn[data-id="${CSS.escape(deletionId)}"]`);
    const opening = detailsRow.hidden;
    detailsRow.hidden = !opening;
    if (opening) renderTrashDetails(deletionId, deletedSubmissionsManager.getById(deletionId));
    if (btn) {
        btn.setAttribute('aria-expanded', String(opening));
        btn.classList.toggle('is-open', opening);
    }
}

function renderTrashDetails(deletionId, deletion) {
    const contentDiv = document.getElementById(`trash-details-content-${deletionId}`);
    if (!contentDiv || !deletion || !deletion.cart) return;

    // Same rule as everywhere else (with the order's discounts and contract).
    const totals = calculateOrderTotals(deletion.cart, deletion.conditions);
    const rows = totals.lines.map(line => {
        const item = line.item;
        const billedQty = deletion.billedQuantities?.[item.codigo] || 0;
        return `
            <tr>
                <td class="cell-product"><strong>${escapeHtml(item.codigo)}</strong><span>${escapeHtml(item.descricao || '')}</span></td>
                <td class="num">${line.qty}</td>
                <td class="num">${billedQty} / ${line.qty}</td>
                <td class="num">${formatCurrency(line.negotiatedUnit)}</td>
                <td class="num">${formatCurrency(line.subtotal)}</td>
                <td class="num tone-${line.status.tone}">${formatPercent(line.marginPercent)}</td>
            </tr>`;
    }).join('');

    contentDiv.innerHTML = `
        <table class="table table--compact">
            <thead>
                <tr><th>Produto</th><th class="num">Qtd</th><th class="num">Faturado</th><th class="num">Valor unit.</th><th class="num">Subtotal</th><th class="num">Margem</th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="kv-row">
            <span>Total do pedido <strong>${formatCurrency(totals.totalInvoice)}</strong></span>
            ${deletion.representativeName ? `<span>Representante <strong>${escapeHtml(deletion.representativeName)}</strong></span>` : ''}
            ${deletion.submittedAt ? `<span>Enviado em <strong>${escapeHtml(formatDateTime(deletion.submittedAt))}</strong></span>` : ''}
        </div>`;
}

function closeTrashModal() {
    const modal = document.getElementById('trashModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function restoreSubmission(submissionId) {
    if (!confirm('Deseja restaurar este pedido como rascunho?')) return;

    try {
        await deletedSubmissionsManager.restore(submissionId);
        afterOrdersChanged();
        alert('Pedido restaurado como rascunho.');
        closeTrashModal();
        if (deletedSubmissionsManager.count() > 0) showTrashModal();
    } catch (e) {
        alert(e.message);
    }
}

async function permanentlyDeleteSubmission(submissionId) {
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita. O pedido será excluído definitivamente.')) return;

    try {
        await deletedSubmissionsManager.permanentlyDelete(submissionId);
        updateTrashBadge();
        alert('Pedido excluído definitivamente.');
        closeTrashModal();
        if (deletedSubmissionsManager.count() > 0) showTrashModal();
    } catch (e) {
        alert(e.message);
    }
}

async function emptyTrash() {
    const count = deletedSubmissionsManager.count();
    if (count === 0) {
        alert('A lixeira já está vazia.');
        return;
    }
    if (!confirm(`Tem certeza? Os pedidos da lixeira serão excluídos definitivamente. Esta ação não pode ser desfeita.`)) return;

    try {
        const result = await deletedSubmissionsManager.emptyTrash();
        closeTrashModal();
        afterOrdersChanged();
        let message = `${result.deleted} pedido(s) excluído(s) definitivamente.`;
        if (result.kept > 0) {
            message += `\n\n${result.kept} pedido(s) em análise ou aprovados foram mantidos: somente o gestor pode excluí-los.`;
        }
        alert(message);
    } catch (e) {
        alert(e.message);
    }
}

function updateTrashBadge() {
    const trashBtn = document.getElementById('trashButton');
    if (!trashBtn) return;
    
    const count = deletedSubmissionsManager.count();
    if (count > 0) {
        let badge = trashBtn.querySelector('.trash-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'count-badge trash-badge';
            trashBtn.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        const badge = trashBtn.querySelector('.trash-badge');
        if (badge) badge.remove();
    }
}
