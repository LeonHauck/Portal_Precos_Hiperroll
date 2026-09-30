<?php
// Único ponto de entrada da API: api/index.php?action=<nome>
// GET  = leitura; POST = alteração (exige o cabeçalho X-CSRF-Token).

require_once __DIR__ . '/bootstrap.php';

register_error_handlers();
start_session();

$action = (string) ($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function expect_method(string $expected): void
{
    global $method;
    if ($method !== $expected) {
        fail(405, 'Método não permitido para esta ação.');
    }
}

$body = [];
if ($method === 'POST') {
    verify_csrf();
    $body = read_json_body();
}

$user = current_user();

// A temporary password set by the manager must be replaced before using anything else.
if ($user && (int) $user['must_change_password'] === 1 && !in_array($action, ['session', 'changePassword', 'logout'], true)) {
    fail(403, 'Troque sua senha provisória para continuar.');
}

function handle_login(array $body): void
{
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
        fail(422, 'Informe usuário e senha.');
    }

    $key = login_attempt_key($username);
    assert_login_not_throttled($key);

    $row = find_user_by_username($username);
    if ($row) {
        $valid = password_verify($password, $row['password_hash']) && (int) $row['active'] === 1;
    } else {
        // Spend the same hashing time for unknown users so response time doesn't reveal valid logins.
        password_hash($password, PASSWORD_DEFAULT);
        $valid = false;
    }
    if (!$valid) {
        record_failed_login($key);
        fail(401, 'Usuário ou senha incorretos.');
    }

    clear_login_attempts($key);
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    }

    // New session id on privilege change prevents session fixation.
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $row['id'];
    db()->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([now_iso(), $row['id']]);

    $current = current_user(true);
    audit('user.login', (string) $row['id']);
    json_response(200, ['success' => true, 'user' => public_user($current), 'csrfToken' => csrf_token()]);
}

