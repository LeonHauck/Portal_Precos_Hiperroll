// Simulated API following the same contract as api/index.php (for front-end wiring tests only).
// Test pages read data.js straight from disk (no login needed to "download" it).
window.PORTAL_DATA_LOCKED = false;

(function () {
    window.__errors = [];
    // Anything the page's Content-Security-Policy blocks (inline code, foreign scripts) fails the test.
    document.addEventListener('securitypolicyviolation', e => window.__errors.push(`CSP bloqueou ${e.violatedDirective}: ${e.blockedURI || e.sample || ''}`));
    window.addEventListener('error', e => window.__errors.push('JS ERROR: ' + e.message));
    window.addEventListener('unhandledrejection', e => window.__errors.push('UNHANDLED: ' + (e.reason && e.reason.message || e.reason)));
    window.__alerts = [];
    window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
    window.prompt = () => null;

    const mode = new URLSearchParams(location.search).get('mode') || 'rep';
    // Commercial rules the simulated server sends with the session (test fixture with the same shape
    // as pricing_rules_for_client() in api/lib/pricing.php).
    // Regras FICTÍCIAS, só para os testes: os números reais ficam em api/regras_comerciais.php,
    // que não vai para o Git. Os testes calculam o esperado a partir destes valores.
    const TEST_RULES = {
        defaultProductMargin: 12, earlyPaymentDiscount: 1.5, fobFreightDiscount: 2.5, minJustificationLength: 10, defaultInvoiceMode: 'livre',
        maxNegotiatedDiscount: 18, marginAlertBelow: 8,
        invoiceModes: [
            { key: 'livre', name: 'Livre', invoiceShare: '100%', maxDiscount: 0, notice: '' },
            { key: 'aval', name: 'Aval', invoiceShare: '50%', maxDiscount: 8, notice: 'PEDIDO DEVE SER IMPLANTADO AVAL.' },
            { key: 'garantia', name: 'Garantia', invoiceShare: '10%', maxDiscount: 15, notice: 'PEDIDO DEVE SER IMPLANTADO GARANTIA.' }
        ]
    };
    window.__testRules = TEST_RULES;
    // Session token the simulated server hands out (the real one is random, see api/lib/auth.php).
    const FAKE_CSRF = 'tok123';
    const users = {
        gestor: { id: 1, username: 'Gabriel.Ferreira', displayName: 'Gabriel Ferreira', role: 'gestor', active: true, mustChangePassword: false },
        admin: { id: 2, username: 'Leon', displayName: 'Leon Hauck', role: 'admin', active: true, mustChangePassword: false },
        rep: { id: 3, username: 'joao', displayName: 'João Rep', role: 'representante', active: true, mustChangePassword: false },
        newrep: { id: 4, username: 'novo', displayName: 'Novo Rep', role: 'representante', active: true, mustChangePassword: true }
    };
    // README screenshots use made-up people, never the real team.
    if (mode.startsWith('readme') || mode.startsWith('layout')) {
        Object.assign(users.gestor, { username: 'gestor.demo', displayName: 'Gestor Demo' });
        Object.assign(users.rep, { username: 'rep.demo', displayName: 'Representante Demo' });
        Object.assign(users.admin, { username: 'admin.demo', displayName: 'Administrador Demo' });
    }
    const userKey = { repcat: 'rep', repnocat: 'rep', pedido: 'gestor', admincat: 'admin', shot: 'gestor', shotdark: 'gestor', shotmodal: 'gestor', mapping: 'rep', shotprod: 'gestor', productlist: 'rep', shotorder: 'rep', shothist: 'gestor', shothistdark: 'gestor', readme_precos: 'rep', readme_pedido: 'rep', readme_historico: 'gestor', readme_tabela: 'gestor', readme_aprovacoes: 'gestor', readme_pedidos: 'gestor', readme_faturamento: 'gestor', readme_usuarios: 'gestor', layout_hist: 'gestor', layout_super: 'gestor', layout_users: 'gestor', layout_mobile: 'rep', layout_full: 'rep', layout_dark: 'rep' }[mode] || mode;
    const me = mode === 'anon' || mode === 'readme_login' ? null : users[userKey];
    // A representative never uses data.js (api/data.php doesn't deliver it to them): their scenarios
    // start with the table already in the database, except 'repnocat'.
    const catalogPreImported = ['rep', 'repcat', 'pedido', 'admincat', 'readme_tabela'].includes(mode) || (me && me.role === 'representante' && mode !== 'repnocat');
    // Margins only for gestor/admin (can_see_margins in api/lib/pricing.php).
    const seesMargins = () => me && ['gestor', 'admin'].includes(me.role);
    const stripOrder = o => {
        if (seesMargins()) return o;
        delete o.approvalCheck;
        (o.cart || []).forEach(item => { delete item.tableMargin; });
        Object.values(o.lockedPrices || {}).forEach(lock => { delete lock.tableMargin; });
        return o;
    };
    const pad = n => String(n).padStart(5, '0');
    let counter = 0;
    const orders = {};
    window.__mockCalls = [];
    window.__mockOrders = orders;
    // Same role as the server's audit_log for order actions (feeds orders.history).
    const events = [];
    window.__mockEvents = events;
    const logEvent = (action, id, reason = '') => events.push({ action, target: id, username: me.username, displayName: me.displayName, reason, at: new Date().toISOString() });

    if (mode === 'gestor' || mode.startsWith('shothist')) {
        counter = 7;
        orders.order_seed = {
            id: 'order_seed', ownerId: 3, hiperrollNumber: '00007', orderNumber: '00007', status: 'analise',
            clientName: 'Mercado Teste', representativeName: 'João Rep', submittedBy: 'joao', savedBy: 'joao',
            submittedAt: new Date().toISOString(), savedAt: new Date().toISOString(), deletedAt: null,
            cart: [{ codigo: 'P-07007', descricao: 'TESTE', fob: 100, cif: 120, negotiatedPrice: 120, unitDiscount: 0, weight: 4, qty: 1 }],
            conditions: { manualDiscount: 10, contract: 0, earlyPayment: false, fobFreight: false, earlyPaymentPercent: 1.5, fobFreightPercent: 2.5, lowMarginJustification: 'Cliente estratégico <script>x</script>' },
            // What check_auto_approval() wrote when it was sent (the reason text comes from the server).
            approvalCheck: {
                auto: false, margin: -2, reference: { orderNumber: '00003', clientName: 'Mercado Teste', sameClient: true, margin: 5 },
                items: [{ codigo: 'P-07007', unitPrice: 108, margin: -2, refOrderNumber: '00003', refUnitPrice: 115, refMargin: 5, samePlace: true, worse: 'preço e margem' }],
                reasons: ['Pedido com 4,0 kg, abaixo de 200 kg', 'Produto P-07007 com <b>preço e margem</b> menor que no pedido 00003']
            }
        };
        // What the representative did on another computer: three saves, then the submit.
        ['save_draft', 'save_draft', 'save_draft', 'submit'].forEach((action, i) => events.push({
            action, target: 'order_seed', username: 'joao', displayName: 'João <b>Rep</b>', reason: '', at: new Date(Date.now() - (10 - i) * 60000).toISOString()
        }));
    }
    if (['readme_historico', 'readme_aprovacoes', 'readme_pedidos', 'readme_faturamento', 'layout_hist', 'layout_super'].includes(mode)) {
        counter = 12;
        const at = minutesAgo => new Date(Date.now() - minutesAgo * 60000).toISOString();
        const item = (codigo, descricao, fob, cif, qty) => ({ codigo, descricao, fob, cif, negotiatedPrice: cif, unitDiscount: 0, weight: 2, qty, tableMargin: 10 });
        const seed = (id, number, status, clientName, minutes, extra = {}) => {
            orders[id] = Object.assign({
                id, ownerId: 3, hiperrollNumber: number, orderNumber: number, status, clientName,
                representativeName: 'Representante Demo', submittedBy: 'rep.demo', savedBy: 'rep.demo', proposalValidity: '30 dias',
                submittedAt: at(minutes), savedAt: at(minutes), deletedAt: null,
                cart: [item('X-0001', 'PRODUTO EXEMPLO A', 100, 108, 20), item('X-0002', 'PRODUTO EXEMPLO B', 80, 86, 10)],
                conditions: { invoiceMode: 'livre', manualDiscount: 0, contract: 0, earlyPayment: false, fobFreight: false, earlyPaymentPercent: 1.5, fobFreightPercent: 2.5, lowMarginJustification: '' }
            }, extra);
        };
        seed('order_a', '00012', 'aprovado', 'Mercado Exemplo', 30, { approvalAt: at(30), approvalBy: 'gestor.demo', billingStatus: 'parcial', invoices: [{ id: 'a'.repeat(32), name: 'NF 1234.pdf', mime: 'application/pdf', size: 1000, date: at(10) }] });
        seed('order_b', '00011', 'analise', 'Distribuidora Modelo', 90);
        seed('order_c', '00010', 'analise', 'Atacado Exemplo', 150, { conditions: { invoiceMode: 'aval', manualDiscount: 5, contract: 0, earlyPayment: false, fobFreight: false, earlyPaymentPercent: 1.5, fobFreightPercent: 2.5, lowMarginJustification: '' } });
        orders.order_a.billedQuantities = { 'X-0001': 20 };
        orders.order_a.billingHistory = [{ date: at(10), predictedNextDate: at(-4 * 1440), billedMap: { 'X-0001': 20 } }];
        orders.order_a.predictedBillingDate = at(-4 * 1440);
        const log = (action, target, minutes, who, reason = '') => events.push({ action, target, username: who === 'g' ? 'gestor.demo' : 'rep.demo', displayName: who === 'g' ? 'Gestor Demo' : 'Representante Demo', reason, at: at(minutes) });
        log('save_draft', 'order_a', 240, 'r'); log('save_draft', 'order_a', 235, 'r'); log('submit', 'order_a', 200, 'r');
        log('reject', 'order_a', 150, 'g', 'Revisar a quantidade do item B com o cliente');
        log('submit', 'order_a', 60, 'r'); log('approve', 'order_a', 30, 'g'); log('billing', 'order_a', 10, 'g');
    }
    // A browser that used the old version still has the status and its history stored locally.
    localStorage.setItem('orderStatus', 'analise');
    localStorage.setItem('orderStatusHistory', JSON.stringify([{ statusNovo: 'analise', usuario: 'antigo', dataFormatada: '01/01/2026' }]));

    const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    const ok = data => json(200, Object.assign({ success: true }, data));
    const err = (status, message, code) => json(status, Object.assign({ success: false, message }, code ? { code } : {}));
    const clone = o => JSON.parse(JSON.stringify(o));
    const visibleOrder = o => stripOrder(clone(o));
    const list = deleted => Object.values(orders).filter(o => Boolean(o.deletedAt) === deleted).map(visibleOrder);
    const round2 = v => Math.round(v * 100) / 100;

    // ----- price table (same rules as api/lib/catalog.php) -----
    let catalog = null;
    const history = [];
    const log = (entity, key, field, oldValue, newValue, note) => history.unshift({ id: history.length + 1, batchId: 'b', entity, entityKey: key, field, oldValue: oldValue == null ? null : String(oldValue), newValue: newValue == null ? null : String(newValue), username: me.username, note: note || null, createdAt: new Date().toISOString() });
    const canAdmin = () => me && ['gestor', 'admin'].includes(me.role);
    const importFrom = data => {
        catalog = { version: 1, costLines: clone(data.costLines), freight: clone(data.freight), products: clone(data.products).map(p => Object.assign({ active: true }, p)) };
        log('catalog', 'import', 'import', null, `${data.costLines.length} linhas`, 'Importação inicial do data.js');
    };
    const catalogPayload = () => catalog
        ? { imported: true, version: catalog.version, canEdit: me.role === 'gestor', costLines: clone(catalog.costLines), freight: clone(catalog.freight), products: clone(catalog.products.filter(p => canAdmin() || p.active)).map(p => { if (!seesMargins()) delete p.tableMargin; return p; }) }
        : { imported: false, version: 0, canEdit: me.role === 'gestor', costLines: [], freight: [], products: [] };

    // ----- same order rules as api/lib/orders.php (locked prices, auto-approval) -----
    const lockKey = item => `${item.codigo}|${item.uf || ''}|${item.cityType || ''}`;
    const lockPrices = cart => Object.fromEntries((cart || []).map(item => [lockKey(item), { fob: item.fob, cif: item.cif, weight: item.weight, tableMargin: item.tableMargin, weightTier: item.weightTier || '' }]));
    // Like apply_catalog_prices: margins come from the table (the representative's browser has none).
    const applyServerPrices = (cart, locked) => cart.map(item => {
        const lock = locked[lockKey(item)];
        if (lock) return Object.assign(item, lock, { unitDiscount: Math.max(lock.cif - item.negotiatedPrice, 0) });
        const product = catalog && catalog.products.find(p => p.codigo === item.codigo);
        if (product) item.tableMargin = product.tableMargin;
        return item;
    });
    const clientKey = name => String(name || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    const forComparison = (cart, conditions) => calculateOrderTotals(cart, Object.assign({}, conditions, { earlyPayment: false, fobFreight: false }));
    const autoApprovalCheck = (order, excludeId) => {
        const reasons = [];
        const totals = calculateOrderTotals(order.cart, order.conditions);
        if (totals.requiresJustification) reasons.push('Desconto negociado acima do limite da modalidade (com justificativa)');
        if (totals.totalWeight < 200) reasons.push(`Pedido com ${formatBRL(totals.totalWeight, 1)} kg, abaixo de 200 kg`);
        const refs = Object.values(orders)
            .filter(o => o.id !== excludeId && o.status === 'aprovado' && !o.deletedAt && (o.cart || []).length)
            .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
        const key = clientKey(order.clientName);
        const cnpj = normalizeCnpj(order.clientCnpj);
        // Same client: same CNPJ when both have one, otherwise the same name (is_same_client).
        const sameClient = r => (cnpj && r.clientCnpj ? normalizeCnpj(r.clientCnpj) === cnpj : Boolean(key) && clientKey(r.clientName) === key);
        const clientRef = refs.find(sameClient) || null;
        const orderRef = clientRef || refs[0] || null;
        const current = forComparison(order.cart, order.conditions);
        const check = { auto: false, margin: current.margin, reference: null, items: [], reasons };
        if (!orderRef) {
            reasons.push('Ainda não há pedido aprovado para comparar');
        } else {
            const refTotals = forComparison(orderRef.cart, orderRef.conditions);
            check.reference = { orderNumber: orderRef.orderNumber, clientName: orderRef.clientName, sameClient: Boolean(clientRef), margin: refTotals.margin };
            if (current.margin < refTotals.margin - 0.005) reasons.push(`Margem do pedido menor que a do pedido ${orderRef.orderNumber}`);
        }
        const candidates = clientRef ? [clientRef, ...refs] : refs;
        current.lines.forEach(line => {
            const entry = { codigo: line.item.codigo, unitPrice: line.netUnit, margin: line.marginPercent, refOrderNumber: null, refUnitPrice: null, refMargin: null, samePlace: false, worse: '' };
            let found = null;
            for (const ref of candidates) {
                const refLine = forComparison(ref.cart, ref.conditions).lines.find(l => l.item.codigo === line.item.codigo);
                if (refLine) { found = [ref, refLine]; break; }
            }
            if (!found) {
                reasons.push(`Produto ${entry.codigo} sem pedido aprovado para comparar`);
            } else {
                const [ref, refLine] = found;
                const samePlace = line.item.uf === refLine.item.uf && line.item.cityType === refLine.item.cityType && line.item.weightTier === refLine.item.weightTier;
                const lowerMargin = line.marginPercent < refLine.marginPercent - 0.005;
                const lowerPrice = samePlace && line.netUnit < refLine.netUnit - 0.005;
                const worse = lowerPrice && lowerMargin ? 'preço e margem' : lowerPrice ? 'preço' : lowerMargin ? 'margem' : '';
                Object.assign(entry, { refOrderNumber: ref.orderNumber, refUnitPrice: refLine.netUnit, refMargin: refLine.marginPercent, samePlace, worse });
                if (worse) reasons.push(`Produto ${entry.codigo} com ${worse} menor que no pedido ${ref.orderNumber}`);
            }
            check.items.push(entry);
        });
        check.auto = reasons.length === 0;
        return check;
    };
    // Test hooks: the gestor approves / returns an order "in another browser".
    window.__mockApprove = id => { Object.assign(orders[id], { status: 'aprovado', approvalBy: 'gestor.demo' }); };
    window.__mockReject = (id, reason = 'Revisar a quantidade') => { Object.assign(orders[id], { status: 'rejeitado', rejectionReason: reason, lockedPrices: lockPrices(orders[id].cart) }); };
    const assertLine = l => {
        const costs = l.custoBase + l.despCom + l.despAdm;
        if (costs <= 0 || l.price100 <= costs) throw new Error(`Na linha "${l.name}", o preço 100% NF precisa ser maior que custo + despesas.`);
    };
    // Test hook: the gestor raises every price by 10% "in another browser".
    window.__mockBumpVersion = () => {
        catalog.costLines.forEach(l => { l.price100 = round2(l.price100 * 1.1); });
        catalog.version++;
    };

    window.fetch = async (url, opts = {}) => {
        const query = new URL(url, location.href).searchParams;
        const action = query.get('action');
        const method = opts.method || 'GET';
        const headers = opts.headers || {};
        const body = opts.body ? JSON.parse(opts.body) : {};
        window.__mockCalls.push({ action, method, csrf: headers['X-CSRF-Token'], body, id: query.get('id') });
        if (method === 'POST' && headers['X-CSRF-Token'] !== FAKE_CSRF) return err(419, 'csrf');
        if (catalogPreImported && !catalog && action !== 'session' && typeof buildLegacyCatalog === 'function') importFrom(buildLegacyCatalog());

        try {
            switch (action) {
                case 'session': {
                    const rules = me ? clone(TEST_RULES) : null;
                    if (rules && !seesMargins()) { delete rules.defaultProductMargin; delete rules.marginAlertBelow; }
                    return ok({ user: me, rules, csrfToken: FAKE_CSRF });
                }
                case 'orders.list':
                    return ok({ orders: list(false), trash: list(true), nextNumber: pad(counter + 1) });
                case 'orders.history': {
                    const target = orders[query.get('id')];
                    if (!target || (me.role !== 'gestor' && target.ownerId !== me.id)) return err(404, 'Pedido não encontrado.');
                    return ok({ history: events.filter(e => e.target === target.id).map(({ target: ignored, ...entry }) => entry) });
                }
                case 'orders.saveDraft':
                case 'orders.submit': {
                    if (!body.order.cart.length) return err(422, 'Adicione itens');
                    const submit = action === 'orders.submit';
                    // Own draft or own order returned by the gestor: updated in place (editable_order_row).
                    const editable = body.id && orders[body.id] && orders[body.id].ownerId === me.id && !orders[body.id].deletedAt && ['rascunho', 'rejeitado'].includes(orders[body.id].status);
                    const locked = editable ? (orders[body.id].lockedPrices || {}) : {};
                    const hasUnlocked = body.order.cart.some(item => !locked[lockKey(item)]);
                    if (submit && hasUnlocked && catalog && body.order.pricingVersion !== catalog.version) {
                        return err(409, 'A tabela de preços foi atualizada pelo gestor. Confira os novos valores antes de enviar.', 'pricing_outdated');
                    }
                    const input = clone(body.order);
                    input.clientCnpj = normalizeCnpj(input.clientCnpj);
                    if (input.clientCnpj && !isValidCnpj(input.clientCnpj)) return err(422, 'O CNPJ do cliente está inválido. Corrija ou deixe em branco.');
                    input.cart = applyServerPrices(input.cart, locked);
                    let check = null;
                    if (submit) {
                        const totals = calculateOrderTotals(input.cart, input.conditions);
                        if (totals.discountBlocked) return err(422, `${totals.alerts.join('. ')}. Reduza o desconto para enviar.`);
                        if (totals.requiresJustification && String(input.conditions.lowMarginJustification || '').trim().length < 10) {
                            return err(422, `${totals.alerts.join('. ')}. Informe uma justificativa com pelo menos 10 caracteres para enviar.`);
                        }
                        check = autoApprovalCheck(input, editable ? body.id : '');
                    }
                    let o = editable ? orders[body.id] : null;
                    if (!o) {
                        counter++;
                        o = { id: 'order_' + counter, ownerId: me.id, hiperrollNumber: pad(counter) };
                        orders[o.id] = o;
                    }
                    Object.assign(o, input, {
                        orderNumber: body.order.clientOrderNumber || o.hiperrollNumber,
                        pricingVersion: catalog ? catalog.version : 0,
                        savedBy: me.username, submittedBy: me.username, savedAt: new Date().toISOString(), deletedAt: null,
                        status: submit ? (check.auto ? 'aprovado' : 'analise') : 'rascunho'
                    });
                    if (submit) {
                        Object.assign(o, { submittedAt: new Date().toISOString(), approvalCheck: check, approvalBy: check.auto ? 'Aprovação automática' : '', rejectionReason: '' });
                    }
                    logEvent(submit ? 'submit' : 'save_draft', o.id);
                    if (check && check.auto) logEvent('auto_approve', o.id);
                    return ok({ order: visibleOrder(o), nextNumber: pad(counter + 1) });
                }
                case 'orders.setNextNumber': {
                    if (me.role !== 'admin') return err(403, 'Você não tem permissão para esta ação.');
                    const next = parseInt(body.nextNumber, 10);
                    if (!(next > counter)) return err(422, `O próximo número não pode ser menor que ${pad(counter + 1)}: números já usados não voltam.`);
                    counter = next - 1;
                    return ok({ nextNumber: pad(counter + 1) });
                }
                case 'orders.trash':
                    body.ids.forEach(id => { orders[id].deletedAt = new Date().toISOString(); orders[id].deletedBy = me.username; logEvent('trash', id); });
                    return ok({ trashed: body.ids.length });
                case 'orders.restore':
                    Object.assign(orders[body.id], { deletedAt: null, status: 'rascunho' });
                    delete orders[body.id].lockedPrices;
                    delete orders[body.id].approvalCheck;
                    logEvent('restore', body.id);
                    return ok({ order: visibleOrder(orders[body.id]) });
                case 'orders.approve': {
                    if (me.role !== 'gestor') return err(403, 'Você não tem permissão para esta ação.');
                    const done = [];
                    let skipped = 0;
                    body.ids.forEach(id => {
                        if (orders[id] && orders[id].status === 'analise') { orders[id].status = 'aprovado'; logEvent('approve', id); done.push(clone(orders[id])); } else { skipped++; }
                    });
                    return ok({ orders: done, skipped });
                }
                case 'orders.reject': {
                    if (me.role !== 'gestor') return err(403, 'Você não tem permissão para esta ação.');
                    const done = [];
                    body.ids.forEach(id => {
                        if (orders[id] && orders[id].status === 'analise') {
                            window.__mockReject(id, body.reason);
                            logEvent('reject', id, body.reason);
                            done.push(clone(orders[id]));
                        }
                    });
                    return ok({ orders: done, skipped: body.ids.length - done.length });
                }
                case 'users.list':
                    return ok({ users: [users.gestor, users.admin, users.rep] });

                case 'pricing.get':
                    return ok({ catalog: catalogPayload() });
                case 'pricing.import':
                    if (!canAdmin()) return err(403, 'Você não tem permissão para esta ação.');
                    if (catalog) return err(409, 'A tabela de preços já foi importada.');
                    importFrom(body);
                    return ok({ imported: { costLines: body.costLines.length, freight: body.freight.length, products: body.products.length }, catalog: catalogPayload() });
                case 'pricing.updateCostLines': {
                    if (me.role !== 'gestor') return err(403, 'Você não tem permissão para esta ação.');
                    let changed = 0;
                    body.lines.forEach(input => {
                        assertLine(input);
                        const line = catalog.costLines.find(l => l.key === input.key);
                        if (!line) { catalog.costLines.push(clone(input)); changed++; return; }
                        ['name', 'custoBase', 'despCom', 'despAdm', 'price100'].forEach(f => {
                            if (line[f] !== input[f]) { log('cost_line', line.key, { custoBase: 'custo_base', despCom: 'desp_com', despAdm: 'desp_adm' }[f] || f, line[f], input[f], body.note); line[f] = input[f]; changed++; }
                        });
                    });
                    if (changed) catalog.version++;
                    return ok({ changed, catalog: catalogPayload() });
                }
                case 'pricing.updateFreight': {
                    let changed = 0;
                    body.rows.forEach(r => {
                        const idx = catalog.freight.findIndex(f => f.uf === r.uf && f.pracaType === r.pracaType);
                        if (r.remove) { if (idx >= 0) { catalog.freight.splice(idx, 1); changed++; } return; }
                        if (idx < 0) catalog.freight.push({ uf: r.uf, pracaType: r.pracaType, label: r.label, tier1: r.tier1, tier2: r.tier2 });
                        else Object.assign(catalog.freight[idx], { label: r.label, tier1: r.tier1, tier2: r.tier2 });
                        changed++;
                    });
                    if (changed) catalog.version++;
                    return ok({ changed, catalog: catalogPayload() });
                }
                case 'pricing.saveProduct': {
                    const p = body.product;
                    const existing = catalog.products.find(x => x.codigo === p.codigo);
                    if (p.isNew) {
                        if (existing) return err(409, `Já existe um produto com o código ${p.codigo}.`);
                        catalog.products.push({ codigo: p.codigo, descricao: p.descricao, categoria: p.categoria, subcat: p.subcat, costLineKey: p.costLineKey, weight: p.weight, ncm: p.ncm, active: true, priceOverride: p.priceOverride ?? null });
                    } else {
                        if (existing.active !== p.active) log('product', p.codigo, 'active', existing.active ? 1 : 0, p.active ? 1 : 0);
                        Object.assign(existing, { descricao: p.descricao, costLineKey: p.costLineKey, weight: p.weight, active: p.active, priceOverride: p.priceOverride ?? null });
                    }
                    catalog.version++;
                    return ok({ changed: 1, catalog: catalogPayload() });
                }
                case 'pricing.bulkAdjust': {
                    const factor = 1 + body.percent / 100;
                    const changes = [];
                    const apply = [];
                    if (body.target === 'costLines') {
                        const fields = { priceAndCosts: ['custoBase', 'despCom', 'despAdm', 'price100'], price: ['price100'], costs: ['custoBase', 'despCom', 'despAdm'] }[body.mode];
                        catalog.costLines.filter(l => body.keys.includes(l.key)).forEach(l => {
                            const next = Object.assign({}, l);
                            fields.forEach(f => { next[f] = round2(l[f] * factor); });
                            assertLine(next);
                            fields.forEach(f => { if (next[f] !== l[f]) changes.push({ entity: 'cost_line', key: l.key, label: l.name, field: { custoBase: 'custo_base', despCom: 'desp_com', despAdm: 'desp_adm' }[f] || f, oldValue: l[f], newValue: next[f] }); });
                            apply.push(() => Object.assign(l, next));
                        });
                    } else {
                        catalog.freight.filter(f => body.keys.includes(f.uf)).forEach(f => {
                            ['tier1', 'tier2'].forEach(t => {
                                const v = round2(f[t] * factor);
                                if (v !== f[t]) {
                                    changes.push({ entity: 'freight', key: `${f.uf}/${f.pracaType}`, label: `${f.uf} · ${f.pracaType}`, field: t, oldValue: f[t], newValue: v });
                                    apply.push(() => { f[t] = v; });
                                }
                            });
                        });
                    }
                    if (!changes.length) return err(422, 'Nenhum valor mudaria com esse reajuste.');
                    if (body.preview) return ok({ applied: false, percent: body.percent, changes });
                    apply.forEach(fn => fn());
                    changes.forEach(c => log(c.entity, c.key, c.field, c.oldValue, c.newValue, `Reajuste em lote de ${body.percent}%. ${body.note || ''}`.trim()));
                    catalog.version++;
                    return ok({ applied: true, percent: body.percent, changes, catalog: catalogPayload() });
                }
                case 'pricing.saveProducts': {
                    if (me.role !== 'gestor') return err(403, 'Você não tem permissão para esta ação.');
                    let changed = 0;
                    body.products.forEach(p => {
                        const existing = catalog.products.find(x => x.codigo === p.codigo);
                        const snapshot = x => JSON.stringify([x.descricao, x.costLineKey, x.weight, x.active, x.priceOverride ?? null, x.tableMargin]);
                        const before = snapshot(existing);
                        if (existing.active !== p.active) log('product', p.codigo, 'active', existing.active ? 1 : 0, p.active ? 1 : 0);
                        Object.assign(existing, { descricao: p.descricao, costLineKey: p.costLineKey, weight: p.weight, active: p.active, priceOverride: p.priceOverride ?? null, tableMargin: p.tableMargin });
                        if (snapshot(existing) !== before) changed++;
                    });
                    if (changed) catalog.version++;
                    return ok({ changed, catalog: catalogPayload() });
                }
                case 'pricing.version':
                    window.__versionChecks = (window.__versionChecks || 0) + 1;
                    return ok({ imported: Boolean(catalog), version: catalog ? catalog.version : 0 });
                case 'pricing.bulkProducts': {
                    if (me.role !== 'gestor') return err(403, 'Você não tem permissão para esta ação.');
                    let changed = 0;
                    body.codigos.forEach(code => {
                        const p = catalog.products.find(x => x.codigo === code);
                        if (!p) return;
                        const line = catalog.costLines.find(l => l.key === p.costLineKey);
                        if (body.action === 'percent') { p.priceOverride = round2((p.priceOverride ?? line.price100 * p.weight) * (1 + body.percent / 100)); changed++; }
                        else if (body.action === 'setLine') { if (p.costLineKey !== body.costLineKey) { p.costLineKey = body.costLineKey; changed++; } }
                        else if (p.priceOverride != null) { p.priceOverride = null; changed++; }
                    });
                    if (changed) catalog.version++;
                    return ok({ changed, catalog: catalogPayload() });
                }
                case 'pricing.history':
                    return ok({ history: clone(history) });
                default:
                    return err(404, 'mock: ação não simulada ' + action);
            }
        } catch (e) {
            return err(422, e.message);
        }
    };
})();
