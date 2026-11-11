<?php

const ORDER_STATUSES = ['rascunho', 'analise', 'aprovado', 'rejeitado'];
const MAX_CART_ITEMS = 500;

// Only whitelisted, typed fields from the browser ever reach the database.
function sanitize_cart($cart): array
{
    if (!is_array($cart)) {
        return [];
    }
    if (count($cart) > MAX_CART_ITEMS) {
        fail(422, 'O pedido tem itens demais (máximo ' . MAX_CART_ITEMS . ').');
    }
    $clean = [];
    foreach ($cart as $item) {
        if (!is_array($item)) {
            continue;
        }
        $codigo = str_field($item['codigo'] ?? '', 40);
        if ($codigo === '') {
            continue;
        }
        $uf = strtoupper(str_field($item['uf'] ?? '', 2));
        $cityType = (string) ($item['cityType'] ?? '');
        $weightTier = (string) ($item['weightTier'] ?? '');
        $clean[] = [
            'codigo' => $codigo,
            'descricao' => str_field($item['descricao'] ?? '', 200),
            'fob' => num_field($item['fob'] ?? 0),
            'cif' => num_field($item['cif'] ?? 0),
            'negotiatedPrice' => num_field($item['negotiatedPrice'] ?? 0),
            'unitDiscount' => num_field($item['unitDiscount'] ?? 0),
            'weight' => num_field($item['weight'] ?? 0),
            // Margin of the product at full table price (%), the base of the item's margin; replaced
            // by the price table's value in apply_catalog_prices() once the table is in the database.
            'tableMargin' => is_numeric($item['tableMargin'] ?? null) ? min(num_field($item['tableMargin']), 100.0) : pricing_default_product_margin(),
            'qty' => max((int) ($item['qty'] ?? 0), 1),
            // Region the CIF was quoted for, so the price can be recalculated when the table changes.
            'uf' => preg_match('/^[A-Z]{2}$/', $uf) ? $uf : '',
            'cityType' => in_array($cityType, PRACA_TYPES, true) ? $cityType : '',
            'weightTier' => in_array($weightTier, FREIGHT_TIERS, true) ? $weightTier : '',
        ];
    }
    return $clean;
}

// CNPJ do cliente: numeric or alphanumeric (letters in the first 12 positions, used by the
// Receita Federal since July 2026). Check digits: each character is worth its ASCII code − 48,
// weights 5..2,9..2 and 6..2,9..2, remainder of the division by 11. Same as isValidCnpj() in js/regras.js.
function normalize_cnpj($value): string
{
    return (string) preg_replace('/[^0-9A-Z]/', '', strtoupper(is_string($value) ? $value : ''));
}

function is_valid_cnpj(string $cnpj): bool
{
    if (!preg_match('/^[0-9A-Z]{12}[0-9]{2}$/', $cnpj) || preg_match('/^(.)\1{13}$/', $cnpj)) {
        return false;
    }
    $digit = function (string $base, array $weights): int {
        $sum = 0;
        foreach ($weights as $i => $weight) {
            $sum += (ord($base[$i]) - 48) * $weight;
        }
        $rest = $sum % 11;
        return $rest < 2 ? 0 : 11 - $rest;
    };
    $first = $digit($cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    $second = $digit(substr($cnpj, 0, 12) . $first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return substr($cnpj, 12) === $first . $second;
}

function sanitize_order_input($order): array
{
    $o = is_array($order) ? $order : [];
    // Optional; when typed it must be valid, because it identifies the client in the comparison
    // with the last order (check_auto_approval).
    $cnpj = normalize_cnpj($o['clientCnpj'] ?? '');
    if ($cnpj !== '' && !is_valid_cnpj($cnpj)) {
        fail(422, 'O CNPJ do cliente está inválido. Corrija ou deixe em branco.');
    }
    return [
        'clientOrderNumber' => str_field($o['clientOrderNumber'] ?? '', 40),
        'clientName' => str_field($o['clientName'] ?? '', 120),
        'clientCnpj' => $cnpj,
        'representativeName' => str_field($o['representativeName'] ?? '', 120),
        'proposalValidity' => str_field($o['proposalValidity'] ?? '', 40),
        'cart' => sanitize_cart($o['cart'] ?? []),
        'conditions' => normalize_order_conditions($o['conditions'] ?? []),
        'pricingVersion' => max((int) ($o['pricingVersion'] ?? 0), 0),
    ];
}

function load_order_row(string $id): ?array
{
    $stmt = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

// $viewer = who will receive the order. A representative gets it without any margin (product
// margins in the items, the order margin and the gestor's comparison). Without a viewer (the
// backup) the order goes out complete.
function order_to_client(array $row, ?array $viewer = null): array
{
    $payload = json_decode($row['payload'], true) ?: [];
    $order = array_merge($payload, [
        'id' => $row['id'],
        'ownerId' => (int) $row['owner_id'],
        'status' => $row['status'],
        'hiperrollNumber' => $row['hiperroll_number'],
        'deletedAt' => $row['deleted_at'],
        'deletedBy' => $row['deleted_by'],
    ]);
    return $viewer !== null && !can_see_margins($viewer) ? strip_order_margins($order) : $order;
}

function strip_order_margins(array $order): array
{
    unset($order['approvalCheck']);
    if (isset($order['pricingSnapshot']) && is_array($order['pricingSnapshot'])) {
        unset($order['pricingSnapshot']['margin']);
    }
    foreach (['cart', 'lockedPrices'] as $list) {
        if (isset($order[$list]) && is_array($order[$list])) {
            foreach ($order[$list] as $key => $item) {
                if (is_array($item)) {
                    unset($order[$list][$key]['tableMargin']);
                }
            }
        }
    }
    return $order;
}

function can_view_order(array $row, array $user): bool
{
    return is_gestor($user) || (int) $row['owner_id'] === (int) $user['id'];
}

function require_visible_order(string $id, array $user): array
{
    $row = load_order_row($id);
    if (!$row || !can_view_order($row, $user)) {
        fail(404, 'Pedido não encontrado.');
    }
    return $row;
}

function write_order(array $row, array $payload, string $status): void
{
    $stmt = db()->prepare('UPDATE orders SET payload = ?, status = ?, updated_at = ? WHERE id = ?');
    $stmt->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), $status, now_iso(), $row['id']]);
}

