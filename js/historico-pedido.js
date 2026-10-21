// Histórico de cada pedido (botão Histórico, vindo do servidor) e backup.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)

// ========== HISTÓRICO DO PEDIDO ==========

// What each server record (audit_log action, without the "order." prefix) looks like in the list.
const ORDER_HISTORY_EVENTS = Object.freeze({
    save_draft: { label: 'Rascunho salvo', icon: 'edit', tone: 'draft' },
    submit: { label: 'Enviado para análise', icon: 'send', tone: 'review' },
    approve: { label: 'Aprovado', icon: 'check-circle', tone: 'approved' },
    reject: { label: 'Rejeitado', icon: 'x-circle', tone: 'rejected' },
    billing: { label: 'Faturamento registrado', icon: 'package', tone: 'approved' },
    note: { label: 'Observação do gestor atualizada', icon: 'message', tone: 'neutral' },
    trash: { label: 'Movido para a lixeira', icon: 'trash', tone: 'neutral' },
    restore: { label: 'Restaurado da lixeira (voltou a rascunho)', icon: 'rotate', tone: 'draft' }
});

// Saving the same draft several times in a row becomes one line with a counter.
function groupOrderHistory(entries) {
    const grouped = [];
    (Array.isArray(entries) ? entries : []).forEach(entry => {
        const last = grouped[grouped.length - 1];
        if (last && entry.action === 'save_draft' && last.action === 'save_draft' && last.username === entry.username) {
            last.at = entry.at;
            last.count++;
        } else {
            grouped.push({ ...entry, count: 1 });
        }
    });
    return grouped;
}

function renderOrderHistory(entries) {
    const grouped = groupOrderHistory(entries);
    if (grouped.length === 0) {
        return '<div class="status-history-empty">Nenhum registro encontrado para este pedido.</div>';
    }
    // Newest first.
    const items = grouped.reverse().map(entry => {
        const event = ORDER_HISTORY_EVENTS[entry.action] || { label: entry.action, icon: 'info', tone: 'neutral' };
        const who = entry.displayName || entry.username;
        return `
            <li class="status-history-item status-history-item--${event.tone}">
                <span class="timeline-dot">${icon(event.icon)}</span>
                <div>
                    <div class="status-history-title">${escapeHtml(event.label)}${entry.count > 1 ? ` (${entry.count} vezes)` : ''}</div>
                    <div class="status-history-meta">${escapeHtml(formatDateTime(entry.at))}${who ? ` · ${escapeHtml(who)}` : ''}</div>
                    ${entry.reason ? `<div class="status-history-meta">Motivo: <em>${escapeHtml(entry.reason)}</em></div>` : ''}
                </div>
            </li>
        `;
    }).join('');
    return `<ol class="timeline">${items}</ol>`;
}

let statusHistoryRequest = 0;

// Without an id it shows the order loaded in the form. The list always comes from the server,
// so the representative and the gestor see the same thing on any computer.
async function showStatusHistory(orderId = activeDraftId) {
    const modal = document.getElementById('statusHistoryModal');
    const historyList = document.getElementById('statusHistoryList');
    const orderLabel = document.getElementById('statusHistoryOrder');
    const order = orderId ? orderSubmissionManager.getById(orderId) : null;
    const message = text => `<div class="status-history-empty">${escapeHtml(text)}</div>`;
    const requestId = ++statusHistoryRequest;

    if (orderLabel) orderLabel.textContent = order ? `Pedido ${order.orderNumber || order.hiperrollNumber || ''}` : '';
    modal.style.display = 'flex';

    if (!orderId) {
        historyList.innerHTML = message('Este pedido ainda não foi salvo. O histórico começa quando você salva o rascunho ou envia o pedido.');
        return;
    }

    historyList.innerHTML = message('Carregando histórico...');
    let html;
    try {
        const data = await apiRequest('orders.history', { query: { id: orderId } });
        html = renderOrderHistory(data.history);
    } catch (e) {
        html = message(e.message);
    }
    // Another order may have been opened while this answer was on its way.
    if (requestId === statusHistoryRequest) historyList.innerHTML = html;
}

function closeStatusHistory() {
    const modal = document.getElementById('statusHistoryModal');
    modal.style.display = 'none';
}

// The browser downloads the file directly; the session cookie authorizes it (gestor/admin only).
function exportPortalBackup() {
    if (!authManager.canManageUsers()) {
        alert('Somente o gestor ou o administrador podem baixar o backup.');
        return;
    }
    window.location.href = `${API_BASE}?action=backup.export`;
}

window.exportPortalBackup = exportPortalBackup;

// Fechar modal ao clicar fora
window.addEventListener('load', function() {
    const modal = document.getElementById('statusHistoryModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeStatusHistory();
            }
        });
    }
});