function export_backup(): void
{
    $orders = array_map('order_to_client', db()->query('SELECT * FROM orders ORDER BY created_at')->fetchAll());
    $counter = db()->query("SELECT value FROM counters WHERE name = 'hiperroll_order'")->fetchColumn();
    audit('backup.export', null, ['orders' => count($orders)]);

    header('Content-Type: application/json; charset=UTF-8');
    header('Content-Disposition: attachment; filename="portal_hiperroll_backup_' . gmdate('Y-m-d_His') . '.json"');
    header('Cache-Control: no-store');
    echo json_encode([
        'exportedAt' => now_iso(),
        'version' => 2,
        'hiperrollOrderCounter' => (int) $counter,
        'users' => list_users(),
        'orders' => $orders,
        'pricing' => get_catalog(current_user()),
        'priceHistory' => list_price_history(5000),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

switch ($action) {
    case 'session':
        expect_method('GET');
        json_response(200, [
            'success' => true,
            'user' => $user ? public_user($user) : null,
            'csrfToken' => csrf_token(),
        ]);
        break;

    case 'login':
        expect_method('POST');
        handle_login($body);
        break;

    case 'logout':
        expect_method('POST');
        if ($user) {
            audit('user.logout', (string) $user['id']);
        }
        $_SESSION = [];
        session_regenerate_id(true);
        json_response(200, ['success' => true, 'csrfToken' => csrf_token()]);
        break;

    case 'changePassword':
        expect_method('POST');
        $actor = require_login();
        $updated = change_own_password($actor, (string) ($body['currentPassword'] ?? ''), (string) ($body['newPassword'] ?? ''));
        json_response(200, ['success' => true, 'user' => $updated, 'csrfToken' => csrf_token()]);
        break;

    case 'orders.list':
        expect_method('GET');
        $actor = require_login();
        json_response(200, ['success' => true] + list_orders($actor) + ['nextNumber' => peek_next_hiperroll_number()]);
        break;

    case 'orders.nextNumber':
        expect_method('GET');
        require_login();
        json_response(200, ['success' => true, 'nextNumber' => peek_next_hiperroll_number()]);
        break;

    case 'orders.saveDraft':
    case 'orders.submit':
        expect_method('POST');
        $actor = require_login();
        $order = save_order($actor, $body['id'] ?? null, $body['order'] ?? [], $action === 'orders.submit');
        json_response(200, ['success' => true, 'order' => $order, 'nextNumber' => peek_next_hiperroll_number()]);
        break;

    case 'orders.approve':
    case 'orders.reject':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR);
        $result = decide_orders(
            $actor,
            $body['ids'] ?? [],
            $action === 'orders.approve' ? 'approve' : 'reject',
            str_field($body['reason'] ?? '', 1000),
            str_field($body['note'] ?? '', 1000)
        );
        json_response(200, ['success' => true] + $result);
        break;

    case 'orders.note':
        expect_method('POST');
        require_role(ROLE_GESTOR);
        $order = set_supervisor_note((string) ($body['id'] ?? ''), str_field($body['note'] ?? '', 1000));
        json_response(200, ['success' => true, 'order' => $order]);
        break;

    case 'orders.trash':
        expect_method('POST');
        $actor = require_login();
        json_response(200, ['success' => true, 'trashed' => trash_orders($actor, $body['ids'] ?? [])]);
        break;

    case 'orders.restore':
        expect_method('POST');
        $actor = require_login();
        json_response(200, ['success' => true, 'order' => restore_order($actor, (string) ($body['id'] ?? ''))]);
        break;

    case 'orders.purge':
        expect_method('POST');
        $actor = require_login();
        purge_order($actor, (string) ($body['id'] ?? ''));
        json_response(200, ['success' => true]);
        break;

    case 'orders.emptyTrash':
        expect_method('POST');
        $actor = require_login();
        json_response(200, ['success' => true] + empty_trash($actor));
        break;

    case 'orders.billing':
        expect_method('POST');
        require_role(ROLE_GESTOR);
        $order = register_billing((string) ($body['id'] ?? ''), $body['billed'] ?? [], $body['invoice'] ?? null);
        json_response(200, ['success' => true, 'order' => $order]);
        break;

    case 'pricing.get':
        expect_method('GET');
        $actor = require_login();
        json_response(200, ['success' => true, 'catalog' => get_catalog($actor)]);
        break;

    case 'pricing.import':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR, ROLE_ADMIN);
        $counts = import_catalog($actor, $body);
        json_response(200, ['success' => true, 'imported' => $counts, 'catalog' => get_catalog($actor)]);
        break;

    case 'pricing.updateCostLines':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR);
        $changed = update_cost_lines($actor, $body['lines'] ?? [], str_field($body['note'] ?? '', 300));
        json_response(200, ['success' => true, 'changed' => $changed, 'catalog' => get_catalog($actor)]);
        break;

    case 'pricing.updateFreight':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR);
        $changed = update_freight($actor, $body['rows'] ?? [], str_field($body['note'] ?? '', 300));
        json_response(200, ['success' => true, 'changed' => $changed, 'catalog' => get_catalog($actor)]);
        break;

    case 'pricing.saveProduct':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR);
        $changed = save_product($actor, $body['product'] ?? [], str_field($body['note'] ?? '', 300));
        json_response(200, ['success' => true, 'changed' => $changed ? 1 : 0, 'catalog' => get_catalog($actor)]);
        break;

    case 'pricing.bulkAdjust':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR);
        $result = bulk_adjust($actor, $body);
        json_response(200, ['success' => true] + $result + ($result['applied'] ? ['catalog' => get_catalog($actor)] : []));
        break;

    case 'pricing.history':
        expect_method('GET');
        require_role(ROLE_GESTOR, ROLE_ADMIN);
        json_response(200, ['success' => true, 'history' => list_price_history()]);
        break;

    case 'users.list':
        expect_method('GET');
        require_role(ROLE_GESTOR, ROLE_ADMIN);
        json_response(200, ['success' => true, 'users' => list_users()]);
        break;

    case 'users.create':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR, ROLE_ADMIN);
        json_response(200, ['success' => true, 'user' => create_user($actor, $body)]);
        break;

    case 'users.update':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR, ROLE_ADMIN);
        json_response(200, ['success' => true, 'user' => update_user($actor, (int) ($body['id'] ?? 0), $body)]);
        break;

    case 'users.resetPassword':
        expect_method('POST');
        $actor = require_role(ROLE_GESTOR, ROLE_ADMIN);
        json_response(200, ['success' => true, 'user' => reset_user_password($actor, (int) ($body['id'] ?? 0), (string) ($body['password'] ?? ''))]);
        break;

    case 'backup.export':
        expect_method('GET');
        require_role(ROLE_GESTOR, ROLE_ADMIN);
        export_backup();
        break;

    default:
        fail(404, 'Ação desconhecida.');
}