function format_hiperroll_number(int $value): string
{
    return str_pad((string) $value, 5, '0', STR_PAD_LEFT);
}

function peek_next_hiperroll_number(): string
{
    $value = db()->query("SELECT value FROM counters WHERE name = 'hiperroll_order'")->fetchColumn();
    return format_hiperroll_number(((int) $value) + 1);
}

// Must run inside a transaction: the UPDATE takes SQLite's write lock, so two
// representatives saving at the same moment can never receive the same number.
function reserve_hiperroll_number(): string
{
    $pdo = db();
    $pdo->exec("INSERT OR IGNORE INTO counters (name, value) VALUES ('hiperroll_order', 0)");
    $pdo->exec("UPDATE counters SET value = value + 1 WHERE name = 'hiperroll_order'");
    $value = (int) $pdo->query("SELECT value FROM counters WHERE name = 'hiperroll_order'")->fetchColumn();
    return format_hiperroll_number($value);
}

// The admin types the next number to use (the one the old web system would give next). It can
// only move forward, so a number already given to an order is never handed out again.
function set_next_hiperroll_number($value): string
{
    $next = filter_var($value, FILTER_VALIDATE_INT);
    if ($next === false || $next < 1 || $next > 99999999) {
        fail(422, 'Informe o próximo número de pedido: um número inteiro maior que zero.');
    }
    $pdo = db();
    $pdo->exec("INSERT OR IGNORE INTO counters (name, value) VALUES ('hiperroll_order', 0)");
    $stmt = $pdo->prepare("UPDATE counters SET value = ? WHERE name = 'hiperroll_order' AND value <= ?");
    $stmt->execute([$next - 1, $next - 1]);
    if ($stmt->rowCount() === 0) {
        fail(422, 'O próximo número não pode ser menor que ' . peek_next_hiperroll_number() . ': números já usados não voltam.');
    }
    audit('order.set_next_number', null, ['nextNumber' => $next]);
    return peek_next_hiperroll_number();
}

function list_orders(array $user): array
{
    if (is_gestor($user)) {
        $stmt = db()->query('SELECT * FROM orders ORDER BY updated_at DESC');
    } else {
        $stmt = db()->prepare('SELECT * FROM orders WHERE owner_id = ? ORDER BY updated_at DESC');
        $stmt->execute([$user['id']]);
    }

    $orders = [];
    $trash = [];
    foreach ($stmt->fetchAll() as $row) {
        if ($row['deleted_at'] === null) {
            $orders[] = order_to_client($row, $user);
        } else {
            $trash[] = order_to_client($row, $user);
        }
    }
    return ['orders' => $orders, 'trash' => $trash];
}

// Timeline shown by the "📋 Histórico" button. It is read from audit_log, which every order
// action below already writes, so it is the same on any computer and for whoever may see the
// order (its representative and the gestor).
function order_history(array $user, string $id): array
{
    require_visible_order($id, $user);
    $stmt = db()->prepare(
        "SELECT a.action, a.username, a.details, a.created_at, u.display_name
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.target = ? AND a.action LIKE 'order.%'
          ORDER BY a.id"
    );
    $stmt->execute([$id]);

    $history = [];
    foreach ($stmt->fetchAll() as $entry) {
        $details = json_decode((string) $entry['details'], true) ?: [];
        $history[] = [
            'action' => substr($entry['action'], strlen('order.')),
            'at' => $entry['created_at'],
            'username' => (string) $entry['username'],
            'displayName' => (string) ($entry['display_name'] ?? ''),
            'reason' => is_string($details['reason'] ?? null) ? $details['reason'] : '',
        ];
    }
    return $history;
}

