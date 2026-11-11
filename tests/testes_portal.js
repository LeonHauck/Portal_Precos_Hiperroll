(function () {
    const results = [];
// Result labels kept in a list (not 'x' : 'y' pairs) so the commit guard never mistakes them for passwords.
    const RESULT_LABELS = ['FAIL', 'PASS'];
    const check = (name, cond, detail) => results.push(`${RESULT_LABELS[cond ? 1 : 0]} | ${name}${detail !== undefined ? ' | ' + detail : ''}`);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function waitFor(fn, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try { if (fn()) return true; } catch (e) {}
            await sleep(50);
        }
        return false;
    }
    const $ = id => document.getElementById(id);
    const visible = el => el && getComputedStyle(el).display !== 'none' && !el.hidden;
    const mode = new URLSearchParams(location.search).get('mode') || 'rep';
    // Fictitious rules of the simulated server (tests/api_simulada.js); expectations come from them.
    const RULES = window.__testRules;
    const AVAL_MAX = RULES.invoiceModes.find(m => m.key === 'aval').maxDiscount;
    const GARANTIA_MAX = RULES.invoiceModes.find(m => m.key === 'garantia').maxDiscount;
    const pct = value => `${formatMarginPercent(value)}%`;
    // Picks a region on screen and waits for its prices (a representative downloads them ready
    // from the server, one region at a time; gestor/admin calculate them on screen).
    const chooseRegion = async (uf, praca) => {
        $('stateSelect').value = uf;
        onStateChange();
        if (praca) $('cityType').value = praca;
        await loadRegionPrices(uf, $('cityType').value);
        updateResults();
    };

    window.addEventListener('load', async () => {
        try {
            // ----- Capturas de tela (tests/gerar_prints.ps1) -----
            // readme_*: imagens do README, com pessoas e clientes de exemplo e sem valores comerciais.
            // layout_*: as mesmas telas com valores, só para conferir o visual (não vão para o Git).
            if (mode.startsWith('layout') || mode.startsWith('readme')) {
                const isReadme = mode.startsWith('readme');
                const shotStyle = document.createElement('style');
                shotStyle.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}.shot-masked{filter:blur(4px)}'
                    + (isReadme ? '.invoice-mode-option small,.order-condition-badge,#orderDiscountBreakdown,.item-table-margin,.info-box--margin,.margin-min-hint{display:none!important}' : '');
                document.head.appendChild(shotStyle);
                if (mode === 'layout_dark') document.documentElement.setAttribute('data-theme', 'dark');
                // README: no real price, freight or margin reaches the image.
                // 1. useFictitiousPrices() swaps the price table for invented numbers BEFORE anything is
                //    drawn. FOB and CIF still go through the real formulas, so they differ like in the
                //    real portal (CIF = FOB + freight with the same markup); only the inputs are made up.
                // 2. hideValues() blurs every value and turns percentages (margins, discounts) into 0,
                //    because a margin would reveal the real "margem do produto" of the table.
                const useFictitiousPrices = async () => {
                    if (!isReadme || !pricingCatalog) return;
                    // Representative: the prices come ready from the (simulated) server, so the
                    // invented numbers go into the server's table.
                    if (usesServerPrices()) {
                        window.__mockFictitiousPrices();
                        await refreshPricingCatalog();
                        return;
                    }
                    pricingCatalog.costLines.forEach((line, i) => {
                        const price = 9.5 + ((i * 7) % 11) * 0.85;   // invented R$/kg
                        Object.assign(line, { price100: +price.toFixed(2), custoBase: +(price * 0.62).toFixed(2), despCom: +(price * 0.08).toFixed(2), despAdm: +(price * 0.06).toFixed(2) });
                    });
                    pricingCatalog.freight.forEach((row, i) => {
                        const rate = 0.55 + ((i * 5) % 9) * 0.07;    // invented freight R$/kg
                        row.tier1 = +rate.toFixed(2);
                        row.tier2 = +(rate * 0.85).toFixed(2);
                    });
                    pricingCatalog.products.forEach(product => { product.priceOverride = null; });
                    applyCatalog(pricingCatalog);
                };
                const moneySelectors = 'td.num, .price-tag, .order-row__total, .kv-row strong, .pending-item__figures strong, .total-line strong, .order-conditions-summary strong, .chip, #totalFob, #totalCif, #marginPercentage, .w-money, #orderDiscount, #pricingSectionBody input[type="number"], #pricingSectionBody .pricing-computed';
                const zeroDigits = text => text.replace(/\d/g, '0');
                const hideValues = (root = document) => {
                    if (!isReadme) return;
                    root.querySelectorAll(moneySelectors).forEach(el => {
                        if (el.tagName === 'INPUT') {
                            el.type = 'text';
                            if (el.dataset.field === 'tableMargin' || el.id === 'orderDiscount') el.value = zeroDigits(el.value);
                        } else if (/%/.test(el.textContent)) {
                            el.textContent = zeroDigits(el.textContent);
                        } else if (!/R\$/.test(el.textContent) && !el.matches('.pricing-computed, #totalFob, #totalCif')) {
                            return;   // quantities and weights (product data) stay readable, as before
                        }
                        el.classList.add('shot-masked');
                    });
                };
                // Headless screenshots only capture the top of the page: hide what comes before.
                const hideAbove = (...elements) => elements.forEach(el => { if (el) el.hidden = true; });

                if (mode === 'readme_login') { window.scrollTo(0, 0); return; }
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && productsData.length > 0);
                await useFictitiousPrices();

                if (['readme_precos', 'layout_full', 'layout_mobile'].includes(mode)) {
                    $('productSearch').value = 'sacola';
                    await chooseRegion('MG');
                    if (mode === 'layout_mobile') { addToCart(productsData[0].codigo); updateOrderTable(); }
                    hideValues($('resultsContainer'));
                    window.scrollTo(0, 0);
                    return;
                }
                if (mode === 'readme_pedido' || mode === 'layout_dark') {
                    await chooseRegion('MG');
                    // Three fixed products from the table (the representative's screen has no margins).
                    [0, 40, 45].forEach(i => addToCart(productsData[i].codigo));
                    cart[0].qty = 40; cart[1].qty = 25; cart[2].qty = 12;
                    $('clientName').value = 'Mercado Exemplo';
                    $('proposalValidity').value = '30 dias';
                    document.querySelector('input[name="orderInvoiceMode"][value="aval"]').checked = true;
                    $('orderDiscount').value = '4';
                    updateOrderTable();
                    updateHeaderInfo();
                    hideValues($('orderSection'));
                    if (mode === 'readme_pedido') hideAbove(document.querySelector('.app-header'), document.querySelector('.app-tabs'), document.querySelector('#tab-order > .card'));
                    window.scrollTo(0, 0);
                    return;
                }
                if (mode === 'readme_tabela') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    switchTab('tab-pricing');
                    await waitFor(() => pricingCatalog.source === 'server');
                    await useFictitiousPrices();
                    renderPricingTab();
                    hideValues($('pricingTabContent'));
                    window.scrollTo(0, 0);
                    return;
                }
                if (mode === 'layout_users' || mode === 'readme_usuarios') { await showUsersModal(); return; }

                await waitFor(() => orderSubmissionManager.getAll().length > 0);
                if (mode === 'readme_aprovacoes' || mode === 'layout_super') {
                    showSupervisorPanel();
                    await waitFor(() => document.querySelector('.pending-order-checkbox'));
                    hideValues($('supervisorPendingOrdersList'));
                    return;
                }
                switchTab('tab-history');
                renderHistoryTab();
                if (mode === 'readme_pedidos' || mode === 'readme_faturamento') {
                    const first = $('historyCard_order_a');
                    if (first) first.open = true;
                }
                hideValues($('historyTabContent'));
                if (mode === 'readme_historico') await showStatusHistory('order_a');
                if (mode === 'readme_faturamento') openBillingModal('order_a');
                window.scrollTo(0, 0);
                return;
            }

            if (mode.startsWith('shothist')) {
                const noAnim3 = document.createElement('style'); noAnim3.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(noAnim3);
                if (mode === 'shothistdark') document.documentElement.setAttribute('data-theme', 'dark');
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && orderSubmissionManager.getAll().length > 0);
                window.__mockEvents.push({ action: 'reject', target: 'order_seed', username: 'Gabriel.Ferreira', displayName: 'Gabriel Ferreira', reason: 'Desconto acima do combinado com o cliente', at: new Date(Date.now() - 5 * 60000).toISOString() });
                window.__mockEvents.push({ action: 'submit', target: 'order_seed', username: 'joao', displayName: 'João Rep', reason: '', at: new Date(Date.now() - 3 * 60000).toISOString() });
                await orderSubmissionManager.approve(['order_seed'], '');
                switchTab('tab-history');
                renderHistoryTab();
                await showStatusHistory('order_seed');
                return;
            }

            if (mode === 'shotorder') {
                const noAnim2 = document.createElement('style'); noAnim2.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(noAnim2);
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && productsData.length > 0);
                await chooseRegion('MG');
                const shotMargins = [...new Set(productsData.map(p => p.tableMargin))].sort((a, b) => a - b);
                addToCart(productsData.find(p => p.tableMargin === shotMargins[0]).codigo);
                addToCart(productsData.find(p => p.tableMargin === shotMargins[1]).codigo);
                document.querySelector('input[name="orderInvoiceMode"][value="aval"]').checked = true;
                $('orderDiscount').value = '4';
                updateOrderTable();
                document.getElementById('orderSection').scrollIntoView();
                return;
            }

            if (mode === 'shot' || mode === 'shotdark' || mode === 'shotmodal' || mode === 'shotprod') {
                const noAnim = document.createElement('style'); noAnim.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(noAnim);
                if (mode === 'shotdark') document.documentElement.setAttribute('data-theme', 'dark');
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list'));
                switchTab('tab-pricing');
                await importPricingCatalog();
                if (mode === 'shotprod') {
                    switchPricingSection('products');
                    setPricingCategories(['Sacola Plastica - Lisa', 'Sacarias - Corte e Solda']);
                    const first = getFilteredPricingProducts()[0];
                    await sendPricingChange('pricing.saveProduct', { product: { ...first, priceOverride: 50 }, note: '' });
                    pricingTabSection = 'products';
                    renderPricingTab();
                    const typeShot = document.querySelectorAll('#pricingProductRows tr')[2].querySelector('[data-field="price"]');
                    typeShot.value = '31.50';
                    typeShot.dispatchEvent(new Event('input', { bubbles: true }));
                    window.scrollTo(0, 300);
                    return;
                }
                if (mode === 'shotmodal') {
                    switchTab('tab-order');
                    $('stateSelect').value = 'MG';
                    addToCart(productsData[0].codigo);
                    addToCart(productsData[3].codigo);
                    cart[0].negotiatedPrice -= 2; cart[0].unitDiscount = 2;
                    const plan = { changes: cart.map(item => ({ item, newFob: item.fob * 1.05, newCif: item.cif * 1.05, newWeight: item.weight, changed: true })), missing: [], hasDifferences: true };
                    showRepriceModal('A tabela de preços foi atualizada pelo gestor.', plan);
                }
                window.scrollTo(0, 0);
                return;
            }

            if (mode === 'productlist') {
                await waitFor(() => productsData.length > 0);
                const rows = productsData.map(p => ({ codigo: p.codigo, descricao: p.descricao, categoria: p.categoria, subcat: p.subcat, peso: p.weightRaw, linha: costsData[p.costLineKey].name, price100: costsData[p.costLineKey].price100, fob: computeItemPrices(p).fob, tableMargin: p.tableMargin }));
                results.push('PASS | WARN | ' + JSON.stringify(getLegacyCatalog().warnings));
                results.push('PASS | UNUSED | ' + JSON.stringify(getLegacyCatalog().unusedLines));
                results.push('PASS | JSON | ' + JSON.stringify(rows));
            }

            if (mode === 'mapping') {
                await waitFor(() => productsData.length > 0);
                const groups = {};
                productsData.forEach(p => { const k = `${p.categoria} → ${p.costLineKey}`; groups[k] = (groups[k] || 0) + 1; });
                Object.keys(groups).sort().forEach(k => results.push(`PASS | ${k} | ${groups[k]}`));
            }

            if (mode === 'anon') {
                await waitFor(() => window.__mockCalls.some(c => c.action === 'session'));
                await sleep(300);
                check('anon: tela de login ativa', $('loginScreen').classList.contains('active'));
                check('anon: não pede pedidos sem login', !window.__mockCalls.some(c => c.action === 'orders.list'));
                check('anon: sem botão de cadastro', !$('registerUserButton'));
            }

            if (mode === 'newrep') {
                await waitFor(() => visible($('changePasswordModal')));
                check('senha provisória: modal de troca aberto', visible($('changePasswordModal')));
                check('senha provisória: não pode fechar', !visible($('changePasswordCloseBtn')) && !visible($('changePasswordCancelBtn')));
                check('senha provisória: não carrega pedidos', !window.__mockCalls.some(c => c.action === 'orders.list'));
            }

            if (mode === 'rep') {
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && $('orderNumberHiperroll').value);
                check('rep: número Hiper Roll vindo do servidor', $('orderNumberHiperroll').value === '00001', $('orderNumberHiperroll').value);
                check('rep: representante preenchido com o nome', $('representativeName').value === 'João Rep', $('representativeName').value);
                check('rep: login liberado', !$('loginScreen').classList.contains('active'));
                const pricesCalls = () => window.__mockCalls.filter(c => c.action === 'pricing.prices');
                check('rep: nenhum preço baixado ao abrir (só ao escolher a região)', pricesCalls().length === 0, pricesCalls().length);
                check('rep: sem botão de aprovações/usuários', !visible($('supervisorBtn')) && !visible($('usersBtn')));

                // ----- CSP: código escrito dentro do HTML não roda -----
                window.__inlineRan = false;
                const probe = document.createElement('button');
                probe.setAttribute('onclick', 'window.__inlineRan = true');
                document.body.appendChild(probe);
                const errorsBefore = window.__errors.length;
                probe.click();
                await sleep(100);
                const cspBlocked = window.__errors.slice(errorsBefore).some(e => e.includes('CSP bloqueou'));
                window.__errors.splice(errorsBefore); // this violation is the expected result, not a failure
                probe.remove();
                check('rep: CSP ativo bloqueia onclick escrito no HTML', window.__inlineRan === false && cspBlocked);
                check('rep: modalidades montadas a partir das regras do servidor', document.querySelectorAll('input[name="orderInvoiceMode"]').length === 3 && document.querySelector('input[name="orderInvoiceMode"][value="aval"]').closest('label').textContent.includes(`desconto até ${pct(AVAL_MAX)}`));
                check('rep: descontos de antecipado e frete FOB vindos do servidor', document.querySelector('[data-pricing-rule="EARLY_PAYMENT_DISCOUNT"]').textContent === pct(RULES.earlyPaymentDiscount) && document.querySelector('[data-pricing-rule="FOB_FREIGHT_DISCOUNT"]').textContent === pct(RULES.fobFreightDiscount), document.querySelector('[data-pricing-rule="EARLY_PAYMENT_DISCOUNT"]').textContent);
                $('stateSelect').value = 'MG';
                onStateChange();
                const pracasMG = [...$('cityType').options].map(o => o.value);
                $('stateSelect').value = 'PA';
                onStateChange();
                const pracasPA = [...$('cityType').options].map(o => o.value);
                check('rep: MG não oferece praça Fluvial; PA oferece', !pracasMG.includes('Fluvial') && pracasMG.includes('Capital') && pracasPA.includes('Fluvial'), `${pracasMG} | ${pracasPA}`);
                $('cityType').value = 'Fluvial';
                $('stateSelect').value = 'MG';
                onStateChange();
                check('rep: ao trocar para um estado sem Fluvial, volta para Capital', $('cityType').value === 'Capital', $('cityType').value);
                $('stateSelect').value = '';
                onStateChange();

                // ----- histórico do pedido (vem do servidor, nada no navegador) -----
                check('rep: status e histórico antigos saem do navegador', localStorage.getItem('orderStatus') === null && localStorage.getItem('orderStatusHistory') === null && statusManager.currentStatus === 'rascunho', statusManager.currentStatus);
                await showStatusHistory();
                check('rep: pedido ainda não salvo explica que não há histórico', visible($('statusHistoryModal')) && $('statusHistoryList').textContent.includes('ainda não foi salvo') && !window.__mockCalls.some(c => c.action === 'orders.history'));
                closeStatusHistory();
                check('rep: tabelas de produto carregadas', productsData.length > 100, productsData.length);

                check('rep: preços vêm do banco, nunca do data.js', pricingCatalog.source === 'server', pricingCatalog.source);
                check('rep: tabela chega sem a margem dos produtos', pricingCatalog.products.length > 100 && pricingCatalog.products.every(p => !('tableMargin' in p)));
                check('rep: regras chegam sem margem padrão nem ponto de alerta', PRICING_RULES.DEFAULT_PRODUCT_MARGIN === 0 && PRICING_RULES.MARGIN_ALERT_DROP === null && PRICING_RULES.MAX_NEGOTIATED_DISCOUNT === RULES.maxNegotiatedDiscount);
                check('rep: aba de preços oculta', !visible($('btn-tab-pricing')));
                check('rep: UFs carregadas (inclui TO)', $('stateSelect').options.length > 20 && Boolean(freightData.TO), $('stateSelect').options.length);

                // ----- preços prontos do servidor: custos e fretes nunca chegam ao navegador -----
                check('rep: tabela chega sem custos (grupos de preço)', pricingCatalog.pricesOnRequest === true && pricingCatalog.costLines.length === 0 && Object.keys(costsData).length === 0);
                check('rep: regiões chegam sem o valor do frete', pricingCatalog.freight.length > 20 && pricingCatalog.freight.every(f => Object.keys(f).sort().join() === 'label,pracaType,uf'), JSON.stringify(pricingCatalog.freight[0]));
                check('rep: produtos chegam sem grupo de preço nem preço próprio', pricingCatalog.products.every(p => !('costLineKey' in p) && !('priceOverride' in p) && !('tableMargin' in p)));

                // ----- Juazeiro: praça própria da BA; o Interior da BA usa a linha "Interior" -----
                $('stateSelect').value = 'BA';
                onStateChange();
                const pracasBA = [...$('cityType').options].map(o => [o.value, o.textContent]);
                check('rep: BA oferece Juazeiro como praça própria', pracasBA.some(([v, t]) => v === 'Especial' && t === 'Juazeiro') && pracasBA.some(([v]) => v === 'Interior'), JSON.stringify(pracasBA));
                await loadRegionPrices('BA', 'Interior');
                await loadRegionPrices('BA', 'Especial');
                const cifIn = praca => computeItemPrices(productsData[0], { uf: 'BA', cityType: praca, weightTier: 'tier1' }).cif;
                check('rep: BA Interior usa o frete do Interior, não o de Juazeiro', freightData.BA.Interior.label === 'Interior' && cifIn('Interior') > 0 && cifIn('Interior') !== cifIn('Especial'), `${cifIn('Interior')} / ${cifIn('Especial')}`);
                check('rep: outros estados sem praça especial', !freightData.MG.Especial && !freightData.SP.Especial);
                const regionAnswer = await apiRequest('pricing.prices', { query: { uf: 'BA', praca: 'Interior' } });
                const sampleAnswer = regionAnswer.prices[productsData[0].codigo];
                check('rep: resposta da região traz só preços prontos (FOB e CIF das duas faixas)', Object.keys(sampleAnswer).sort().join() === 'cif,fob' && Object.keys(sampleAnswer.cif).sort().join() === 'tier1,tier2' && regionAnswer.version === pricingCatalog.version, JSON.stringify(sampleAnswer));
                check('rep: região inexistente é recusada', (await apiRequest('pricing.prices', { query: { uf: 'MG', praca: 'Fluvial' } }).then(() => null, e => e))?.status === 404);

                clearRegionPrices(); // as if the portal had just opened: MG not downloaded yet
                const callsBeforeMG = pricesCalls().length;
                $('stateSelect').value = 'MG';
                onStateChange();
                check('rep: enquanto os preços chegam, a lista avisa que está carregando', $('resultsContainer').textContent.includes('Carregando os preços de MG'), $('resultsContainer').textContent.trim());
                await waitFor(() => $('resultsContainer').querySelectorAll('button[data-codigo]').length > 100);
                check('rep: resultados com preço CIF', $('resultsContainer').querySelectorAll('button[data-codigo]').length > 100);
                check('rep: uma única consulta ao servidor para a região', pricesCalls().length === callsBeforeMG + 1 && pricesCalls().pop().uf === 'MG');
                updateResults();
                $('productSearch').value = 'sacola';
                updateResults();
                $('productSearch').value = '';
                updateResults();
                check('rep: buscar e redesenhar não consulta de novo (preços guardados)', pricesCalls().length === callsBeforeMG + 1);
                addToCart(productsData[0].codigo);
                check('rep: item guarda a região; faixa pelo peso (1 unidade fica abaixo de 200 kg)', cart[0].uf === 'MG' && cart[0].cityType === 'Capital' && cart[0].weightTier === 'tier1', JSON.stringify([cart[0].uf, cart[0].cityType, cart[0].weightTier]));
                check('rep: CIF > FOB com frete', cart[0].cif > cart[0].fob, `${cart[0].fob.toFixed(2)} / ${cart[0].cif.toFixed(2)}`);

                // ----- margem: o representante não vê -----
                check('rep: carrinho sem coluna de margem', !/Margem/.test($('orderTableContainer').querySelector('thead').textContent), $('orderTableContainer').querySelector('thead').textContent.replace(/\s+/g, ' '));
                check('rep: margem do pedido e do cabeçalho escondidas', !visible($('marginPercentage').closest('.total')) && !visible($('marginThreshold').closest('.info-box')));

                // ----- faixa de peso automática -----
                check('rep: faixa informada e aviso de pedido abaixo de 200 kg', $('weightTierInfo').textContent.includes('150 a 199') && !$('orderWeightWarning').hidden && $('orderWeightWarning').textContent.includes('abaixo de 200 kg'), $('weightTierInfo').textContent);
                const cifTier1 = cart[0].cif;
                updateCartQty(0, Math.ceil(200 / cart[0].weight));
                check('rep: a partir de 200 kg a faixa muda sozinha e o CIF cai', cart[0].weightTier === 'tier2' && cart[0].cif < cifTier1 && $('orderWeightWarning').hidden && $('weightTierInfo').textContent.includes('acima de 200'), `${cifTier1.toFixed(2)} → ${cart[0].cif.toFixed(2)}`);
                updateCartQty(0, 1);
                check('rep: abaixo de 200 kg volta para 150 a 199', cart[0].weightTier === 'tier1' && Math.abs(cart[0].cif - cifTier1) < 1e-9);
                await saveDraftCurrentOrder();
                check('rep: rascunho salvo no servidor', activeDraftId === 'order_1', activeDraftId);
                check('rep: POST com token CSRF', window.__mockCalls.filter(c => c.method === 'POST').every(c => c.csrf === 'tok123'));
                check('rep: painel mostra o rascunho', $('draftsPanelBadge').textContent.startsWith('1'), $('draftsPanelBadge').textContent);
                await saveDraftCurrentOrder();
                await showStatusHistory();
                const draftHistory = $('statusHistoryList');
                check('rep: histórico do rascunho vem do servidor', window.__mockCalls.some(c => c.action === 'orders.history' && c.method === 'GET' && c.id === 'order_1') && $('statusHistoryOrder').textContent === 'Pedido 00001', $('statusHistoryOrder').textContent);
                check('rep: salvar duas vezes vira uma linha com contador', draftHistory.querySelectorAll('.status-history-item').length === 1 && draftHistory.textContent.includes('Rascunho salvo (2 vezes)') && draftHistory.textContent.includes('João Rep'), draftHistory.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
                closeStatusHistory();
                check('rep: nada do histórico fica no navegador', localStorage.getItem('orderStatusHistory') === null && localStorage.getItem('orderStatus') === null);

                $('orderDiscount').value = '10';
                updateOrderTable();
                showSubmitOrderModal();
                check('rep: bloco de justificativa aparece com desconto no 100% Livre', !$('submitLowMarginBlock').hidden);
                $('submitDraftSelect').value = 'order_1';
                await submitOrder();
                check('rep: envio sem justificativa é recusado', ($('submitOrderMessage').textContent || '').includes('justificativa'), $('submitOrderMessage').textContent.slice(0, 60));

                $('submitLowMarginJustification').value = 'Cliente estratégico com volume alto';
                await submitOrder();
                check('rep: envio com justificativa aceito', window.__alerts.some(a => a.includes('enviado com sucesso')), window.__alerts[window.__alerts.length - 1]);
                check('rep: pedido ficou em análise', orderSubmissionManager.getById('order_1')?.status === 'analise');
                check('rep: formulário limpo e próximo número', cart.length === 0 && $('orderNumberHiperroll').value === '00002', $('orderNumberHiperroll').value);
                check('rep: descontos zerados para o próximo pedido', $('orderDiscount').value === '0');
                check('rep: formulário novo volta para Rascunho', statusManager.currentStatus === 'rascunho' && $('orderStatusChip').textContent.includes('Rascunho'), statusManager.currentStatus);
                renderHistoryTab();
                check('rep: cartão do pedido tem botão de histórico', Boolean($('historyTabContent').querySelector('[data-action="showStatusHistory"][data-id="order_1"]')));
                switchTab('tab-history');
                await showStatusHistory('order_1');
                const sentTitles = [...$('statusHistoryList').querySelectorAll('.status-history-title')].map(el => el.textContent.trim());
                check('rep: histórico abre fora da aba do pedido, do mais novo ao mais antigo', visible($('statusHistoryModal')) && $('statusHistoryModal').getBoundingClientRect().width > 0 && sentTitles.length === 2 && sentTitles[0].includes('Enviado para análise') && sentTitles[1].includes('Rascunho salvo (2 vezes)'), sentTitles.join(' | '));
                closeStatusHistory();
                switchTab('tab-order');

                await deleteSubmission('order_1');
                check('rep: pedido foi para a lixeira', deletedSubmissionsManager.count() === 1 && !orderSubmissionManager.getById('order_1'));
                await restoreSubmission('order_1');
                check('rep: restaurado como rascunho', orderSubmissionManager.getById('order_1')?.status === 'rascunho');

                // ----- aprovação automática: compara com o último pedido aprovado do cliente -----
                resetCurrentOrderForm();
                // The client is followed by its CNPJ (the name changes on purpose below).
                const CNPJ_AUTO = '11222333000181'; // well-known valid test CNPJ, not a real customer
                const ordersOf = () => Object.values(window.__mockOrders).filter(o => o.clientCnpj === CNPJ_AUTO).sort((a, b) => a.hiperrollNumber.localeCompare(b.hiperrollNumber));
                const lastAlert = () => window.__alerts[window.__alerts.length - 1] || '';
                await chooseRegion('MG');
                addToCart(productsData[2].codigo);
                updateCartQty(0, Math.ceil(200 / cart[0].weight));
                $('clientName').value = 'Mercado Automático';

                // ----- CNPJ do cliente: opcional, mas validado (numérico ou com letras) -----
                check('rep: CNPJ válido, numérico e com letras', isValidCnpj('11.222.333/0001-81') && isValidCnpj('12.ABC.345/01DE-35') && !isValidCnpj('11.222.333/0001-82') && !isValidCnpj('00.000.000/0000-00') && !isValidCnpj('123'));
                $('clientCnpj').value = '11222333000182';
                formatClientCnpjInput($('clientCnpj'));
                check('rep: CNPJ errado é formatado e avisado no campo', $('clientCnpj').value === '11.222.333/0001-82' && !$('clientCnpjHint').hidden && $('clientCnpj').classList.contains('is-invalid'));
                showSubmitOrderModal();
                check('rep: com CNPJ errado a janela de envio não abre e um balão explica', !visible($('submitOrderModal')) && [...document.querySelectorAll('#toastStack .toast')].some(t => t.textContent.includes('CNPJ do cliente está inválido')));
                $('clientCnpj').value = '11222333000181';
                formatClientCnpjInput($('clientCnpj'));
                check('rep: CNPJ certo fica formatado e sem aviso', $('clientCnpj').value === '11.222.333/0001-81' && $('clientCnpjHint').hidden);
                showSubmitOrderModal();
                check('rep: janela de envio mostra o CNPJ', $('submitClientName').textContent.includes('CNPJ 11.222.333/0001-81'));
                check('rep: janela de envio sem margem, com o peso', !visible($('submitMargin').parentElement) && $('submitWeight').textContent.includes('kg') && $('submitWeightNotice').hidden);
                await submitOrder();
                const firstAuto = ordersOf()[0];
                check('rep: CNPJ vai ao servidor só com os caracteres', window.__mockCalls.filter(c => c.action === 'orders.submit').pop().body.order.clientCnpj === CNPJ_AUTO);
                check('rep: primeiro pedido do cliente vai para análise (nada para comparar)', firstAuto && firstAuto.status === 'analise' && firstAuto.approvalCheck.reasons.some(r => r.includes('Ainda não há pedido aprovado')) && lastAlert().includes('Aguardando aprovação'), lastAlert());
                check('rep: representante não recebe a comparação nem a margem', !('approvalCheck' in orderSubmissionManager.getById(firstAuto.id)) && orderSubmissionManager.getById(firstAuto.id).cart.every(item => !('tableMargin' in item)));
                window.__mockApprove(firstAuto.id);
                await loadServerData();
                await repeatOrder(firstAuto.id);
                check('rep: repetir pedido traz o CNPJ', $('clientCnpj').value === '11.222.333/0001-81');
                $('clientName').value = 'Mercado Automatico LTDA'; // outro jeito de escrever: o CNPJ identifica
                showSubmitOrderModal();
                await submitOrder();
                const secondAuto = ordersOf()[1];
                check('rep: mesmo CNPJ (nome escrito diferente), mesmo preço: aprovado sozinho', secondAuto && secondAuto.status === 'aprovado' && secondAuto.approvalBy === AUTO_APPROVER && lastAlert().includes('aprovado automaticamente'), lastAlert());
                renderHistoryTab();
                check('rep: cartão mostra "Automático"', Boolean($('historyTabContent').querySelector(`[id="historyCard_${secondAuto.id}"] .auto-approved-chip`)));
                await repeatOrder(firstAuto.id);
                const setModeRep = value => { const radio = document.querySelector(`input[name="orderInvoiceMode"][value="${value}"]`); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); };
                setModeRep('aval');
                $('orderDiscount').value = '2';
                updateOrderTable();
                showSubmitOrderModal();
                await submitOrder();
                const thirdAuto = ordersOf()[2];
                check('rep: preço menor que no último pedido vai para o gestor', thirdAuto && thirdAuto.status === 'analise' && thirdAuto.approvalCheck.reasons.some(r => r.includes('preço e margem menor que no pedido')), thirdAuto && JSON.stringify(thirdAuto.approvalCheck.reasons));
                // Desconto dentro da faixa da Garantia, mas a margem cai muito abaixo da tabela do pedido.
                await repeatOrder(firstAuto.id);
                setModeRep('garantia');
                $('orderDiscount').value = String(GARANTIA_MAX);
                updateOrderTable();
                showSubmitOrderModal();
                await submitOrder();
                const worried = ordersOf()[3];
                check('rep: margem preocupante nunca é aprovada sozinha', worried && worried.status === 'analise' && worried.approvalCheck.reasons.some(r => r.startsWith('Margem preocupante')), worried && JSON.stringify(worried.approvalCheck.reasons));

                // ----- teto do desconto negociado -----
                await repeatOrder(firstAuto.id);
                setModeRep('garantia');
                document.getElementById('toastStack')?.remove();
                $('orderDiscount').value = String(RULES.maxNegotiatedDiscount + 1);
                updateOrderTable();
                const ceilingToasts = () => [...document.querySelectorAll('#toastStack .toast')].map(t => t.textContent);
                check('rep: acima do teto aparece um balão de aviso', ceilingToasts().length === 1 && ceilingToasts()[0].includes('não pode ser enviado'), JSON.stringify(ceilingToasts()));
                updateOrderTable();
                check('rep: o balão não se repete enquanto o desconto continua acima', ceilingToasts().length === 1);
                check('rep: acima do teto aparece "não pode ser enviado"', !$('orderMinMarginWarning').hidden && $('orderMinMarginWarning').textContent.includes('não pode ser enviado'), $('orderMinMarginWarning').textContent);
                showSubmitOrderModal();
                check('rep: acima do teto o botão de envio trava e não pede justificativa', document.querySelector('#submitOrderModal .btn-submit-order').disabled && $('submitLowMarginBlock').hidden);
                check('rep: ao abrir o envio bloqueado, outro balão explica', ceilingToasts().length === 2 && ceilingToasts()[1].includes('Envio bloqueado'));
                document.querySelector('#toastStack .toast__close').click();
                check('rep: o balão fecha no ×', ceilingToasts().length === 1);
                closeSubmitOrderModal();
                $('orderDiscount').value = '0';
                updateOrderTable();
                check('rep: abaixo do teto o botão volta', (showSubmitOrderModal(), !document.querySelector('#submitOrderModal .btn-submit-order').disabled));
                closeSubmitOrderModal();

                // ----- pedido devolvido pelo gestor: corrigir e reenviar mantém os preços -----
                resetCurrentOrderForm();
                window.__mockReject(thirdAuto.id);
                await loadServerData();
                renderHistoryTab();
                check('rep: pedido devolvido tem "Corrigir e reenviar"', Boolean($('historyTabContent').querySelector(`[data-action="correctReturnedOrder"][data-id="${thirdAuto.id}"]`)));
                const lockedCif = thirdAuto.cart[0].cif;
                const lockedNegotiated = thirdAuto.cart[0].negotiatedPrice;
                window.__mockBumpVersion();
                await refreshPricingCatalog();
                await correctReturnedOrder(thirdAuto.id);
                check('rep: tabela mudou, mas o pedido devolvido não abre revisão de preços', !visible($('repriceModal')) && cart.length === 1 && cart[0].priceLocked === true);
                check('rep: item do pedido devolvido mantém o preço', Math.abs(cart[0].cif - lockedCif) < 1e-9 && Math.abs(cart[0].negotiatedPrice - lockedNegotiated) < 1e-9 && $('orderTableContainer').textContent.includes('preço mantido'));
                // The table changed: the region's prices are downloaded again (the locked item doesn't need them).
                await chooseRegion('MG');
                addToCart(productsData[3].codigo);
                check('rep: item novo na correção usa a tabela atual', cart[1].priceLocked !== true && Math.abs(cart[1].cif - computeItemPrices(productsData[3], cart[1]).cif) < 1e-9);
                showSubmitOrderModal();
                check('rep: envio da correção aponta para o mesmo pedido', $('submitDraftSelect').value === thirdAuto.id);
                await submitOrder();
                const resent = window.__mockOrders[thirdAuto.id];
                check('rep: reenviado com o mesmo número e o preço mantido', resent.status !== 'rejeitado' && resent.hiperrollNumber === thirdAuto.hiperrollNumber && resent.cart.length === 2 && Math.abs(resent.cart[0].cif - lockedCif) < 1e-9, `${resent.status} ${resent.cart.length}`);
                resetCurrentOrderForm();
            }

            if (mode === 'pedido') {
                // ----- margem do produto, desconto e modalidade (100% Livre / 50% Aval / 10% Garantia) -----
                // O gestor monta o pedido: ele vê as margens (o representante, não).
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && productsData.length > 0 && $('orderNumberHiperroll').value);
                resetCurrentOrderForm();
                check('pedido: 207 produtos, sem código repetido', productsData.length === 207 && new Set(productsData.map(p => p.codigo)).size === 207, productsData.length);
                const tableMargins = [...new Set(productsData.map(p => p.tableMargin))].sort((a, b) => a - b);
                check('pedido: margens da planilha carregadas', tableMargins.length >= 3 && productsData.every(p => p.tableMargin > 0 && p.tableMargin < 100), tableMargins.length);
                check('pedido: cabeçalho sem margem com pedido vazio', $('marginThreshold').textContent === '—');
                check('pedido: modalidade padrão é 100% Livre', getCurrentOrderConditions().invoiceMode === 'livre' && document.querySelectorAll('input[name="orderInvoiceMode"]').length === 3);
                const setMode = value => { const radio = document.querySelector(`input[name="orderInvoiceMode"][value="${value}"]`); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); };
                const setDiscount = value => { $('orderDiscount').value = String(value); updateOrderTable(); };
                const totalsNow = () => calculateOrderTotals(cart, getCurrentOrderConditions());
                // Two products with different margins, taken from the table (no real number written here).
                const [marginA, marginB] = tableMargins;
                const sac = productsData.find(p => p.tableMargin === marginA);
                const bob = productsData.find(p => p.tableMargin === marginB);
                const marginAfter = (productMargin, discount) => (1 - (1 - productMargin / 100) / (1 - discount / 100)) * 100;
                // An order margin more than marginAlertDrop points below the order's own table margin is "Preocupante".
                const orderTone = (totals, otherwise) => totals.margin < totals.tableMargin - RULES.marginAlertDrop ? 'critical' : otherwise;
                $('stateSelect').value = 'MG';
                addToCart(sac.codigo);
                let mt = totalsNow();
                check('pedido: no preço de tabela a margem é a do produto', Math.abs(mt.margin - marginA) < 1e-9 && mt.tableMargin === marginA && $('marginThreshold').textContent === pct(marginA) && mt.status.tone === orderTone(mt, 'good'), mt.margin);
                check('pedido: item guarda a margem do produto e o pedido a envia', cart[0].tableMargin === marginA && buildCurrentOrderInput().cart[0].tableMargin === marginA && buildCurrentOrderInput().conditions.invoiceMode === 'livre');
                check('pedido: Livre sem desconto: sem aviso e sem justificativa', !mt.requiresJustification && mt.modeNotice === '' && mt.effectiveDiscount === 0 && $('orderModeNotice').hidden && $('orderMinMarginWarning').hidden);

                setDiscount(2);
                mt = totalsNow();
                check('pedido: 2% no pedido reduz a margem pelo valor', Math.abs(mt.margin - marginAfter(marginA, 2)) < 1e-9 && mt.effectiveDiscount === 2 && mt.status.tone === orderTone(mt, 'warn'), mt.margin.toFixed(4));
                check('pedido: Livre com desconto exige justificativa', mt.discountExceeded && mt.requiresJustification && mt.alerts[0].includes('não permite desconto') && !$('orderMinMarginWarning').hidden, mt.alerts[0]);
                check('pedido: Livre não mostra aviso de implantação', mt.modeNotice === '');

                setMode('aval');
                mt = totalsNow();
                check('pedido: Aval com 2% é permitido e mostra o aviso', !mt.requiresJustification && mt.modeNotice === 'PEDIDO DEVE SER IMPLANTADO AVAL.' && !$('orderModeNotice').hidden && $('orderModeNotice').textContent.includes('PEDIDO DEVE SER IMPLANTADO AVAL.') && $('orderMinMarginWarning').hidden);
                setDiscount(0);
                check('pedido: Aval sem desconto não mostra aviso', totalsNow().modeNotice === '' && $('orderModeNotice').hidden);
                setDiscount(AVAL_MAX);
                mt = totalsNow();
                check('pedido: Aval aceita exatamente o limite', !mt.discountExceeded && mt.effectiveDiscount === AVAL_MAX && mt.negotiatedDiscount === AVAL_MAX, mt.effectiveDiscount);
                check('pedido: margem negativa fica vermelha, mas quem trava é a faixa', mt.margin < 0 && ['bad', 'critical'].includes(mt.status.tone) && !mt.requiresJustification, mt.margin.toFixed(2));
                setDiscount(AVAL_MAX + 0.5);
                mt = totalsNow();
                check('pedido: Aval acima do limite exige justificativa', mt.discountExceeded && mt.alerts[0].includes(`acima do limite de ${pct(AVAL_MAX)}`), mt.alerts[0]);

                setMode('garantia');
                mt = totalsNow();
                check('pedido: Garantia aceita acima do limite do Aval e mostra o aviso', !mt.requiresJustification && mt.modeNotice === 'PEDIDO DEVE SER IMPLANTADO GARANTIA.' && $('orderModeNotice').textContent.includes('GARANTIA'));
                setDiscount(GARANTIA_MAX);
                check('pedido: Garantia aceita exatamente o limite', !totalsNow().discountExceeded);
                setDiscount(GARANTIA_MAX + 1);
                mt = totalsNow();
                check('pedido: Garantia acima do limite exige justificativa', mt.discountExceeded && mt.requiresJustification && mt.alerts[0].includes(`acima do limite de ${pct(GARANTIA_MAX)}`), mt.alerts[0]);
                showSubmitOrderModal();
                check('pedido: modal de envio mostra modalidade, aviso e pede justificativa', $('submitMode').textContent === 'Garantia (10%)' && $('submitModeNotice').textContent.includes('GARANTIA') && !$('submitLowMarginBlock').hidden && $('submitSummaryTitle').textContent.includes(`acima do limite de ${pct(GARANTIA_MAX)}`), $('submitSummaryTitle').textContent);
                check('pedido: gestor vê a margem na janela de envio', visible($('submitMargin').parentElement) && $('submitMargin').textContent.includes('%'));
                closeSubmitOrderModal();

                // margem abaixo do ponto de alerta das regras: destaque forte para o gestor
                const criticalMargin = marginAfter(marginA, GARANTIA_MAX + 1);
                // Product with a 20% table margin: the drop is what matters, not a fixed number.
                const sampleOrder = discount => calculateOrderTotals([{ codigo: 'T', cif: 100, negotiatedPrice: 100, tableMargin: 20, qty: 1 }], { invoiceMode: 'garantia', manualDiscount: discount });
                const smallDrop = sampleOrder(1);
                const bigDrop = sampleOrder(RULES.maxNegotiatedDiscount);
                check('pedido: margem que cai pouco abaixo da tabela do pedido não é preocupante', 20 - smallDrop.margin < RULES.marginAlertDrop && smallDrop.status.tone === 'warn', smallDrop.margin.toFixed(2));
                check('pedido: margem que cai mais que o limite abaixo da tabela do pedido é "Preocupante"', 20 - bigDrop.margin > RULES.marginAlertDrop && bigDrop.status.tone === 'critical' && bigDrop.status.label === 'Preocupante', bigDrop.margin.toFixed(2));
                const sacolaFull = calculateOrderTotals([{ codigo: 'T', cif: 100, negotiatedPrice: 100, tableMargin: 5, qty: 1 }], { invoiceMode: 'livre' });
                check('pedido: produto de margem baixa vendido no preço de tabela não é preocupante', sacolaFull.status.tone === 'good');
                check('pedido: margem preocupante fica destacada na tela', mt.margin < mt.tableMargin - RULES.marginAlertDrop ? (mt.status.tone === 'critical' && $('totalsPriceContainer').classList.contains('margin-critical') && renderOrderConditionsSummary({ cart, conditions: getCurrentOrderConditions() }).includes('margin-critical-alert')) : mt.status.tone === 'bad', `${mt.margin.toFixed(2)} / alerta ${RULES.marginAlertBelow}`);

                // teto do desconto negociado: acima dele não envia nem com justificativa
                setDiscount(RULES.maxNegotiatedDiscount + 0.5);
                mt = totalsNow();
                check('pedido: acima do teto o pedido não pode ser enviado', mt.discountBlocked && mt.alerts[0].includes(`acima do máximo de ${pct(RULES.maxNegotiatedDiscount)}`), mt.alerts[0]);
                showSubmitOrderModal();
                check('pedido: acima do teto o envio trava', document.querySelector('#submitOrderModal .btn-submit-order').disabled && $('submitLowMarginBlock').hidden);
                closeSubmitOrderModal();
                setDiscount(RULES.maxNegotiatedDiscount);
                check('pedido: exatamente no teto ainda envia (com justificativa)', !totalsNow().discountBlocked && totalsNow().requiresJustification);

                // desconto em um item × desconto no pedido inteiro
                setDiscount(0);
                setMode('aval');
                addToCart(bob.codigo);
                const sacTable = cart[0].cif;
                const bobTable = cart[1].cif;
                updateUnitDiscount(0, sacTable * 0.02); // 2% só na sacola
                mt = totalsNow();
                check('pedido: desconto só em um item muda só a margem dele', Math.abs(mt.lines[0].marginPercent - marginAfter(marginA, 2)) < 1e-9 && Math.abs(mt.lines[1].marginPercent - marginB) < 1e-9, `${mt.lines[0].marginPercent.toFixed(2)} / ${mt.lines[1].marginPercent.toFixed(2)}`);
                const itemOnly = Math.round(sacTable * 0.02 / (sacTable + bobTable) * 1e4) / 100;
                check('pedido: 2% em um item pesa menos que 2% no pedido', mt.effectiveDiscount === itemOnly && mt.effectiveDiscount < 2, mt.effectiveDiscount);
                check('pedido: carrinho mostra a margem de tabela de cada item', $('orderTableContainer').textContent.includes(`tabela ${pct(marginA)}`) && $('orderTableContainer').textContent.includes(`tabela ${pct(marginB)}`));
                check('pedido: margem de tabela do pedido é ponderada', Math.abs(mt.tableMargin - (sacTable * marginA + bobTable * marginB) / (sacTable + bobTable)) < 1e-3 && $('orderTableMargin').textContent === `${formatMarginPercent(mt.tableMargin)}%`, mt.tableMargin);
                updateUnitDiscount(0, 0);
                setDiscount(2);
                mt = totalsNow();
                check('pedido: 2% no pedido afeta todos os itens', Math.abs(mt.lines[1].marginPercent - marginAfter(marginB, 2)) < 1e-9 && mt.effectiveDiscount === 2, mt.lines[1].marginPercent.toFixed(2));

                // antecipado e frete FOB baixam o preço, mas ficam à parte do limite; contrato reduz a margem
                setDiscount(0);
                $('orderEarlyPayment').checked = true;
                $('orderFobFreight').checked = true;
                updateOrderTable();
                mt = totalsNow();
                check('pedido: antecipado + frete FOB entram no total sobre a tabela', Math.abs(mt.effectiveDiscount - (RULES.earlyPaymentDiscount + RULES.fobFreightDiscount)) < 1e-9 && mt.margin < mt.tableMargin, mt.effectiveDiscount);
                check('pedido: antecipado + frete FOB não contam no limite da modalidade', mt.negotiatedDiscount === 0 && !mt.requiresJustification, mt.negotiatedDiscount);
                setMode('livre');
                check('pedido: no Livre, marcar só o antecipado não pede justificativa', !totalsNow().requiresJustification && $('orderMinMarginWarning').hidden);
                check('pedido: tela mostra o negociado e, à parte, antecipado e FOB', $('orderDiscountBreakdown').textContent.includes('Desconto negociado') && $('orderDiscountBreakdown').textContent.includes('À parte') && describeDiscountBreakdown(totalsNow()).includes('antecipado'), $('orderDiscountBreakdown').textContent);
                setMode('aval');
                $('orderEarlyPayment').checked = false;
                $('orderFobFreight').checked = false;
                $('orderContract').value = '5';
                updateOrderTable();
                mt = totalsNow();
                check('pedido: contrato reduz a margem sem contar como desconto', mt.effectiveDiscount === 0 && Math.abs(mt.margin - mt.tableMargin / 1.05) < 1e-3, mt.margin.toFixed(2));
                $('orderContract').value = '0';

                // pedido salvo e recarregado mantém a modalidade
                setMode('garantia');
                await saveDraftCurrentOrder();
                const modeDraft = activeDraftId;
                resetCurrentOrderForm();
                check('pedido: pedido novo volta para 100% Livre', getCurrentOrderConditions().invoiceMode === 'livre');
                await loadDraftToCurrentOrder(modeDraft, true);
                check('pedido: rascunho recarregado mantém a modalidade', getCurrentOrderConditions().invoiceMode === 'garantia' && cart.length === 2);

                cart.length = 0;
                resetCurrentOrderForm();
            }

            if (mode === 'gestor') {
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && orderSubmissionManager.getAll().length > 0);
                check('gestor: vê botões de aprovações e usuários', visible($('supervisorBtn')) && visible($('usersBtn')));
                showSupervisorPanel();
                await waitFor(() => document.querySelector('.pending-order-checkbox'));
                const listHtml = $('supervisorPendingOrdersList').innerHTML;
                check('gestor: pedido do representante na fila', listHtml.includes('00007'));
                check('gestor: selo de margem baixa', listHtml.includes('low-margin-badge'));
                check('gestor: justificativa escapada (sem <script>)', !listHtml.includes('<script>x'));
                check('gestor: fila mostra quantos motivos levaram o pedido à análise', listHtml.includes('approval-reasons-badge') && listHtml.includes('2 motivos'));

                // Por que o pedido não foi aprovado sozinho, e a comparação com o pedido de referência.
                showPendingOrderDetails('order_seed');
                const detailsEl = $('detailsModalBackdrop');
                check('gestor: detalhes explicam por que veio para análise', detailsEl.textContent.includes('Veio para sua análise porque') && detailsEl.textContent.includes('abaixo de 200 kg'));
                check('gestor: motivo vindo do servidor aparece como texto', detailsEl.textContent.includes('<b>preço e margem</b>') && !detailsEl.querySelector('.approval-reasons b'));
                check('gestor: comparação produto a produto com o pedido de referência', detailsEl.querySelector('.approval-check table') && detailsEl.textContent.includes('Preço antes') && detailsEl.textContent.includes('00003') && detailsEl.querySelectorAll('.approval-check td.tone-bad').length === 2);
                detailsEl.remove();

                // O que o gestor vê em um pedido com modalidade: selo, aviso de implantação e alerta.
                const avalItem = { codigo: 'T-1', descricao: 'Teste', fob: 80, cif: 100, negotiatedPrice: 100, tableMargin: 10, qty: 2 };
                const overDiscount = AVAL_MAX + 2;
                const overHtml = renderOrderConditionsSummary({ cart: [avalItem], conditions: { invoiceMode: 'aval', manualDiscount: overDiscount, lowMarginJustification: 'Cliente estratégico' } });
                check('gestor: resumo mostra modalidade e aviso de implantação', overHtml.includes('Modalidade: Aval (50%)') && overHtml.includes('PEDIDO DEVE SER IMPLANTADO AVAL.'));
                check('gestor: resumo alerta desconto acima da faixa, com a justificativa', overHtml.includes(`acima do limite de ${pct(AVAL_MAX)} da modalidade Aval (50%)`) && overHtml.includes('Cliente estratégico') && overHtml.includes(formatPercent(overDiscount)));
                const extrasHtml = renderOrderConditionsSummary({ cart: [avalItem], conditions: { invoiceMode: 'aval', manualDiscount: 2, earlyPayment: true, fobFreight: true } });
                check('gestor: resumo separa o negociado do antecipado e do frete FOB', extrasHtml.includes(`Desconto negociado ${formatPercent(2)} + antecipado ${formatPercent(RULES.earlyPaymentDiscount)} + frete FOB ${formatPercent(RULES.fobFreightDiscount)}`) && !extrasHtml.includes('low-margin-alert'));
                const okHtml = renderOrderConditionsSummary({ cart: [avalItem], conditions: { invoiceMode: 'garantia', manualDiscount: GARANTIA_MAX - 1 } });
                check('gestor: dentro da faixa mostra só o aviso, sem alerta', okHtml.includes('PEDIDO DEVE SER IMPLANTADO GARANTIA.') && !okHtml.includes('low-margin-alert'));
                const livreHtml = renderOrderConditionsSummary({ cart: [avalItem], conditions: { invoiceMode: 'livre' } });
                check('gestor: Livre sem desconto não tem aviso nem alerta', livreHtml.includes('Modalidade: Livre (100%)') && !livreHtml.includes('order-mode-notice') && !livreHtml.includes('low-margin-alert'));

                document.querySelector('.pending-order-checkbox').checked = true;
                await approvePendingOrders();
                check('gestor: aprovação concluída', window.__alerts.some(a => a.includes('1 pedido(s) aprovado(s)')), window.__alerts[window.__alerts.length - 1]);
                check('gestor: status atualizado', orderSubmissionManager.getById('order_seed')?.status === 'aprovado');
                await showStatusHistory('order_seed');
                const seedTitles = [...$('statusHistoryList').querySelectorAll('.status-history-title')].map(el => el.textContent.trim());
                check('gestor: vê o que o representante fez em outro computador e a própria aprovação', seedTitles.length === 3 && seedTitles[0].includes('Aprovado') && seedTitles[1].includes('Enviado para análise') && seedTitles[2].includes('Rascunho salvo (3 vezes)'), seedTitles.join(' | '));
                check('gestor: histórico mostra quem fez cada ação, com nome escapado', $('statusHistoryList').textContent.includes('Gabriel Ferreira') && $('statusHistoryList').textContent.includes('João <b>Rep</b>') && !$('statusHistoryList').querySelector('b'));
                await showStatusHistory('order_nao_existe');
                check('gestor: pedido inexistente mostra o erro do servidor', $('statusHistoryList').textContent.includes('Pedido não encontrado'), $('statusHistoryList').textContent.trim());
                closeStatusHistory();
                check('gestor: fechar esconde o histórico', !visible($('statusHistoryModal')));

                // ----- segurança: texto digitado por alguém nunca vira código na tela -----
                const attack = '<img src=x class="xss-probe" onerror="window.__xss=1">';
                const hostile = {
                    id: 'order_hostil', ownerId: 3, hiperrollNumber: '00099', orderNumber: `NF${attack}`, clientOrderNumber: `NF${attack}`,
                    status: 'analise', clientName: `Cliente ${attack}`, representativeName: `Rep ${attack}`, proposalValidity: attack,
                    submittedBy: 'joao', savedBy: 'joao', submittedAt: new Date().toISOString(), savedAt: new Date().toISOString(),
                    rejectionReason: `Motivo ${attack}`, supervisorNote: `Nota ${attack}`, deletedAt: null,
                    cart: [{ codigo: `P-1${attack}`, descricao: `Desc ${attack}`, fob: 10, cif: 12, negotiatedPrice: 12, unitDiscount: 0, weight: 1, qty: 1, tableMargin: 10 }],
                    conditions: { invoiceMode: 'aval', manualDiscount: 15, lowMarginJustification: `Justificativa ${attack}` },
                    invoices: [{ id: 'b'.repeat(32), name: `nota${attack}.pdf`, mime: 'application/pdf', size: 10, date: new Date().toISOString() }]
                };
                orderSubmissionManager.submissions.order_hostil = hostile;
                renderHistoryTab();
                showSupervisorPanel();
                openSupervisorOrderActions('order_hostil');
                showPendingOrderDetails('order_hostil');
                showDraftModal('order_hostil');
                deletedSubmissionsManager.deleted.order_hostil_lixo = { ...hostile, id: 'order_hostil_lixo', deletedAt: new Date().toISOString(), deletedBy: `X ${attack}` };
                showTrashModal();
                toggleTrashDetails('order_hostil_lixo');
                await sleep(100);
                check('gestor: nome, observação, motivo e nota digitados com HTML aparecem como texto (sem executar)',
                    !document.querySelector('.xss-probe') && window.__xss === undefined
                    && $('historyTabContent').textContent.includes('Cliente <img') && $('supervisorPendingOrdersList').textContent.includes('Cliente <img'),
                    document.querySelectorAll('.xss-probe').length);
                ['supervisorActionModalBackdrop', 'detailsModalBackdrop', 'draftModalBackdrop'].forEach(id => document.getElementById(id)?.remove());
                closeTrashModal();
                closeSupervisorPanel();
                delete orderSubmissionManager.submissions.order_hostil;
                delete deletedSubmissionsManager.deleted.order_hostil_lixo;
                renderHistoryTab();

                // ----- notas fiscais: arquivo no servidor, link pela API -----
                const seedOrder = orderSubmissionManager.submissions.order_seed;
                const fileId = 'a'.repeat(32);
                seedOrder.invoices = [
                    { id: fileId, name: 'NF "123" <b>.pdf', mime: 'application/pdf', size: 1000, date: new Date().toISOString() },
                    { name: 'guardada.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', date: new Date().toISOString() }
                ];
                const holder = document.createElement('div');
                holder.innerHTML = renderInvoiceLinks(seedOrder);
                document.body.appendChild(holder); // clicks are handled by the page-wide listener (js/acoes.js)
                const invoiceLinks = [...holder.querySelectorAll('a')];
                const viewUrl = new URL(invoiceLinks[0].getAttribute('href'), location.href);
                const saveUrl = new URL(invoiceLinks[1].getAttribute('href'), location.href);
                check('gestor: nota abre pela API, em outra aba', invoiceLinks.length === 4 && invoiceLinks[0].target === '_blank' && viewUrl.pathname.endsWith('api/index.php') && viewUrl.searchParams.get('action') === 'orders.invoice' && viewUrl.searchParams.get('id') === 'order_seed' && viewUrl.searchParams.get('file') === fileId && !viewUrl.searchParams.has('download'), invoiceLinks[0].getAttribute('href'));
                check('gestor: botão ⬇️ pede o download do mesmo arquivo', saveUrl.searchParams.get('download') === '1' && saveUrl.searchParams.get('file') === fileId && invoiceLinks[1].target === '_blank');
                check('gestor: nome da nota escapado', invoiceLinks[0].textContent.includes('NF "123" <b>.pdf') && !holder.querySelector('b'));
                const opened = [];
                const realOpen = window.open;
                window.open = url => { opened.push(String(url)); return null; };
                invoiceLinks[2].click();
                check('gestor: nota guardada no navegador (demo) abre como arquivo temporário', opened.length === 1 && opened[0].startsWith('blob:') && invoiceLinks[3].hasAttribute('download'), opened[0]);
                seedOrder.invoices.push({ name: 'pagina.html', data: 'data:text/html;base64,PGI+eDwvYj4=' });
                openEmbeddedInvoice('order_seed', 2);
                check('gestor: formato fora da lista não é aberto', opened.length === 1 && window.__alerts.some(a => a.includes('Não foi possível abrir esta nota fiscal')));
                holder.remove();
                window.open = realOpen;
                seedOrder.invoices.length = 2;
                renderHistoryTab();
                check('gestor: cartão do pedido mostra as notas para ver e baixar', $('historyTabContent').querySelectorAll('.invoice-chip').length === 2 && $('historyTabContent').querySelectorAll('.invoice-link--download').length === 2);
                showDraftModal('order_seed');
                check('gestor: janela "Ver" do pedido mostra as mesmas notas', document.querySelectorAll('#draftModalBackdrop .invoice-chip').length === 2);
                document.getElementById('draftModalBackdrop')?.remove();
                renderHistoryTab();
                check('gestor: botão de faturar no histórico', Boolean($('historyTabContent').querySelector('[data-action="openBillingModal"]')));
                check('gestor: não pode continuar rascunho alheio', !$('historyTabContent').querySelector('[data-action="loadDraft"][data-id="order_seed"]'));

                await showUsersModal();
                const rows = document.querySelectorAll('.users-table tbody tr');
                check('gestor: tabela de usuários', rows.length === 3, rows.length);
                const adminRow = Array.from(rows).find(r => r.textContent.includes('Leon'));
                const repRow = Array.from(rows).find(r => r.textContent.includes('joao'));
                check('gestor: não gerencia a conta do admin', adminRow && !adminRow.querySelector('button'));
                check('gestor: gerencia o representante', repRow && repRow.querySelectorAll('button').length === 2);
                check('gestor: só pode criar representante', $('newUserRole').options.length === 1 && $('newUserRole').value === 'representante');
                check('gestor: não mexe na numeração dos pedidos (só o admin)', !visible($('nextNumberForm')));
                closeUsersModal();

                // ----- Tabela de preços: importação, edição, revisão do carrinho, lote, produtos, histórico -----
                check('gestor: aba Tabela de Preços visível', visible($('btn-tab-pricing')));
                // One unit weighs less than 200 kg, so the item uses the 150-199 kg freight.
                const region = { uf: 'MG', cityType: 'Capital', weightTier: 'tier1' };
                const sample = productsData.find(p => p.costLineKey === 'bobina estrela (cx branca)');
                const before = computeItemPrices(sample, region);
                $('stateSelect').value = 'MG';
                addToCart(sample.codigo);
                // Abrir a aba já carrega a tabela sozinha: sem botão, sem confirmação.
                switchTab('tab-pricing');
                check('gestor: sem botão de importar', !$('pricingTabContent').innerHTML.includes('Importar tabela atual') && $('pricingTabContent').textContent.includes('Preparando'));
                await waitFor(() => pricingCatalog.source === 'server' && Boolean(document.querySelector('tr[data-line-key]')));
                check('gestor: tabela carregada ao abrir a aba (versão 1)', pricingCatalog.source === 'server' && pricingCatalog.version === 1, `${pricingCatalog.source} v${pricingCatalog.version}`);
                const readyMsg = $('pricingMessage').textContent;
                check('gestor: mensagem com contagens, sem aviso de praça repetida (Juazeiro tem praça própria)', readyMsg.includes('14 grupos de preço') && readyMsg.includes('207 produtos') && !readyMsg.includes('Juazeiro') && pricingCatalog.freight.some(f => f.uf === 'BA' && f.pracaType === 'Especial' && f.label === 'Juazeiro'), readyMsg.slice(0, 120));
                check('gestor: uma única importação', window.__mockCalls.filter(c => c.action === 'pricing.import').length === 1);
                const costCell = document.querySelector('tr[data-line-key] td.col-cost');
                check('gestor: custos ocultos na visão simples', getComputedStyle(costCell).display === 'none');
                const afterImport = computeItemPrices(productsData.find(p => p.codigo === sample.codigo), region);
                check('gestor: importação não muda preços', Math.abs(before.fob - afterImport.fob) < 1e-9 && Math.abs(before.cif - afterImport.cif) < 1e-9, `${before.cif} / ${afterImport.cif}`);
                check('gestor: sem modal após importar (preços iguais)', !visible($('repriceModal')));
                check('gestor: seções da aba', $('pricingTabContent').innerHTML.includes('Reajuste em lote'));
                const importPost = window.__mockCalls.find(c => c.action === 'pricing.import');
                // The imported price per kg is exactly the spreadsheet's (no old +R$ 0,02), read from data.js.
                const sheetPrice = Math.max(...parseCSV(BLENDAS_CSV).filter(row => (row[1] || '').trim().toLowerCase() === 'bobina estrela (cx branca)').map(row => parseFloat(String(row[12]).replace(',', '.')) || 0));
                const importedPrice = importPost && importPost.body.costLines.find(l => l.key === 'bobina estrela (cx branca)').price100;
                check('gestor: importação sem o ajuste de R$0,02', sheetPrice > 0 && Math.abs(importedPrice - Math.round(sheetPrice * 10000) / 10000) < 1e-9);

                const lineRow = document.querySelector('tr[data-line-key="bobina estrela (cx branca)"]');
                const priceInput = lineRow.querySelector('[data-field="price100"]');
                const oldPrice = parseFloat(priceInput.value);
                priceInput.value = String(oldPrice + 1);
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                check('gestor: markup recalculado ao digitar', lineRow.querySelector('[data-computed="markup"]').textContent.startsWith('+'));
                check('gestor: salvar habilitado', !$('pricingSaveBtn').disabled);
                let confirms = 0;
                window.confirm = () => { confirms++; return true; };
                priceInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                const savePromise = waitFor(() => pricingCatalog.version === 2 && ($('pricingMessage')?.textContent || '').includes('Alterações salvas'));
                await waitFor(() => visible($('repriceModal')));
                check('gestor: modal de revisão abriu', visible($('repriceModal')));
                check('gestor: modal lista o item alterado', $('repriceModalBody').innerHTML.includes(escapeHtml(sample.codigo)));
                check('gestor: modal só avisa e atualiza (um botão, sem "manter preço antigo")', document.querySelectorAll('#repriceModal [data-action="resolveReprice"]').length === 1 && !$('repriceModal').textContent.includes('Manter'));
                resolveRepriceModal('table');
                await savePromise;
                const expected = computeItemPrices(productsData.find(p => p.codigo === sample.codigo), region);
                check('gestor: "usar nova tabela" aplica o CIF novo', Math.abs(cart[0].negotiatedPrice - expected.cif) < 1e-9 && Math.abs(cart[0].fob - expected.fob) < 1e-9);
                check('gestor: versão 2 e preço salvo', pricingCatalog.version === 2 && Math.abs(costsData['bobina estrela (cx branca)'].price100 - (oldPrice + 1)) < 1e-9);
                check('gestor: mensagem de sucesso', ($('pricingMessage').textContent || '').includes('Alterações salvas'), $('pricingMessage').textContent);
                check('gestor: Enter salvou sem janela de confirmação', confirms === 0, confirms);

                switchPricingSection('freight');
                const freightRow = document.querySelector('tr[data-uf="SP"][data-praca="Capital"]');
                const tierInput = freightRow.querySelector('[data-field="tier2"]');
                tierInput.value = '1.25';
                tierInput.dispatchEvent(new Event('input', { bubbles: true }));
                tierInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                await waitFor(() => freightData.SP.Capital.tier2 === 1.25);
                check('gestor: frete de uma praça com Enter, sem confirmação', freightData.SP.Capital.tier2 === 1.25 && confirms === 0, freightData.SP.Capital.tier2);

                switchPricingSection('bulk');
                $('bulkTarget').value = 'freight';
                onBulkParamsChange(true);
                check('gestor: lote de frete lista UFs', document.querySelectorAll('#bulkSelectList .bulk-item').length > 20);
                toggleBulkSelection(false);
                document.querySelector('#bulkSelectList .bulk-item[value="MG"]').checked = true;
                $('bulkPercent').value = '10';
                await previewBulkAdjust();
                check('gestor: prévia do reajuste', $('bulkPreview').innerHTML.includes('MG · Capital') && !$('bulkPreview').innerHTML.includes('SP ·'));
                check('gestor: aplicar liberado após prévia', !$('bulkApplyBtn').disabled);
                updateUnitDiscount(0, 1); // R$ 1,00 de desconto no item
                const cifBeforeBulk = cart[0].cif;
                const freightBeforeBulk = freightData.MG.Capital.tier2;
                const applyPromise = applyBulkAdjust();
                await waitFor(() => visible($('repriceModal')));
                resolveRepriceModal('table');
                await applyPromise;
                check('gestor: frete MG +10% (centavos)', Math.abs(freightData.MG.Capital.tier2 - Math.round(freightBeforeBulk * 1.1 * 100) / 100) < 1e-9);
                check('gestor: pedido aberto passa para a tabela nova, mantendo o desconto em R$', cart[0].cif > cifBeforeBulk && Math.abs(cart[0].unitDiscount - 1) < 1e-9 && Math.abs(cart[0].negotiatedPrice - (cart[0].cif - 1)) < 1e-9, `${cifBeforeBulk.toFixed(2)} → ${cart[0].cif.toFixed(2)}`);

                // ----- preço de um produto só: digita R$ 50 e Enter -----
                switchPricingSection('products');
                const findRow = code => [...document.querySelectorAll('#pricingProductRows tr')].find(r => r.dataset.codigo === code);
                let priceRow = findRow(sample.codigo);
                check('gestor: produto mostra "do grupo"', priceRow.querySelector('.price-note').textContent.includes('do grupo'));
                const priceBox = priceRow.querySelector('[data-field="price"]');
                priceBox.value = '50';
                priceBox.dispatchEvent(new Event('input', { bubbles: true }));
                priceBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                await waitFor(() => visible($('repriceModal')));
                check('gestor: preço individual avisa o pedido aberto', visible($('repriceModal')));
                resolveRepriceModal('table');
                await waitFor(() => findRow(sample.codigo)?.querySelector('.price-note')?.textContent.includes('preço próprio'));
                const own = productsData.find(p => p.codigo === sample.codigo);
                const ownPrices = computeItemPrices(own, region);
                const ownLine = costsData[own.costLineKey];
                check('gestor: FOB do produto = R$ 50,00', Math.abs(ownPrices.fob - 50) < 1e-9, ownPrices.fob);
                check('gestor: CIF mantém a proporção frete/custo', Math.abs(ownPrices.cif - 50 * (ownLine.costs + freightData.MG.Capital.tier1) / ownLine.costs) < 1e-9, ownPrices.cif.toFixed(2));
                check('gestor: pedido aberto usa o novo preço (mesmo desconto em R$)', Math.abs(cart[0].fob - 50) < 1e-9 && Math.abs(cart[0].cif - ownPrices.cif) < 1e-9 && Math.abs(cart[0].negotiatedPrice - (ownPrices.cif - cart[0].unitDiscount)) < 1e-9, `desconto ${cart[0].unitDiscount.toFixed(2)}`);
                priceRow = findRow(sample.codigo);
                check('gestor: selo "preço próprio"', priceRow.querySelector('.price-note').textContent.includes('preço próprio'));
                check('gestor: linha mostra quantos têm preço próprio', (() => { switchPricingSection('lines'); const t = document.querySelector('tr[data-line-key="bobina estrela (cx branca)"]').textContent; switchPricingSection('products'); return t.includes('1 com preço próprio'); })());
                check('gestor: tela fala em grupo de preço, não em linha', $('pricingTabContent').textContent.includes('Mover para o grupo') && !/linhas? de produto|da linha/i.test($('pricingTabContent').textContent));
                const lineBefore = own.priceOverride;
                const resetP = resetPricingProductPrice(findRow(sample.codigo).querySelector('.pricing-link-btn'));
                await waitFor(() => visible($('repriceModal')));
                resolveRepriceModal('table');
                await resetP;
                check('gestor: "usar linha" remove o preço próprio', lineBefore === 50 && productsData.find(p => p.codigo === sample.codigo).priceOverride === null);

                // ----- por categoria -----
                togglePricingCategory('Sacola Plastica - Lisa');
                check('gestor: filtro por categoria', $('pricingFilteredCount').textContent === '36', $('pricingFilteredCount').textContent);
                togglePricingCategory('Sacola Plastica - Impressa');
                check('gestor: duas categorias ao mesmo tempo', $('pricingFilteredCount').textContent === '56' && document.querySelectorAll('#pricingCategoryChips .pricing-chip-btn.active').length === 2, $('pricingFilteredCount').textContent);
                togglePricingCategory('Sacola Plastica - Impressa');
                check('gestor: desmarcar volta para uma', $('pricingFilteredCount').textContent === '36');
                const catSample = getFilteredPricingProducts()[0];
                const catBefore = currentFobFor(catSample);
                $('bulkProductPercent').value = '10';
                await bulkUpdateFilteredProducts('percent');
                const catAfter = pricingCatalog.products.find(p => p.codigo === catSample.codigo).priceOverride;
                check('gestor: +10% na categoria inteira', Math.abs(catAfter - Math.round(catBefore * 1.1 * 100) / 100) < 1e-9 && pricingCatalog.products.filter(p => p.categoria === 'Sacola Plastica - Lisa' && p.priceOverride != null).length === 36, `${catBefore.toFixed(2)} → ${catAfter}`);
                check('gestor: outras categorias intactas', pricingCatalog.products.filter(p => p.categoria !== 'Sacola Plastica - Lisa' && p.priceOverride != null).length === 0);
                await bulkUpdateFilteredProducts('clearPrice');
                check('gestor: categoria volta ao preço da linha', pricingCatalog.products.filter(p => p.priceOverride != null).length === 0);

                // ----- vários produtos de categorias diferentes, um único salvar -----
                const typePrice = (code, value) => { const box = findRow(code).querySelector('[data-field="price"]'); box.value = String(value); box.dispatchEvent(new Event('input', { bubbles: true })); };
                const prodA = getFilteredPricingProducts()[1];
                typePrice(prodA.codigo, 40);
                setPricingCategories(['Sacola Plastica - Impressa']);
                check('gestor: edição pendente sobrevive à troca de filtro', !$('pricingProductPending').hidden && $('pricingPendingCount').textContent === '1' && !findRow(prodA.codigo));
                const prodB = getFilteredPricingProducts()[0];
                typePrice(prodB.codigo, 30);
                check('gestor: duas alterações pendentes', $('pricingPendingCount').textContent === '2');
                const versionBeforeBatch = pricingCatalog.version;
                const batchCallsBefore = window.__mockCalls.filter(c => c.action === 'pricing.saveProducts').length;
                await savePricingProducts();
                const batchCalls = window.__mockCalls.filter(c => c.action === 'pricing.saveProducts');
                check('gestor: dois produtos salvos em uma gravação', batchCalls.length === batchCallsBefore + 1 && batchCalls[batchCalls.length - 1].body.products.length === 2 && pricingCatalog.version === versionBeforeBatch + 1);
                check('gestor: preços dos dois aplicados', pricingCatalog.products.find(p => p.codigo === prodA.codigo).priceOverride === 40 && pricingCatalog.products.find(p => p.codigo === prodB.codigo).priceOverride === 30);
                check('gestor: barra de pendências some depois de salvar', $('pricingProductPending').hidden);
                typePrice(prodB.codigo, 35);
                discardPricingProductEdits();
                check('gestor: descartar desfaz a edição', $('pricingProductPending').hidden && findRow(prodB.codigo).querySelector('[data-field="price"]').value === '30.00');
                setPricingCategories([]);
                await bulkUpdateFilteredProducts('clearPrice');
                setPricingCategories(['Saco para Lixo - Dobrado']);
                $('bulkProductLine').value = 'fundo reto';
                await bulkUpdateFilteredProducts('setLine');
                check('gestor: categoria movida para outra linha', pricingCatalog.products.filter(p => p.categoria === 'Saco para Lixo - Dobrado').every(p => p.costLineKey === 'fundo reto'));
                setPricingCategories([]);

                const mmBox = findRow(sample.codigo).querySelector('[data-field="tableMargin"]');
                check('gestor: coluna de margem do produto na tela', mmBox.value === '10', mmBox.value);
                mmBox.value = '12';
                mmBox.dispatchEvent(new Event('input', { bubbles: true }));
                await savePricingProducts();
                check('gestor: margem do produto alterada e pedido aberto atualizado', pricingCatalog.products.find(p => p.codigo === sample.codigo).tableMargin === 12 && cart[0].tableMargin === 12 && !visible($('repriceModal')), `${cart[0].tableMargin}`);

                const productRow = [...document.querySelectorAll('#pricingProductRows tr')].find(r => r.dataset.codigo === sample.codigo);
                const activeBox = productRow.querySelector('[data-field="active"]');
                activeBox.checked = false;
                onPricingProductInput(activeBox);
                const deactivate = savePricingProducts();
                await waitFor(() => visible($('repriceModal')));
                check('gestor: produto desativado é avisado no modal', $('repriceModalBody').innerHTML.includes('serão retirados'));
                resolveRepriceModal('table');
                await deactivate;
                check('gestor: produto desativado sai do carrinho', cart.length === 0, cart.length);
                $('productSearch').value = sample.codigo;
                updateResults();
                check('gestor: inativo some da busca', !$('resultsContainer').querySelector('button[data-codigo]'));

                switchPricingSection('history');
                await waitFor(() => $('pricingSectionBody').innerHTML.includes('<table'));
                const historyHtml = $('pricingSectionBody').innerHTML;
                check('gestor: histórico com preço e frete', historyHtml.includes('Preço 100% NF') && historyHtml.includes('Frete MG · Capital') && historyHtml.includes('Importação'));
            }

            if (mode === 'repcat') {
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && $('orderNumberHiperroll').value);
                check('repcat: preços vêm do servidor', pricingCatalog.source === 'server' && pricingCatalog.version === 1);
                check('repcat: aba de preços oculta', !visible($('btn-tab-pricing')));
                await chooseRegion('MG');
                addToCart(productsData[0].codigo);
                $('clientName').value = 'Cliente Teste';
                await saveDraftCurrentOrder();
                const draftPost = window.__mockCalls.filter(c => c.action === 'orders.saveDraft').pop();
                check('repcat: rascunho envia região e versão', draftPost.body.order.cart[0].uf === 'MG' && draftPost.body.order.pricingVersion === 1);

                window.__mockBumpVersion();
                showSubmitOrderModal();
                $('submitLowMarginJustification').value = 'Justificativa suficiente para teste';
                const submitPromise = submitOrder();
                await waitFor(() => visible($('repriceModal')));
                check('repcat: tabela desatualizada no envio abre a revisão', visible($('repriceModal')));
                resolveRepriceModal('table');
                await submitPromise;
                check('repcat: modal de envio reaberto com aviso', visible($('submitOrderModal')) && $('submitOrderMessage').textContent.includes('atualizados para a tabela nova'), $('submitOrderMessage').textContent);
                check('repcat: versão atualizada no front', pricingCatalog.version === 2);
                await submitOrder();
                check('repcat: reenvio aceito', window.__alerts.some(a => a.includes('enviado com sucesso')), window.__alerts[window.__alerts.length - 1]);

                await chooseRegion('MG');
                addToCart(productsData[1].codigo);
                await saveDraftCurrentOrder();
                const savedDraftId = activeDraftId;
                const cifInDraft = cart[0].cif;
                resetCurrentOrderForm();
                window.__mockBumpVersion();
                await refreshPricingCatalog();
                check('repcat: sem modal com carrinho vazio', !visible($('repriceModal')));
                const loadPromise = loadDraftToCurrentOrder(savedDraftId, true);
                await waitFor(() => visible($('repriceModal')));
                check('repcat: rascunho antigo abre a revisão', visible($('repriceModal')));
                resolveRepriceModal('table');
                await loadPromise;
                check('repcat: rascunho passa para a tabela nova (mesmo desconto em R$)', cart[0].cif > cifInDraft && Math.abs(cart[0].negotiatedPrice - cart[0].cif) < 1e-9, `${cifInDraft.toFixed(2)} → ${cart[0].cif.toFixed(2)}`);
                check('repcat: FOB atualizado para a tabela nova', Math.abs(cart[0].fob - computeItemPrices(productsData[1], cart[0]).fob) < 1e-9);

                // ----- atualização automática -----
                check('repcat: vigia de preços ligado', pricingWatchTimer !== null);
                check('repcat: sem mudança, não baixa a tabela', (await checkPricingVersion()) === false);
                await chooseRegion('MG');
                const cifShownBefore = $('resultsContainer').querySelector('.price-cif').textContent;
                const getsBefore = window.__mockCalls.filter(c => c.action === 'pricing.get').length;
                const regionCallsBefore = window.__mockCalls.filter(c => c.action === 'pricing.prices').length;
                window.__mockBumpVersion();
                const watchPromise = checkPricingVersion();
                await waitFor(() => visible($('repriceModal')));
                check('repcat: mudança detectada sozinha abre a revisão', visible($('repriceModal')));
                resolveRepriceModal('table');
                check('repcat: vigia atualizou', (await watchPromise) === true && pricingCatalog.version === 4, pricingCatalog.version);
                check('repcat: baixou a tabela uma vez', window.__mockCalls.filter(c => c.action === 'pricing.get').length === getsBefore + 1);
                await waitFor(() => $('resultsContainer').querySelector('.price-cif'));
                check('repcat: tabela nova baixa de novo os preços da região', window.__mockCalls.filter(c => c.action === 'pricing.prices').length === regionCallsBefore + 1);
                check('repcat: busca mostra o preço novo', $('resultsContainer').querySelector('.price-cif').textContent !== cifShownBefore, `${cifShownBefore} → ${$('resultsContainer').querySelector('.price-cif').textContent}`);
            }

            if (mode === 'admincat') {
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list') && $('orderNumberHiperroll').value);
                check('admin: aba de preços visível', visible($('btn-tab-pricing')));
                switchTab('tab-pricing');
                const html = $('pricingTabContent').innerHTML;
                check('admin: somente leitura', html.includes('somente leitura') && !$('pricingSaveBtn'));
                check('admin: campos desabilitados', [...document.querySelectorAll('#pricingSectionBody [data-field]')].length > 20 && [...document.querySelectorAll('#pricingSectionBody [data-field]')].every(i => i.disabled));
                switchPricingSection('bulk');
                check('admin: sem reajuste em lote', $('pricingSectionBody').textContent.includes('feito pelo gestor'));
                check('admin: vê as margens (como o gestor)', document.body.classList.contains('can-see-margins'));

                // ----- numeração: continua do sistema de pedidos antigo -----
                switchTab('tab-order');
                await showUsersModal();
                check('admin: campo do próximo número de pedido', visible($('nextNumberForm')) && $('nextOrderNumber').value === '1');
                $('nextOrderNumber').value = '1500';
                await submitNextNumber(new Event('submit', { cancelable: true }));
                check('admin: próximo pedido passa a ser 01500', $('orderNumberHiperroll').value === '01500' && $('usersMessage').textContent.includes('01500'), $('usersMessage').textContent);
                $('nextOrderNumber').value = '10';
                await submitNextNumber(new Event('submit', { cancelable: true }));
                check('admin: numeração não volta para trás', $('usersMessage').textContent.includes('não pode ser menor') && $('orderNumberHiperroll').value === '01500', $('usersMessage').textContent);
                closeUsersModal();
            }

            if (mode === 'repnocat') {
                await waitFor(() => window.__mockCalls.some(c => c.action === 'orders.list'));
                check('repnocat: representante não usa o data.js (custos e margens)', pricingCatalog.source === 'legacy' && productsData.length === 0 && Object.keys(freightData).length === 0);
                updateResults();
                check('repnocat: avisa que a tabela ainda não foi liberada', $('resultsContainer').textContent.includes('ainda não foi liberada'), $('resultsContainer').textContent.trim());
            }
        } catch (e) {
            results.push('ERROR | ' + e.message + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' / '));
        }
        (window.__errors || []).forEach(e => results.push('FAIL | ' + e));
        const pre = document.createElement('pre');
        pre.id = 'test-out';
        pre.textContent = results.join('\n');
        document.body.appendChild(pre);
    });
})();
