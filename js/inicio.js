// Inicialização do portal (init): carrega sessão, tabela de preços e pedidos.
// (Parte do antigo script_v5.js. Ordem de carga: ver Portal_Hiperroll_Final.html.)


async function init() {
    statusManager.init();
    updateTableMarginLabels(null);

    try {
        await authManager.init();
    } catch (e) {
        showLoginModal(e.message);
        return;
    }

    if (!authManager.getCurrentUser()) {
        showLoginModal();
        return;
    }
    if (authManager.mustChangePassword()) {
        showLoginModal();
        showChangePasswordModal(true);
        return;
    }

    // Once the table is imported, prices come from the database; before that, from data.js.
    let serverCatalog = null;
    try {
        serverCatalog = await fetchPricingCatalog();
    } catch (e) {
        console.warn('Tabela de preços do servidor indisponível; usando data.js.', e);
    }

    // api/data.php only delivers data.js to a logged-in session, so a session created after the
    // page loaded needs one reload. The flag prevents a reload loop. Not needed after the import.
    const needsDataJs = !(serverCatalog && serverCatalog.imported);
    if (needsDataJs && (window.PORTAL_DATA_LOCKED !== false || typeof PRODUTOS_CSV === 'undefined')) {
        if (!sessionStorage.getItem('hr_data_reload')) {
            sessionStorage.setItem('hr_data_reload', '1');
            location.reload();
        } else {
            sessionStorage.removeItem('hr_data_reload');
            showLoginModal('Não foi possível carregar as tabelas de preço. Recarregue a página.');
        }
        return;
    }
    sessionStorage.removeItem('hr_data_reload');
    useCatalog(serverCatalog);

    // Event Listeners
    document.getElementById('productSearch').addEventListener('input', updateResults);
    document.getElementById('stateSelect').addEventListener('change', onStateChange);
    document.getElementById('cityType').addEventListener('change', updateResults);
    document.getElementById('weightTier').addEventListener('change', updateResults);

    try {
        await loadServerData();
    } catch (e) {
        alert(`Não foi possível carregar os pedidos do servidor: ${e.message}`);
    }

    hiperrollOrderNumberManager.applyToForm();
    const representativeInput = document.getElementById('representativeName');
    if (representativeInput && !representativeInput.value) {
        representativeInput.value = authManager.getDisplayName();
    }

    closeLoginModal();
    authManager.updateUI();
    updateTrashBadge();
    startPricingWatcher();
}