function clear_decision_fields(array $payload): array
{
    foreach (['rejectionReason', 'rejectionBy', 'rejectionAt', 'approvalAt', 'approvalBy'] as $field) {
        $payload[$field] = '';
    }
    return $payload;
}

// PEDIDO DEVOLVIDO: when the gestor rejects an order, the prices of its items are kept in
// payload.lockedPrices. If the representative corrects and resends that same order, those items
// keep their prices even if the table changed meanwhile (decision of 2026-11-10); items added
// during the correction use the table in force. Key: product + region.
function locked_price_key(array $item): string
{
    return ($item['codigo'] ?? '') . '|' . ($item['uf'] ?? '') . '|' . ($item['cityType'] ?? '');
}

function lock_order_prices(array $cart): array
{
    $locked = [];
    foreach ($cart as $item) {
        if (!is_array($item) || !isset($item['codigo'])) {
            continue;
        }
        $locked[locked_price_key($item)] = [
            'fob' => (float) ($item['fob'] ?? 0),
            'cif' => (float) ($item['cif'] ?? 0),
            'weight' => (float) ($item['weight'] ?? 0),
            'tableMargin' => (float) ($item['tableMargin'] ?? pricing_default_product_margin()),
            'weightTier' => (string) ($item['weightTier'] ?? ''),
        ];
    }
    return $locked;
}

// Only the owner's own draft, or own order returned by the gestor, is updated in place; anything
// else (under analysis, approved, in the trash, someone else's) becomes a new order.
function editable_order_row($id, array $user): ?array
{
    if (!is_string($id) || $id === '') {
        return null;
    }
    $row = load_order_row($id);
    if ($row && $row['deleted_at'] === null && (int) $row['owner_id'] === (int) $user['id'] && in_array($row['status'], ['rascunho', 'rejeitado'], true)) {
        return $row;
    }
    return null;
}

