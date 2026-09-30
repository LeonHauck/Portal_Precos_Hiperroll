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
            'qty' => max((int) ($item['qty'] ?? 0), 1),
            // Region the CIF was quoted for, so the price can be recalculated when the table changes.
            'uf' => preg_match('/^[A-Z]{2}$/', $uf) ? $uf : '',
            'cityType' => in_array($cityType, PRACA_TYPES, true) ? $cityType : '',
            'weightTier' => in_array($weightTier, FREIGHT_TIERS, true) ? $weightTier : '',
        ];
    }
    return $clean;
}

function sanitize_order_input($order): array
{
    $o = is_array($order) ? $order : [];
    return [
        'clientOrderNumber' => str_field($o['clientOrderNumber'] ?? '', 40),
        'clientName' => str_field($o['clientName'] ?? '', 120),
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

function order_to_client(array $row): array
{
    $payload = json_decode($row['payload'], true) ?: [];
    return array_merge($payload, [
        'id' => $row['id'],
        'ownerId' => (int) $row['owner_id'],
        'status' => $row['status'],
        'hiperrollNumber' => $row['hiperroll_number'],
        'deletedAt' => $row['deleted_at'],
        'deletedBy' => $row['deleted_by'],
    ]);
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
            $orders[] = order_to_client($row);
        } else {
            $trash[] = order_to_client($row);
        }
    }
    return ['orders' => $orders, 'trash' => $trash];
}

function clear_decision_fields(array $payload): array
{
    foreach (['rejectionReason', 'rejectionBy', 'rejectionAt', 'approvalAt', 'approvalBy'] as $field) {
        $payload[$field] = '';
    }
    return $payload;
}

function save_order(array $user, $id, $orderInput, bool $submit): array
{
    $input = sanitize_order_input($orderInput);
    if (!$input['cart']) {
        fail(422, $submit ? 'Adicione itens ao pedido antes de enviar.' : 'Adicione itens antes de salvar o rascunho.');
    }

    // The representative must see the new prices before sending: the front reloads the
    // table, shows what changed and lets them choose, then submits again.
    $currentPricingVersion = pricing_version();
    if ($submit && catalog_is_imported() && $input['pricingVersion'] !== $currentPricingVersion) {
        fail(409, 'A tabela de preços foi atualizada pelo gestor. Confira os novos valores antes de enviar.', 'pricing_outdated');
    }
    $input['cart'] = apply_catalog_prices($input['cart'], $submit);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $existing = null;
        if (is_string($id) && $id !== '') {
            $row = load_order_row($id);
            // Only the owner's own active draft is updated in place; anything else
            // (already submitted, in the trash, someone else's) becomes a new order.
            if ($row && $row['deleted_at'] === null && (int) $row['owner_id'] === (int) $user['id'] && $row['status'] === 'rascunho') {
                $existing = $row;
            }
        }

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
            'representativeName' => $input['representativeName'],
            'proposalValidity' => $input['proposalValidity'],
            'cart' => $input['cart'],
            'pricingVersion' => $currentPricingVersion,
            'savedAt' => $now,
            'savedBy' => $user['username'],
        ]);

        $status = 'rascunho';
        if ($submit) {
            $pricing = calculate_order_totals($input['cart'], $conditions);
            if ($pricing['belowMinimum'] && mb_strlen($conditions['lowMarginJustification'], 'UTF-8') < PRICING_MIN_JUSTIFICATION_LENGTH) {
                fail(422, sprintf(
                    'A margem do pedido (%s%%) está abaixo do mínimo de %s%%. Informe uma justificativa com pelo menos %d caracteres para enviar.',
                    number_format($pricing['margin'], 2, '.', ''),
                    rtrim(rtrim(number_format($conditions['minMargin'], 2, '.', ''), '0'), '.'),
                    PRICING_MIN_JUSTIFICATION_LENGTH
                ));
            }
            if (!$pricing['belowMinimum']) {
                $conditions['lowMarginJustification'] = '';
            }
            $payload = clear_decision_fields($payload);
            $payload['pricingSnapshot'] = [
                'margin' => $pricing['margin'],
                'discountPercent' => $pricing['discountPercent'],
                'totalNet' => $pricing['totalNet'],
                'totalInvoice' => $pricing['totalInvoice'],
                'belowMinimum' => $pricing['belowMinimum'],
            ];
            $payload['submittedAt'] = $now;
            $payload['submittedBy'] = $user['username'];
            $status = 'analise';
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
    return order_to_client(load_order_row($orderId));
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
            $status = 'rejeitado';
        }
        write_order($row, $payload, $status);
        audit($decision === 'approve' ? 'order.approve' : 'order.reject', $id, $decision === 'reject' ? ['reason' => $reason] : []);
        $updated[] = order_to_client(load_order_row($id));
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
    unset($payload['billedQuantities'], $payload['billingHistory'], $payload['invoices'], $payload['pricingSnapshot']);
    $payload['savedAt'] = now_iso();
    $payload['savedBy'] = $user['username'];

    db()->prepare('UPDATE orders SET payload = ?, status = ?, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?')
        ->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), 'rascunho', now_iso(), $id]);
    audit('order.restore', $id);
    return order_to_client(load_order_row($id));
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
            $deleted++;
        } else {
            $kept++;
        }
    }
    audit('order.empty_trash', null, ['deleted' => $deleted, 'kept' => $kept]);
    return ['deleted' => $deleted, 'kept' => $kept];
}

function decode_invoice($invoice): ?array
{
    if (!is_array($invoice) || empty($invoice['dataUrl'])) {
        return null;
    }
    $dataUrl = (string) $invoice['dataUrl'];
    if (!preg_match('#^data:(application/pdf|image/(?:png|jpeg|webp|gif));base64,#', $dataUrl, $m)) {
        fail(422, 'Anexe a nota fiscal em PDF ou imagem (PNG, JPG, WEBP ou GIF).');
    }
    $decoded = base64_decode(substr($dataUrl, strlen($m[0])), true);
    if ($decoded === false) {
        fail(422, 'O arquivo da nota fiscal está corrompido.');
    }
    $max = app_config()['max_invoice_bytes'];
    if (strlen($decoded) > $max) {
        fail(422, 'A nota fiscal deve ter no máximo ' . round($max / 1048576, 1) . ' MB.');
    }
    return [
        'name' => str_field($invoice['name'] ?? 'Nota Fiscal', 120) ?: 'Nota Fiscal',
        'data' => $dataUrl,
        'date' => now_iso(),
    ];
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
    $invoiceEntry = decode_invoice($invoice);

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
    if (!$cleanMap && !$invoiceEntry) {
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
    if ($invoiceEntry) {
        $payload['invoices'][] = $invoiceEntry;
    }

    write_order($row, $payload, $row['status']);
    audit('order.billing', $id, ['items' => $cleanMap, 'invoice' => $invoiceEntry['name'] ?? null]);
    return order_to_client(load_order_row($id));
}
