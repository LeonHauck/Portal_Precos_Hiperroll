// Ações da tela: liga cada botão e campo à função que ele executa.
// Carregado por último (ver Portal_Hiperroll_Final.html).
//
// Em vez de onclick="..." escrito no HTML (que o CSP proíbe, porque é código dentro da página),
// cada elemento diz o que faz com atributos:
//   <button data-action="saveDraft">            → clique
//   <input data-change="updateOrderTable">      → mudança de valor (change)
//   <input data-input="updateHeaderInfo">       → digitação (input)
//   <form data-submit="submitNewUser">          → envio de formulário
// e um único "ouvinte" por tipo de evento procura o nome nas listas abaixo. Dados extras vão em
// data-id, data-index, data-tab etc. Só os nomes listados aqui podem ser chamados.

const CLICK_ACTIONS = {
    // Cabeçalho, abas e sessão
    toggleTheme: () => toggleTheme(),
    showLoginModal: () => showLoginModal(),
    logoutUser: () => logoutUser(),
    changeOwnPassword: () => showChangePasswordModal(false),
    closeChangePassword: () => closeChangePasswordModal(),
    submitChangePassword: () => submitChangePassword(),
    switchTab: el => switchTab(el.dataset.tab),

    // Pedido em montagem
    addToCart: el => addToCart(el.dataset.codigo),
    removeFromCart: el => removeFromCart(Number(el.dataset.index)),
    showStatusHistory: el => showStatusHistory(el.dataset.id || undefined),
    closeStatusHistory: () => closeStatusHistory(),
    exportPdf: () => exportPdfControlled(),
    saveDraft: () => saveDraftCurrentOrder(),
    showSubmitOrder: () => showSubmitOrderModal(),
    closeSubmitOrder: () => closeSubmitOrderModal(),
    submitOrder: () => submitOrder(),
    resolveReprice: el => resolveRepriceModal(el.dataset.choice),

    // Rascunhos e pedidos
    loadDraft: el => loadDraftToCurrentOrder(el.dataset.id, el.dataset.silent === 'true'),
    prepareDraftForSubmission: el => prepareDraftForSubmission(el.dataset.id),
    showDraftModal: el => showDraftModal(el.dataset.id),
    repeatOrder: el => repeatOrder(el.dataset.id),
    deleteSubmission: el => deleteSubmission(el.dataset.id),
    openEmbeddedInvoice: el => openEmbeddedInvoice(el.dataset.id, Number(el.dataset.index)),
    reloadOrders: () => reloadOrders(),
    openBillingModal: el => openBillingModal(el.dataset.id),
    submitBilling: el => submitBilling(el.dataset.id),
    // Janelas criadas na hora (detalhes, faturamento...): fechar = remover.
    removeModal: el => el.closest('.modal-backdrop')?.remove(),

    // Lixeira
    showTrash: () => showTrashModal(),
    closeTrash: () => closeTrashModal(),
    emptyTrash: () => emptyTrash(),
    toggleTrashDetails: el => toggleTrashDetails(el.dataset.id),
    restoreSubmission: el => restoreSubmission(el.dataset.id),
    permanentlyDeleteSubmission: el => permanentlyDeleteSubmission(el.dataset.id),

    // Gestor
    showSupervisorPanel: () => showSupervisorPanel(),
    closeSupervisorPanel: () => closeSupervisorPanel(),
    openSupervisorOrderActions: el => openSupervisorOrderActions(el.dataset.id),
    closeSupervisorActionModal: () => closeSupervisorActionModal(),
    supervisorDecision: el => handleSupervisorAction(el.dataset.id, el.dataset.decision),
    showPendingOrderDetails: el => showPendingOrderDetails(el.dataset.id),
    approvePendingOrders: () => approvePendingOrders(),
    rejectPendingOrders: () => rejectPendingOrders(),

    // Usuários e backup
    showUsersModal: () => showUsersModal(),
    closeUsers: () => closeUsersModal(),
    toggleUserActive: el => toggleUserActive(Number(el.dataset.id), el.dataset.active === 'true'),
    resetUserPassword: el => resetUserPassword(Number(el.dataset.id), el.dataset.name),
    exportBackup: () => exportPortalBackup(),

    // Tabela de preços
    switchPricingSection: el => switchPricingSection(el.dataset.section),
    discardPricingChanges: () => renderPricingTab(),
    importPricingCatalog: () => importPricingCatalog(),
    savePricingLines: () => savePricingLines(),
    saveFreightRows: () => saveFreightRows(),
    createPricingLine: () => createPricingLine(),
    createFreightRow: () => createFreightRow(),
    togglePricingCategory: el => togglePricingCategory(el.dataset.category),
    clearPricingCategories: () => setPricingCategories([]),
    bulkUpdateFilteredProducts: el => bulkUpdateFilteredProducts(el.dataset.mode),
    discardPricingProductEdits: () => discardPricingProductEdits(),
    savePricingProducts: () => savePricingProducts(),
    createPricingProduct: () => createPricingProduct(),
    resetPricingProductPrice: el => resetPricingProductPrice(el),
    toggleBulkSelection: el => toggleBulkSelection(el.dataset.value === 'true'),
    previewBulkAdjust: () => previewBulkAdjust(),
    applyBulkAdjust: () => applyBulkAdjust()
};