function save_order(array $user, $id, $orderInput, bool $submit): array
{
    $input = sanitize_order_input($orderInput);
    if (!$input['cart']) {
        fail(422, $submit ? 'Adicione itens ao pedido antes de enviar.' : 'Adicione itens antes de salvar o rascunho.');
    }

    $existing = editable_order_row($id, $user);
    $existingPayload = $existing ? (json_decode($existing['payload'], true) ?: []) : [];
    $locked = is_array($existingPayload['lockedPrices'] ?? null) ? $existingPayload['lockedPrices'] : [];
    $hasUnlockedItems = false;
    foreach ($input['cart'] as $item) {
        if (!isset($locked[locked_price_key($item)])) {
            $hasUnlockedItems = true;
        }
    }

    // The representative must see the new prices before sending: the front reloads the table,
    // shows what changed (new orders and drafts always move to the table in force), then submits
    // again. Items with locked prices don't depend on the table, so they never block.
    $currentPricingVersion = pricing_version();
    if ($submit && $hasUnlockedItems && catalog_is_imported() && $input['pricingVersion'] !== $currentPricingVersion) {
        fail(409, 'A tabela de preços foi atualizada pelo gestor. Confira os novos valores antes de enviar.', 'pricing_outdated');
    }
    $input['cart'] = apply_catalog_prices($input['cart'], $submit, $locked);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $now = now_iso();
        if ($existing) {
            $orderId = $existing['id'];
            $number = $existing['hiperroll_number'];
            $payload = json_decode($existing['payload'], true) ?: [];
        } else {
            $orderId = 'order_' . bin2hex(random_bytes(8));
            $number = reserve_hiperroll_number();
            $payload = ['submittedBy' => $user['username'], 'supervisorNote' => ''];
        }

        $conditions = $input['conditions'];
        $payload = array_merge($payload, [
            'clientOrderNumber' => $input['clientOrderNumber'],
            'orderNumber' => $input['clientOrderNumber'] !== '' ? $input['clientOrderNumber'] : $number,
            'clientName' => $input['clientName'],
            'clientCnpj' => $input['clientCnpj'],
            'representativeName' => $input['representativeName'],
            'proposalValidity' => $input['proposalValidity'],
            'cart' => $input['cart'],
            'pricingVersion' => $currentPricingVersion,
            'savedAt' => $now,
            'savedBy' => $user['username'],
        ]);

        $status = 'rascunho';
        $autoApproved = false;
        if ($submit) {
            $pricing = calculate_order_totals($input['cart'], $conditions);
            // Above the ceiling the order is never sent, justification or not.
            if ($pricing['discountBlocked']) {
                fail(422, implode('. ', $pricing['alerts']) . '. Reduza o desconto para enviar.');
            }
            // Discount above the modality's limit: the order may still be sent, but only with a
            // justification, and it reaches the gestor flagged.
            if ($pricing['requiresJustification'] && mb_strlen($conditions['lowMarginJustification'], 'UTF-8') < pricing_min_justification_length()) {
                fail(422, sprintf(
                    '%s. Informe uma justificativa com pelo menos %d caracteres para enviar.',
                    implode('. ', $pricing['alerts']),
                    pricing_min_justification_length()
                ));
            }
            if (!$pricing['requiresJustification']) {
                $conditions['lowMarginJustification'] = '';
            }
            $payload = clear_decision_fields($payload);
            $payload['pricingSnapshot'] = [
                'margin' => $pricing['margin'],
                'discountPercent' => $pricing['discountPercent'],
                'effectiveDiscount' => $pricing['effectiveDiscount'],
                'negotiatedDiscount' => $pricing['negotiatedDiscount'],
                'invoiceMode' => $conditions['invoiceMode'],
                'totalNet' => $pricing['totalNet'],
                'totalInvoice' => $pricing['totalInvoice'],
                'totalWeight' => $pricing['totalWeight'],
                'discountExceeded' => $pricing['discountExceeded'],
            ];
            $payload['submittedAt'] = $now;
            $payload['submittedBy'] = $user['username'];

            // Approved on its own when nothing needs the gestor's eyes (see check_auto_approval).
            $check = check_auto_approval($input['cart'], $conditions, $pricing, $existing ? $orderId : '', $input['clientName'], $input['clientCnpj']);
            $payload['approvalCheck'] = $check;
            $autoApproved = $check['auto'];
            if ($autoApproved) {
                $payload['approvalAt'] = $now;
                $payload['approvalBy'] = AUTO_APPROVER;
                $payload['predictedBillingDate'] = gmdate('Y-m-d\TH:i:s\Z', time() + 8 * 86400);
                $status = 'aprovado';
            } else {
                $status = 'analise';
            }
        } else {
            $conditions['lowMarginJustification'] = '';
        }
        $payload['conditions'] = $conditions;

        if ($existing) {
            write_order($existing, $payload, $status);
        } else {
            $stmt = $pdo->prepare('INSERT INTO orders (id, owner_id, hiperroll_number, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$orderId, $user['id'], $number, $status, json_encode($payload, JSON_UNESCAPED_UNICODE), $now, $now]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    audit($submit ? 'order.submit' : 'order.save_draft', $orderId, $submit ? ['margin' => round($payload['pricingSnapshot']['margin'], 2)] : []);
    if ($autoApproved) {
        audit('order.auto_approve', $orderId);
    }
    return order_to_client(load_order_row($orderId), $user);
}

// ---------- Aprovação automática (decisão de 2026-11-10) ----------
// An order is approved on its own when ALL of these hold; otherwise it goes to the gestor with
// the reasons and the comparison:
//  - the negotiated discount is within the modality's limit (no justification needed);
//  - the order's margin didn't fall more than marginAlertDrop points below its own table margin;
//  - it weighs at least FREIGHT_TIER2_MIN_KG (lighter orders are analysed by the gestor);
//  - compared with the reference order, neither the order's margin nor any product's margin
//    or price got worse. Reference = the client's last approved order (same CNPJ when both
//    orders have one, otherwise the same name); for a product that
//    order doesn't have (or a client with no orders yet), the last approved order in the
//    system that has it. Prices are only compared within the same region and weight band.
// The comparison leaves out the pagamento antecipado and the frete FOB, which are apart from the
// negotiation (same reason they count in no limit).

const AUTO_APPROVER = 'Aprovação automática';

// Client names are typed freely, so "Mercado São José" and "mercado sao  jose" are the same.
function client_key(string $name): string
{
    $name = mb_strtolower(trim($name), 'UTF-8');
    $name = strtr($name, [
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'é' => 'e', 'ê' => 'e', 'è' => 'e', 'ë' => 'e',
        'í' => 'i', 'î' => 'i', 'ì' => 'i', 'ï' => 'i', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ò' => 'o', 'ö' => 'o',
        'ú' => 'u', 'û' => 'u', 'ù' => 'u', 'ü' => 'u', 'ç' => 'c', 'ñ' => 'n',
    ]);
    return (string) preg_replace('/\s+/u', ' ', $name);
}

function comparison_conditions(array $conditions): array
{
    $conditions['earlyPayment'] = false;
    $conditions['fobFreight'] = false;
    return $conditions;
}

// Approved orders still active, newest first.
function approved_reference_orders(string $excludeId): array
{
    $orders = [];
    foreach (db()->query("SELECT id, hiperroll_number, payload FROM orders WHERE status = 'aprovado' AND deleted_at IS NULL")->fetchAll() as $row) {
        if ($row['id'] === $excludeId) {
            continue;
        }
        $payload = json_decode($row['payload'], true) ?: [];
        if (empty($payload['cart']) || !is_array($payload['cart'])) {
            continue;
        }
        $orders[] = [
            'id' => $row['id'],
            'number' => (string) ($payload['orderNumber'] ?? $row['hiperroll_number']),
            'clientName' => (string) ($payload['clientName'] ?? ''),
            'client' => client_key((string) ($payload['clientName'] ?? '')),
            'cnpj' => normalize_cnpj($payload['clientCnpj'] ?? ''),
            'at' => (string) ($payload['submittedAt'] ?? ''),
            'cart' => $payload['cart'],
            'conditions' => $payload['conditions'] ?? [],
        ];
    }
    usort($orders, fn (array $a, array $b) => strcmp($b['at'], $a['at']));
    return $orders;
}

// Same client: same CNPJ when both orders have one; otherwise the same (normalized) name.
function is_same_client(array $ref, string $key, string $cnpj): bool
{
    if ($cnpj !== '' && $ref['cnpj'] !== '') {
        return $ref['cnpj'] === $cnpj;
    }
    return $key !== '' && $ref['client'] === $key;
}

function check_auto_approval(array $cart, array $conditions, array $pricing, string $orderId, string $clientName, string $clientCnpj = ''): array
{
    $reasons = [];
    if ($pricing['requiresJustification']) {
        $reasons[] = 'Desconto negociado acima do limite da modalidade (com justificativa)';
    }
    if ($pricing['marginAlert']) {
        $reasons[] = sprintf(
            'Margem preocupante: %s%%, mais de %s pontos abaixo da margem de tabela do pedido (%s%%)',
            format_percent($pricing['margin']),
            format_percent(pricing_rules()['marginAlertDrop']),
            format_percent($pricing['tableMargin'])
        );
    }
    if ($pricing['totalWeight'] < FREIGHT_TIER2_MIN_KG) {
        $reasons[] = sprintf('Pedido com %s kg, abaixo de %d kg', number_format($pricing['totalWeight'], 1, ',', '.'), FREIGHT_TIER2_MIN_KG);
    }

    $refs = approved_reference_orders($orderId);
    $key = client_key($clientName);
    $clientRef = null;
    foreach ($refs as $ref) {
        if (is_same_client($ref, $key, $clientCnpj)) {
            $clientRef = $ref;
            break;
        }
    }
    $orderRef = $clientRef ?? ($refs[0] ?? null);

    // Totals of each reference order, computed only when needed and once.
    $cache = [];
    $totalsOf = function (array $ref) use (&$cache): array {
        if (!isset($cache[$ref['id']])) {
            $cache[$ref['id']] = calculate_order_totals($ref['cart'], comparison_conditions(normalize_order_conditions($ref['conditions'])));
        }
        return $cache[$ref['id']];
    };

    $current = calculate_order_totals($cart, comparison_conditions($conditions));
    $check = [
        'auto' => false,
        'checkedAt' => now_iso(),
        'margin' => $current['margin'],
        'reference' => null,
        'items' => [],
        'reasons' => [],
    ];

    if ($orderRef === null) {
        $reasons[] = 'Ainda não há pedido aprovado para comparar';
    } else {
        $refTotals = $totalsOf($orderRef);
        $check['reference'] = [
            'orderNumber' => $orderRef['number'],
            'clientName' => $orderRef['clientName'],
            'sameClient' => $clientRef !== null,
            'margin' => $refTotals['margin'],
        ];
        if ($current['margin'] < $refTotals['margin'] - 0.005) {
            $reasons[] = sprintf('Margem do pedido menor que a do pedido %s', $orderRef['number']);
        }
    }

    $candidates = $clientRef ? array_merge([$clientRef], $refs) : $refs;
    foreach ($current['lines'] as $line) {
        $entry = [
            'codigo' => $line['codigo'],
            'unitPrice' => $line['unitPrice'],
            'margin' => $line['margin'],
            'refOrderNumber' => null,
            'refUnitPrice' => null,
            'refMargin' => null,
            'samePlace' => false,
            'worse' => '',
        ];
        $found = null;
        foreach ($candidates as $ref) {
            foreach ($totalsOf($ref)['lines'] as $refLine) {
                if ($refLine['codigo'] === $line['codigo']) {
                    $found = [$ref, $refLine];
                    break 2;
                }
            }
        }
        if ($found === null) {
            $reasons[] = "Produto {$line['codigo']} sem pedido aprovado para comparar";
        } else {
            [$ref, $refLine] = $found;
            $samePlace = $line['uf'] === $refLine['uf'] && $line['cityType'] === $refLine['cityType'] && $line['weightTier'] === $refLine['weightTier'];
            $lowerMargin = $line['margin'] < $refLine['margin'] - 0.005;
            $lowerPrice = $samePlace && $line['unitPrice'] < $refLine['unitPrice'] - 0.005;
            $worse = $lowerPrice && $lowerMargin ? 'preço e margem' : ($lowerPrice ? 'preço' : ($lowerMargin ? 'margem' : ''));
            $entry = array_merge($entry, [
                'refOrderNumber' => $ref['number'],
                'refUnitPrice' => $refLine['unitPrice'],
                'refMargin' => $refLine['margin'],
                'samePlace' => $samePlace,
                'worse' => $worse,
            ]);
            if ($worse !== '') {
                $reasons[] = sprintf('Produto %s com %s menor que no pedido %s', $line['codigo'], $worse, $ref['number']);
            }
        }
        $check['items'][] = $entry;
    }

    $check['reasons'] = $reasons;
    $check['auto'] = !$reasons;
    return $check;
}

function decide_orders(array $user, $ids, string $decision, string $reason, string $note): array
{
    if ($decision === 'reject' && $reason === '') {
        fail(422, 'Informe o motivo da rejeição.');
    }
    $updated = [];
    $skipped = 0;
    foreach (normalize_id_list($ids) as $id) {
        $row = load_order_row($id);
        if (!$row || $row['status'] !== 'analise') {
            $skipped++;
            continue;
        }
        $payload = json_decode($row['payload'], true) ?: [];
        $now = now_iso();
        if ($note !== '') {
            $payload['supervisorNote'] = $note;
        }
        if ($decision === 'approve') {
            $payload['approvalAt'] = $now;
            $payload['approvalBy'] = $user['username'];
            $payload['rejectionReason'] = '';
            $payload['predictedBillingDate'] = gmdate('Y-m-d\TH:i:s\Z', time() + 8 * 86400);
            $status = 'aprovado';
        } else {
            $payload['rejectionReason'] = $reason;
            $payload['rejectionBy'] = $user['username'];
            $payload['rejectionAt'] = $now;
            // Returned to the representative: if they correct and resend this same order, these
            // items keep the prices they had (see locked_price_key).
            $payload['lockedPrices'] = lock_order_prices($payload['cart'] ?? []);
            $status = 'rejeitado';
        }
        write_order($row, $payload, $status);
        audit($decision === 'approve' ? 'order.approve' : 'order.reject', $id, $decision === 'reject' ? ['reason' => $reason] : []);
        $updated[] = order_to_client(load_order_row($id), $user);
    }
    return ['orders' => $updated, 'skipped' => $skipped];
}

function set_supervisor_note(string $id, string $note): array
{
    $row = load_order_row($id);
    if (!$row) {
        fail(404, 'Pedido não encontrado.');
    }
    $payload = json_decode($row['payload'], true) ?: [];
    $payload['supervisorNote'] = $note;
    write_order($row, $payload, $row['status']);
    audit('order.note', $id);
    return order_to_client(load_order_row($id));
}

function normalize_id_list($ids): array
{
    $list = is_array($ids) ? $ids : [$ids];
    return array_values(array_filter(array_map(fn($id) => is_string($id) ? $id : '', $list), fn($id) => $id !== ''));
}

function trash_orders(array $user, $ids): int
{
    $count = 0;
    foreach (normalize_id_list($ids) as $id) {
        $row = require_visible_order($id, $user);
        if ($row['deleted_at'] !== null) {
            continue;
        }
        db()->prepare('UPDATE orders SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?')
            ->execute([now_iso(), $user['username'], now_iso(), $id]);
        audit('order.trash', $id);
        $count++;
    }
    return $count;
}

function restore_order(array $user, string $id): array
{
    $row = require_visible_order($id, $user);
    if ($row['deleted_at'] === null) {
        fail(409, 'Este pedido não está na lixeira.');
    }
    $payload = clear_decision_fields(json_decode($row['payload'], true) ?: []);
    foreach (['supervisorNote', 'predictedBillingDate', 'billingStatus'] as $field) {
        $payload[$field] = '';
    }
    $droppedInvoices = $payload['invoices'] ?? [];
    // A restored order is an ordinary draft again: its prices follow the table in force.
    unset($payload['billedQuantities'], $payload['billingHistory'], $payload['invoices'], $payload['pricingSnapshot'], $payload['approvalCheck'], $payload['lockedPrices']);
    $payload['savedAt'] = now_iso();
    $payload['savedBy'] = $user['username'];

    db()->prepare('UPDATE orders SET payload = ?, status = ?, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?')
        ->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), 'rascunho', now_iso(), $id]);
    delete_invoice_files($droppedInvoices);
    audit('order.restore', $id);
    return order_to_client(load_order_row($id), $user);
}

