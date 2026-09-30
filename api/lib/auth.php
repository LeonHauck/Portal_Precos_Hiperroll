<?php

const ROLE_GESTOR = 'gestor';
const ROLE_ADMIN = 'admin';
const ROLE_REP = 'representante';
const ALL_ROLES = [ROLE_GESTOR, ROLE_ADMIN, ROLE_REP];

// $touchActivity = false is for background checks (the price-table watcher): they must not
// count as activity, or a forgotten open tab would never hit the idle timeout.
function start_session(bool $touchActivity = true): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $config = app_config();
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name($config['session_name']);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();

    $now = time();
    if (isset($_SESSION['last_activity']) && $now - $_SESSION['last_activity'] > $config['session_idle_timeout']) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    if ($touchActivity || !isset($_SESSION['last_activity'])) {
        $_SESSION['last_activity'] = $now;
    }
}

// The user is re-read from the database on every request, so deactivating an account
// or changing its role takes effect immediately instead of when the session expires.
function current_user(bool $refresh = false): ?array
{
    static $cache = ['loaded' => false, 'user' => null];
    if ($cache['loaded'] && !$refresh) {
        return $cache['user'];
    }
    $cache['loaded'] = true;
    $cache['user'] = null;

    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row || !(int) $row['active']) {
        unset($_SESSION['user_id']);
        return null;
    }
    $cache['user'] = $row;
    return $row;
}

function require_login(): array
{
    $user = current_user();
    if (!$user) {
        fail(401, 'Sua sessão expirou. Faça login novamente.');
    }
    return $user;
}

function require_role(string ...$roles): array
{
    $user = require_login();
    if (!in_array($user['role'], $roles, true)) {
        fail(403, 'Você não tem permissão para esta ação.');
    }
    return $user;
}

function is_gestor(?array $user): bool
{
    return $user !== null && $user['role'] === ROLE_GESTOR;
}

function public_user(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'username' => $row['username'],
        'displayName' => $row['display_name'],
        'role' => $row['role'],
        'active' => (bool) (int) $row['active'],
        'mustChangePassword' => (bool) (int) $row['must_change_password'],
        'createdAt' => $row['created_at'],
        'lastLoginAt' => $row['last_login_at'],
    ];
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

// Every state-changing request must echo the token from GET session in this header.
// A malicious site can make the browser send the session cookie, but it cannot read the token.
function verify_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || $sent === '' || !hash_equals(csrf_token(), $sent)) {
        fail(419, 'Sua sessão foi atualizada. Recarregue a página e tente novamente.');
    }
}

function normalize_username(string $username): string
{
    return mb_strtolower(trim($username), 'UTF-8');
}

function validate_username(string $username): void
{
    if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $username)) {
        fail(422, 'Usuário inválido: use de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado), sem espaços.');
    }
}

function validate_new_password(string $password): void
{
    $min = app_config()['min_password_length'];
    if (mb_strlen($password, 'UTF-8') < $min) {
        fail(422, "A senha precisa ter pelo menos {$min} caracteres.");
    }
    // bcrypt ignores everything after 72 bytes, so a longer password would give a false sense of strength.
    if (strlen($password) > 72) {
        fail(422, 'A senha pode ter no máximo 72 caracteres.');
    }
}

function login_attempt_key(string $username): string
{
    return normalize_username($username) . '|' . client_ip();
}

function assert_login_not_throttled(string $key): void
{
    $config = app_config();
    $since = time() - $config['login_window_seconds'];
    db()->prepare('DELETE FROM login_attempts WHERE attempted_at < ?')->execute([$since]);

    $stmt = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE attempt_key = ? AND attempted_at >= ?');
    $stmt->execute([$key, $since]);
    if ((int) $stmt->fetchColumn() >= $config['login_max_attempts']) {
        $minutes = (int) ceil($config['login_window_seconds'] / 60);
        fail(429, "Muitas tentativas de login. Aguarde {$minutes} minutos e tente novamente.");
    }
}

function record_failed_login(string $key): void
{
    db()->prepare('INSERT INTO login_attempts (attempt_key, attempted_at) VALUES (?, ?)')->execute([$key, time()]);
}

function clear_login_attempts(string $key): void
{
    db()->prepare('DELETE FROM login_attempts WHERE attempt_key = ?')->execute([$key]);
}

function find_user_by_username(string $username): ?array
{
    $stmt = db()->prepare('SELECT * FROM users WHERE username_key = ?');
    $stmt->execute([normalize_username($username)]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function count_users(): int
{
    return (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
}

function insert_user(string $username, string $displayName, string $role, string $password, bool $mustChangePassword): int
{
    validate_username($username);
    validate_new_password($password);
    if (!in_array($role, ALL_ROLES, true)) {
        fail(422, 'Papel inválido.');
    }
    $displayName = str_field($displayName, 80);
    if ($displayName === '') {
        fail(422, 'Informe o nome do usuário.');
    }
    if (find_user_by_username($username)) {
        fail(409, 'Já existe um usuário com esse login.');
    }

    $now = now_iso();
    $stmt = db()->prepare('
        INSERT INTO users (username, username_key, display_name, password_hash, role, active, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ');
    $stmt->execute([
        $username,
        normalize_username($username),
        $displayName,
        password_hash($password, PASSWORD_DEFAULT),
        $role,
        $mustChangePassword ? 1 : 0,
        $now,
        $now,
    ]);
    return (int) db()->lastInsertId();
}