const CHANGE_ACTIONS = {
    updateOrderTable: () => updateOrderTable(),
    formatProposalValidity: el => formatProposalValidityInput(el),
    updateCartQty: el => updateCartQty(Number(el.dataset.index), el.value),
    updateUnitDiscount: el => updateUnitDiscount(Number(el.dataset.index), el.value),
    updateNegotiatedPrice: el => updateNegotiatedPrice(Number(el.dataset.index), el.value),
    changeUserRole: el => changeUserRole(Number(el.dataset.id), el.value),
    togglePricingCosts: el => togglePricingCosts(el),
    markRowDirty: el => markPricingDirty(el.closest('tr')),
    togglePricingInactive: el => togglePricingInactive(el),
    onPricingProductInput: el => onPricingProductInput(el),
    onBulkTargetChange: () => onBulkParamsChange(true),
    onBulkParamsChange: () => onBulkParamsChange()
};

const INPUT_ACTIONS = {
    updateHeaderInfo: () => updateHeaderInfo(),
    updateOrderTable: () => updateOrderTable(),
    renderHistoryTab: () => renderHistoryTab(),
    onPricingLineInput: el => onPricingLineInput(el),
    markRowDirty: el => markPricingDirty(el.closest('tr')),
    filterPricingProducts: el => filterPricingProducts(el),
    onPricingProductInput: el => onPricingProductInput(el),
    onPricingPriceInput: el => onPricingPriceInput(el),
    onBulkParamsChange: () => onBulkParamsChange()
};

const SUBMIT_ACTIONS = {
    submitNewUser: (el, event) => submitNewUser(event)
};

function bindUiActions(eventName, attribute, actions) {
    document.addEventListener(eventName, event => {
        const el = event.target.closest(`[${attribute}]`);
        if (!el || el.disabled) return;
        const name = el.getAttribute(attribute);
        const action = actions[name];
        if (!action) {
            console.warn(`Ação desconhecida: ${attribute}="${name}"`);
            return;
        }
        // A link used as a button must not jump to "#".
        if (eventName === 'click' && el.tagName === 'A' && el.getAttribute('href') === '#') event.preventDefault();
        action(el, event);
    });
}

bindUiActions('click', 'data-action', CLICK_ACTIONS);
bindUiActions('change', 'data-change', CHANGE_ACTIONS);
bindUiActions('input', 'data-input', INPUT_ACTIONS);
bindUiActions('submit', 'data-submit', SUBMIT_ACTIONS);