// Representatives may only permanently delete their own drafts/rejected orders:
// anything that reached the manager (analysis/approved) stays for traceability.
function can_purge(array $row, array $user): bool
{
    if (is_gestor($user)) {
        return true;
    }
    return (int) $row['owner_id'] === (int) $user['id'] && in_array($row['status'], ['rascunho', 'rejeitado'], true);
}

function purge_order(array $user, string $id): void
{
    $row = require_visible_order($id, $user);
    if ($row['deleted_at'] === null) {
        fail(409, 'Mova o pedido para a lixeira antes de excluí-lo definitivamente.');
    }
    if (!can_purge($row, $user)) {
        fail(403, 'Pedidos em análise ou aprovados só podem ser excluídos definitivamente pelo gestor.');
    }
    db()->prepare('DELETE FROM orders WHERE id = ?')->execute([$id]);
    delete_invoice_files((json_decode($row['payload'], true) ?: [])['invoices'] ?? []);
    audit('order.purge', $id, ['hiperrollNumber' => $row['hiperroll_number']]);
}

function empty_trash(array $user): array
{
    $trash = list_orders($user)['trash'];
    $deleted = 0;
    $kept = 0;
    foreach ($trash as $order) {
        $row = load_order_row($order['id']);
        if ($row && can_purge($row, $user)) {
            db()->prepare('DELETE FROM orders WHERE id = ?')->execute([$row['id']]);
            delete_invoice_files($order['invoices'] ?? []);
            $deleted++;
        } else {
            $kept++;
        }
    }
    audit('order.empty_trash', null, ['deleted' => $deleted, 'kept' => $kept]);
    return ['deleted' => $deleted, 'kept' => $kept];
}

