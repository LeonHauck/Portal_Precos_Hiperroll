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

// Carrega variáveis de ambiente a partir de um arquivo .env (formato simples)
function loadEnvFile(string $path): void
{
    if (!file_exists($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) continue;
        if (strpos($line, '=') === false) continue;
        list($name, $value) = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);
        if ((substr($value, 0, 1) === '"' && substr($value, -1) === '"') || (substr($value, 0, 1) === "'" && substr($value, -1) === "'")) {
            $value = substr($value, 1, -1);
        }
        putenv("$name=$value");
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
    }
}

function createDefaultEnvFile(string $path): void
{
    if (file_exists($path)) return;
    $content = "# Variáveis de ambiente do projeto\n";
    $content .= "LEON_USER=Leon\n";
    $content .= "LEON_PASS=l24598\n";
    $content .= "GABRIEL_USER=Gabriel.Ferreira\n";
    $content .= "GABRIEL_PASS=gf2026\n";
    file_put_contents($path, $content);
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

$dotenvPath = __DIR__ . '/.env';
createDefaultEnvFile($dotenvPath);
loadEnvFile($dotenvPath);

$users = loadUsers($usersFile);
if (!is_array($users)) {
    sendJson(500, ['success' => false, 'message' => 'Falha ao carregar usuários.']);
}

// Autenticação via .env é usada apenas como fallback para desenvolvimento.
// A fonte principal de usuários e senhas continua sendo users.json.
// Isso evita sobrescrever contas reais durante o desenvolvimento.
function authenticateEnvUser(string $normalizedUsername, string $password): ?array
{
    $defaultDevUser = getenv('LEON_USER') ?: 'Leon';
    $defaultDevPass = getenv('LEON_PASS') ?: 'l24598';
    $defaultSupervisorUser = getenv('GABRIEL_USER') ?: 'Gabriel.Ferreira';
    $defaultSupervisorPass = getenv('GABRIEL_PASS') ?: 'gf2026';

    $envUsers = [
        normalizeUsername($defaultDevUser) => ['name' => $defaultDevUser, 'password' => $defaultDevPass, 'role' => 'desenvolvedor'],
        normalizeUsername($defaultSupervisorUser) => ['name' => $defaultSupervisorUser, 'password' => $defaultSupervisorPass, 'role' => 'supervisor']
    ];

    if (!isset($envUsers[$normalizedUsername])) {
        return null;
    }

    if ($password !== $envUsers[$normalizedUsername]['password']) {
        return null;
    }

    return ['name' => $envUsers[$normalizedUsername]['name'], 'role' => $envUsers[$normalizedUsername]['role']];
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
    if ($found && isset($found['data']['passwordHash']) && password_verify($password, $found['data']['passwordHash'])) {
        sendJson(200, [
            'success' => true,
            'username' => $found['name'],
            'role' => $found['data']['role'] ?? 'vendedor'
        ]);
    }

    $envAuthenticated = authenticateEnvUser($normalizedUsername, $password);
    if ($envAuthenticated) {
        sendJson(200, [
            'success' => true,
            'username' => $envAuthenticated['name'],
            'role' => $envAuthenticated['role']
        ]);
    }

    sendJson(401, ['success' => false, 'message' => 'Credenciais incorretas.']);
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
