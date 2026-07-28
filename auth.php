<?php
header('Content-Type: application/json; charset=UTF-8');

$usersFile = __DIR__ . '/users.json';

function sendJson(int $status, array $payload)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function normalizeUsername(string $username): string
{
    return mb_strtolower(trim($username), 'UTF-8');
}

function loadUsers(string $path): array
{
    if (!file_exists($path)) {
        file_put_contents($path, json_encode([], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        return [];
    }

    $json = file_get_contents($path);
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}

function saveUsers(string $path, array $users): bool
{
    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
        return false;
    }
    return rename($tmp, $path);
}

function findUser(array $users, string $normalizedUsername)
{
    foreach ($users as $storedName => $userData) {
        if (normalizeUsername($storedName) === $normalizedUsername) {
            return ['name' => $storedName, 'data' => $userData];
        }
    }
    return null;
}

$users = loadUsers($usersFile);
if (!is_array($users)) {
    sendJson(500, ['success' => false, 'message' => 'Falha ao carregar usuários.']);
}

// Garantia de usuário padrão Leon como desenvolvedor
$defaultDevUser = 'Leon';
$defaultDevPass = 'l24598';
$normalizedDev = normalizeUsername($defaultDevUser);
$existingDev = findUser($users, $normalizedDev);
if (!$existingDev) {
    $users[$defaultDevUser] = [
        'passwordHash' => password_hash($defaultDevPass, PASSWORD_DEFAULT),
        'role' => 'desenvolvedor'
    ];
    saveUsers($usersFile, $users);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['action']) && $_GET['action'] === 'ping') {
        sendJson(200, ['success' => true, 'message' => 'OK']);
    }

    sendJson(400, ['success' => false, 'message' => 'Ação inválida.']);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJson(405, ['success' => false, 'message' => 'Método não permitido.']);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    sendJson(400, ['success' => false, 'message' => 'JSON inválido.']);
}

$action = $body['action'] ?? '';
$usernameRaw = isset($body['username']) ? trim($body['username']) : '';
$password = isset($body['password']) ? $body['password'] : '';
$role = isset($body['role']) ? trim($body['role']) : 'vendedor';

$normalizedUsername = normalizeUsername($usernameRaw);
if ($action === 'login' || $action === 'register') {
    if ($normalizedUsername === '' || $password === '') {
        sendJson(400, ['success' => false, 'message' => 'Usuário ou senha inválidos.']);
    }
}

if ($action === 'login') {
    $found = findUser($users, $normalizedUsername);
    if (!$found || !isset($found['data']['passwordHash']) || !password_verify($password, $found['data']['passwordHash'])) {
        sendJson(401, ['success' => false, 'message' => 'Credenciais incorretas.']);
    }

    sendJson(200, [
        'success' => true,
        'username' => $found['name'],
        'role' => $found['data']['role'] ?? 'vendedor'
    ]);
}

if ($action === 'register') {
    if (findUser($users, $normalizedUsername)) {
        sendJson(409, ['success' => false, 'message' => 'Usuário já existe.']);
    }

    $users[$usernameRaw] = [
        'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
        'role' => $role
    ];

    if (!saveUsers($usersFile, $users)) {
        sendJson(500, ['success' => false, 'message' => 'Falha ao salvar usuário.']);
    }

    sendJson(201, [
        'success' => true,
        'username' => $usernameRaw,
        'role' => $role
    ]);
}

sendJson(400, ['success' => false, 'message' => 'Ação inválida.']);