// NOTAS FISCAIS ANEXADAS: each one is a file in a folder next to the database, never inside it.
// The order only keeps {id, name, mime, size, date}, so listing orders stays light no matter how
// many invoices exist. The folder refuses direct downloads (same "deny all" as the data folder):
// a file only leaves through send_invoice(), which checks who is asking.
// To accept another format, add it here and teach detect_invoice_type() to recognize it.
const INVOICE_TYPES = [
    'application/pdf' => 'pdf',
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
const INVOICE_INVALID_TYPE = 'Anexe a nota fiscal em PDF ou imagem (PNG, JPG, WEBP ou GIF).';

function invoice_dir(): string
{
    $config = app_config();
    $dir = $config['invoice_dir'] ?? (dirname($config['db_path']) . '/invoices');
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Não foi possível criar a pasta de notas fiscais: ' . $dir);
    }
    protect_data_dir($dir);
    return $dir;
}

// Null when the entry is not a stored file. The path is always built from a 32-hex id and a
// known extension, never from text typed by someone.
function invoice_path($entry): ?string
{
    $id = is_array($entry) ? ($entry['id'] ?? null) : null;
    $mime = is_array($entry) ? ($entry['mime'] ?? null) : null;
    if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/', $id) || !is_string($mime) || !array_key_exists($mime, INVOICE_TYPES)) {
        return null;
    }
    return invoice_dir() . '/' . $id . '.' . INVOICE_TYPES[$mime];
}

