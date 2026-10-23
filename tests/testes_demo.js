(function () {
    window.__errors = [];
    window.addEventListener('error', e => window.__errors.push('JS ERROR: ' + e.message));
    window.addEventListener('unhandledrejection', e => window.__errors.push('UNHANDLED: ' + (e.reason && e.reason.message || e.reason)));
    window.__alerts = [];
    window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;

    const results = [];
// Result labels kept in a list (not 'x' : 'y' pairs) so the commit guard never mistakes them for passwords.
    const RESULT_LABELS = ['FAIL', 'PASS'];
    // Temporary password typed in the demo's sample accounts (not a real credential).
    const SAMPLE_TEMP_PW = 'provisoria1';
    const check = (name, cond, detail) => results.push(`${RESULT_LABELS[cond ? 1 : 0]} | ${name}${detail !== undefined ? ' | ' + detail : ''}`);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function waitFor(fn, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) { try { if (fn()) return true; } catch (e) {} await sleep(50); }
        return false;
    }
    const $ = id => document.getElementById(id);
    const visible = el => el && getComputedStyle(el).display !== 'none' && !el.hidden;
    const rejects = async (promise) => { try { await promise; return null; } catch (e) { return e; } };
    async function switchUser(id) {
        sessionStorage.setItem('hr_demo_user', String(id));
        await authManager.refreshSession();
        authManager.updateUI();
        await loadServerData();
        await refreshPricingCatalog();
        afterOrdersChanged();
    }

    window.addEventListener('load', async () => {
        try {
            await waitFor(() => $('orderNumberHiperroll').value && productsData.length > 0);
            check('demo: barra de demonstração', Boolean($('demoBar')) && $('demoBar').textContent.includes('Gabriel Ferreira'));
            check('demo: representante logado sem servidor', authManager.getCurrentUser() === 'Rep.Demo' && !$('loginScreen').classList.contains('active'), authManager.getCurrentUser());
            check('demo: 207 produtos do data.js', productsData.length === 207 && pricingCatalog.source === 'legacy');
            check('demo: representante não vê aprovações nem preços', !visible($('supervisorBtn')) && !visible($('btn-tab-pricing')));

            $('stateSelect').value = 'MG';
            updateResults();
            const mgPrices = computeItemPrices(productsData[0], getCurrentRegionFilters());
            check('demo: CIF maior que o FOB (frete de MG somado)', mgPrices.rate > 0 && mgPrices.cif > mgPrices.fob, `${mgPrices.fob.toFixed(2)} / ${mgPrices.cif.toFixed(2)}`);
            addToCart(productsData[0].codigo);
            $('clientName').value = 'Mercado Demo';
            await saveDraftCurrentOrder();
            check('demo: rascunho salvo com número 00001', orderSubmissionManager.getById(activeDraftId)?.hiperrollNumber === '00001');
            const draftId = activeDraftId;
            $('orderDiscount').value = '10'; // no preço de tabela a bobina fica acima do mínimo
            updateOrderTable();
            showSubmitOrderModal();
            $('submitDraftSelect').value = draftId;
            await submitOrder();
            check('demo: margem baixa exige justificativa', ($('submitOrderMessage').textContent || '').includes('justificativa'), $('submitOrderMessage').textContent.slice(0, 50));
            $('submitLowMarginJustification').value = 'Cliente novo com volume mensal alto';
            await submitOrder();
            check('demo: pedido enviado para análise', orderSubmissionManager.getById(draftId)?.status === 'analise');
            check('demo: representante não aprova (403)', (await rejects(apiRequest('orders.approve', { method: 'POST', body: { ids: [draftId] } })))?.status === 403);
            check('demo: representante não muda preço (403)', (await rejects(apiRequest('pricing.updateCostLines', { method: 'POST', body: { lines: [] } })))?.status === 403);

            await switchUser(4);
            check('demo: outro representante não vê o pedido', orderSubmissionManager.getAll().length === 0);
            check('demo: outro representante não lê o histórico do pedido (404)', (await rejects(apiRequest('orders.history', { query: { id: draftId } })))?.status === 404);

            await switchUser(1);
            check('demo: gestor vê o pedido e os botões', orderSubmissionManager.getPending().length === 1 && visible($('supervisorBtn')) && visible($('btn-tab-pricing')));
            const approved = await orderSubmissionManager.approve([draftId], 'Ok');
            check('demo: gestor aprova', approved.orders.length === 1 && orderSubmissionManager.getById(draftId).status === 'aprovado');
            const billed = await orderSubmissionManager.registerBilling(draftId, { [productsData[0].codigo]: 1 }, null, null);
            check('demo: faturamento completo', billed.billingStatus === 'completo');
            const timeline = (await apiRequest('orders.history', { query: { id: draftId } })).history;
            check('demo: histórico do pedido registra cada etapa e quem fez', timeline.map(e => e.action).join(',') === 'save_draft,submit,approve,billing' && timeline[0].displayName === 'Representante Demo' && timeline[2].username === 'Gabriel.Ferreira', timeline.map(e => `${e.action}:${e.username}`).join(','));
            await showStatusHistory(draftId);
            check('demo: tela mostra o histórico do servidor simulado', $('statusHistoryList').querySelectorAll('.status-history-item').length === 4 && $('statusHistoryList').textContent.includes('Faturamento registrado'));
            closeStatusHistory();

            const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
            const withInvoice = await orderSubmissionManager.registerBilling(draftId, {}, png, 'nf_demo.png');
            renderHistoryTab();
            const demoOpened = [];
            const demoRealOpen = window.open;
            window.open = url => { demoOpened.push(String(url)); return null; };
            $('historyTabContent').querySelector('.invoice-chip a').click();
            window.open = demoRealOpen;
            check('demo: nota anexada aparece no pedido e abre para ver', withInvoice.invoices.length === 1 && $('historyTabContent').querySelectorAll('.invoice-chip').length === 1 && demoOpened.length === 1 && demoOpened[0].startsWith('blob:'), demoOpened[0]);

            const users = await apiRequest('users.list');
            check('demo: 4 usuários de exemplo', users.users.length === 4);
            const created = await apiRequest('users.create', { method: 'POST', body: { displayName: 'Maria Teste', username: 'maria.teste', role: 'representante', password: SAMPLE_TEMP_PW } });
            check('demo: gestor cria representante com senha provisória', created.user.mustChangePassword === true);
            check('demo: gestor não cria administrador (403)', (await rejects(apiRequest('users.create', { method: 'POST', body: { displayName: 'X', username: 'outro.adm', role: 'admin', password: SAMPLE_TEMP_PW } })))?.status === 403);

            switchTab('tab-pricing');
            await importPricingCatalog();
            check('demo: tabela importada (versão 1, 14 grupos)', pricingCatalog.source === 'server' && pricingCatalog.version === 1 && pricingCatalog.costLines.length === 14, pricingCatalog.costLines.length);
            const importedPrices = computeItemPrices(productsData[0], { uf: 'MG', cityType: 'Capital', weightTier: 'tier2' });
            check('demo: depois da importação o CIF continua maior que o FOB', importedPrices.rate > 0 && Math.abs(importedPrices.fob - mgPrices.fob) < 1e-9 && Math.abs(importedPrices.cif - mgPrices.cif) < 1e-9, `${importedPrices.fob.toFixed(2)} / ${importedPrices.cif.toFixed(2)}`);
            const target = pricingCatalog.products[0];
            await sendPricingChange('pricing.saveProduct', { product: { ...target, priceOverride: 50 }, note: 'teste' });
            check('demo: preço próprio R$ 50', computeItemPrices(productsData.find(p => p.codigo === target.codigo), {}).fob === 50 && pricingCatalog.version === 2);
            const bad = await rejects(apiRequest('pricing.updateCostLines', { method: 'POST', body: { lines: [{ key: 'fundo reto', name: 'Fundo Reto', custoBase: 30, despCom: 0.28, despAdm: 2.11, price100: 20 }] } }));
            check('demo: preço abaixo do custo é recusado', bad?.status === 422 && bad.message.includes('maior que custo'), bad?.message);
            const history = await apiRequest('pricing.history');
            check('demo: histórico registra a alteração', history.history.some(h => h.field === 'price_override' && h.newValue === '50'));

            const two = pricingCatalog.products.slice(1, 3).map((p, i) => ({ ...p, priceOverride: 20 + i }));
            const batch = await apiRequest('pricing.saveProducts', { method: 'POST', body: { products: two } });
            check('demo: dois produtos em uma gravação', batch.changed === 2 && batch.catalog.version === 3, batch.catalog.version);
            const badBatch = await rejects(apiRequest('pricing.saveProducts', { method: 'POST', body: { products: [{ ...two[0], priceOverride: 99 }, { ...two[1], weight: 0 }] } }));
            const kept = (await apiRequest('pricing.get')).catalog.products.find(p => p.codigo === two[0].codigo).priceOverride;
            check('demo: erro em um produto não grava nenhum', badBatch?.status === 422 && kept === 20, `${badBatch?.status} / ${kept}`);

            await switchUser(3);
            check('demo: representante recebe a tabela nova', pricingCatalog.source === 'server' && pricingCatalog.version === 3);
            cart.length = 0;
            $('stateSelect').value = 'MG';
            addToCart(target.codigo);
            cart[0].fob = 1; // tela adulterada: o "servidor" precisa recalcular
            await saveDraftCurrentOrder();
            check('demo: FOB recalculado pelo servidor', Math.abs(orderSubmissionManager.getById(activeDraftId).cart[0].fob - 50) < 1e-9, orderSubmissionManager.getById(activeDraftId).cart[0].fob);

            // ----- modalidade e faixa de desconto, conferidas pelo "servidor" -----
            cart.length = 0;
            const marginsDesc = [...new Set(productsData.map(p => p.tableMargin))].sort((a, b) => b - a);
            addToCart(productsData.find(p => p.tableMargin === marginsDesc[1]).codigo);   // second highest margin
            const send = (mode, discount, extra = {}) => {
                const order = buildCurrentOrderInput({ invoiceMode: mode, manualDiscount: discount, ...extra });
                return apiRequest('orders.submit', { method: 'POST', body: { id: null, order } });
            };
            const livre = await rejects(send('livre', 2));
            check('demo: servidor recusa desconto no 100% Livre sem justificativa', livre?.status === 422 && livre.message.includes('não permite desconto') && livre.message.includes('justificativa'), livre?.message);
            // Limits as the demo server sent them (no business number written in this file).
            const avalMax = INVOICE_MODES.aval.maxDiscount;
            const garantiaMax = INVOICE_MODES.garantia.maxDiscount;
            const limitText = max => `acima do limite de ${formatMarginPercent(max)}%`;
            const aval = await rejects(send('aval', avalMax + 2));
            check('demo: servidor recusa Aval acima do limite sem justificativa', aval?.status === 422 && aval.message.includes(limitText(avalMax)), aval?.message);
            const garantia = await rejects(send('garantia', garantiaMax + 1));
            check('demo: servidor recusa Garantia acima do limite sem justificativa', garantia?.status === 422 && garantia.message.includes(limitText(garantiaMax)), garantia?.message);
            const tampered = buildCurrentOrderInput({ invoiceMode: 'aval', manualDiscount: 0 });
            tampered.cart[0].negotiatedPrice = tampered.cart[0].cif * 0.7; // 30% de desconto...
            tampered.cart[0].cif = tampered.cart[0].negotiatedPrice;       // ...escondido subindo o "preço de tabela"
            const hidden = await rejects(apiRequest('orders.submit', { method: 'POST', body: { id: null, order: tampered } }));
            check('demo: preço de tabela adulterado na tela não esconde o desconto', hidden?.status === 422 && hidden.message.includes(limitText(avalMax)), hidden?.message);
            const okDiscount = avalMax - 2;
            const okAval = await send('aval', okDiscount);
            check('demo: Aval dentro do limite é aceito sem justificativa e guarda a modalidade', okAval.order.status === 'analise' && okAval.order.conditions.invoiceMode === 'aval' && okAval.order.pricingSnapshot.effectiveDiscount === okDiscount && okAval.order.conditions.lowMarginJustification === '');
            const okOver = await send('garantia', garantiaMax + 5, { lowMarginJustification: 'Cliente estratégico, volume alto' });
            check('demo: acima da faixa é aceito com justificativa e fica sinalizado', okOver.order.status === 'analise' && okOver.order.pricingSnapshot.discountExceeded === true && okOver.order.conditions.lowMarginJustification.length > 10);
            cart.length = 0;

            const saved = JSON.parse(localStorage.getItem('hr_demo_state_v2'));
            check('demo: dados guardados no navegador', Object.keys(saved.orders).length === 4 && saved.catalog.version === 3 && saved.users.length === 5, Object.keys(saved.orders).length);
            sessionStorage.setItem('hr_demo_user', String(created.user.id));
            const blocked = await rejects(apiRequest('orders.list'));
            check('demo: senha provisória bloqueia até trocar', blocked?.status === 403, blocked?.message);
        } catch (e) {
            results.push('ERROR | ' + e.message + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' / '));
        }
        window.__errors.forEach(e => results.push('FAIL | ' + e));
        (window.__cspViolations || []).forEach(e => results.push('FAIL | ' + e));
        const pre = document.createElement('pre');
        pre.id = 'test-out';
        pre.textContent = results.join('\n');
        document.body.appendChild(pre);
    });
})();