// Whoever sends the file only declares a type; what it really is comes from its first bytes.
function detect_invoice_type(string $bytes): ?string
{
    if (strpos(substr($bytes, 0, 1024), '%PDF-') !== false) {
        return 'application/pdf';
    }
    if (strncmp($bytes, "\x89PNG\r\n\x1a\n", 8) === 0) {
        return 'image/png';
    }
    if (strncmp($bytes, "\xFF\xD8\xFF", 3) === 0) {
        return 'image/jpeg';
    }
    if (strncmp($bytes, 'GIF87a', 6) === 0 || strncmp($bytes, 'GIF89a', 6) === 0) {
        return 'image/gif';
    }
    if (strncmp($bytes, 'RIFF', 4) === 0 && substr($bytes, 8, 4) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

// Validates the file itself and returns ['entry' => what the order keeps, 'bytes' => the file],
// without writing anything yet. It takes plain bytes, so it serves the upload from the screen
// today and any other source later (e.g. an integration that fetches the invoice by itself).
function prepare_invoice(string $bytes, string $name): array
{
    if ($bytes === '') {
        fail(422, 'O arquivo da nota fiscal está vazio ou corrompido.');
    }
    $max = app_config()['max_invoice_bytes'];
    if (strlen($bytes) > $max) {
        fail(422, 'A nota fiscal deve ter no máximo ' . round($max / 1048576, 1) . ' MB.');
    }
    $mime = detect_invoice_type($bytes);
    if ($mime === null) {
        fail(422, INVOICE_INVALID_TYPE);
    }
    return [
        'entry' => [
            'id' => bin2hex(random_bytes(16)),
            'name' => str_field($name, 120) ?: 'Nota Fiscal',
            'mime' => $mime,
            'size' => strlen($bytes),
            'date' => now_iso(),
        ],
        'bytes' => $bytes,
    ];
}

// The screen sends the file as a data URL inside the JSON body.
function decode_invoice($invoice): ?array
{
    if (!is_array($invoice) || empty($invoice['dataUrl'])) {
        return null;
    }
    $dataUrl = (string) $invoice['dataUrl'];
    if (!preg_match('#^data:[^,]*;base64,#', $dataUrl, $m)) {
        fail(422, INVOICE_INVALID_TYPE);
    }
    $bytes = base64_decode(substr($dataUrl, strlen($m[0])), true);
    return prepare_invoice($bytes === false ? '' : $bytes, (string) ($invoice['name'] ?? ''));
}

function save_invoice_file(array $entry, string $bytes): void
{
    $path = invoice_path($entry);
    if ($path === null || file_put_contents($path, $bytes, LOCK_EX) !== strlen($bytes)) {
        if ($path !== null && is_file($path)) {
            @unlink($path);
        }
        throw new RuntimeException('Não foi possível gravar a nota fiscal.');
    }
}

// Called when an order stops referring to its files (purged, or restored as a new draft).
function delete_invoice_files($invoices): void
{
    foreach (is_array($invoices) ? $invoices : [] as $entry) {
        $path = invoice_path($entry);
        if ($path !== null && is_file($path)) {
            @unlink($path);
        }
    }
}

// Shows (or, with $download, saves) one invoice in its original format. Only for who may see
// the order: its representative and the gestor.
function send_invoice(array $user, string $orderId, string $invoiceId, bool $download): void
{
    $row = require_visible_order($orderId, $user);
    $payload = json_decode($row['payload'], true) ?: [];
    foreach ($payload['invoices'] ?? [] as $entry) {
        if ($invoiceId === '' || !is_array($entry) || ($entry['id'] ?? null) !== $invoiceId) {
            continue;
        }
        $path = invoice_path($entry);
        if ($path === null || !is_file($path)) {
            break;
        }
        $base = trim((string) preg_replace('/[^A-Za-z0-9.-]+/', '_', pathinfo((string) ($entry['name'] ?? ''), PATHINFO_FILENAME)), '_');
        $filename = ($base !== '' ? $base : 'nota_fiscal') . '_' . $row['hiperroll_number'] . '.' . INVOICE_TYPES[$entry['mime']];

        header('Content-Type: ' . $entry['mime']);
        header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        readfile($path);
        exit;
    }
    fail(404, 'Nota fiscal não encontrada.');
}

// The backup stays a single file: each invoice goes inside it, read from its file.
function order_with_invoice_data(array $order): array
{
    foreach ($order['invoices'] ?? [] as $i => $entry) {
        $path = invoice_path($entry);
        if ($path !== null && is_file($path)) {
            $order['invoices'][$i]['data'] = 'data:' . $entry['mime'] . ';base64,' . base64_encode((string) file_get_contents($path));
        }
    }
    return $order;
}

// Attaches an already validated invoice (see prepare_invoice) to the order payload. The file is
// written here; the caller saves the payload and, if that fails, removes the file again.
function attach_invoice(array $payload, array $invoice): array
{
    save_invoice_file($invoice['entry'], $invoice['bytes']);
    $payload['invoices'] = $payload['invoices'] ?? [];
    $payload['invoices'][] = $invoice['entry'];
    return $payload;
}

function register_billing(string $id, $billedMap, $invoice): array
{
    $row = load_order_row($id);
    if (!$row) {
        fail(404, 'Pedido não encontrado.');
    }
    if ($row['status'] !== 'aprovado') {
        fail(409, 'Só é possível faturar pedidos aprovados.');
    }
    $billed = is_array($billedMap) ? $billedMap : [];
    $upload = decode_invoice($invoice);

    $payload = json_decode($row['payload'], true) ?: [];
    $payload['billedQuantities'] = $payload['billedQuantities'] ?? [];
    $payload['invoices'] = $payload['invoices'] ?? [];
    $payload['billingHistory'] = $payload['billingHistory'] ?? [];

    $cleanMap = [];
    $anyBilled = false;
    $allComplete = true;
    foreach ($payload['cart'] ?? [] as $item) {
        $code = $item['codigo'];
        $added = max((int) ($billed[$code] ?? 0), 0);
        if ($added > 0) {
            $cleanMap[$code] = $added;
        }
        $total = min(((int) ($payload['billedQuantities'][$code] ?? 0)) + $added, (int) $item['qty']);
        $payload['billedQuantities'][$code] = $total;
        if ($total > 0) {
            $anyBilled = true;
        }
        if ($total < (int) $item['qty']) {
            $allComplete = false;
        }
    }
    if (!$cleanMap && !$upload) {
        fail(422, 'Informe alguma quantidade ou anexe uma nota fiscal.');
    }

    $payload['billingStatus'] = $anyBilled ? ($allComplete ? 'completo' : 'parcial') : 'pendente';
    $nextPrediction = gmdate('Y-m-d\TH:i:s\Z', time() + 4 * 86400);
    $payload['billingHistory'][] = [
        'date' => now_iso(),
        'predictedNextDate' => $allComplete ? null : $nextPrediction,
        'billedMap' => $cleanMap,
    ];
    if ($anyBilled) {
        $payload['predictedBillingDate'] = $allComplete ? null : $nextPrediction;
    }
    if ($upload) {
        $payload = attach_invoice($payload, $upload);
    }

    try {
        write_order($row, $payload, $row['status']);
    } catch (Throwable $e) {
        // The order was not saved, so nothing would ever point to the file just written.
        if ($upload) {
            delete_invoice_files([$upload['entry']]);
        }
        throw $e;
    }
    audit('order.billing', $id, ['items' => $cleanMap, 'invoice' => $upload['entry']['name'] ?? null]);
    return order_to_client(load_order_row($id));
}
