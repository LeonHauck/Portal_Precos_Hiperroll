<?php

// v1: usuários, pedidos, contadores, tentativas de login, auditoria.
// v2: tabela de preços editável (linhas de produto, frete, produtos, histórico de preços).
// v3: preço individual por produto (products.price_override).
// v4: margem do produto no preço cheio (products.table_margin).
const SCHEMA_VERSION = 4;

const DENY_ALL_HTACCESS = "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n";

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $path = app_config()['db_path'];
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Não foi possível criar a pasta de dados: ' . $dir);
    }
    protect_data_dir($dir);

    $pdo = new PDO('sqlite:' . $path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    // Espera até 5s se outro representante estiver gravando no mesmo instante, em vez de falhar.
    $pdo->exec('PRAGMA busy_timeout = 5000');

    migrate($pdo);
    return $pdo;
}

// Defesa extra caso a pasta de dados fique dentro do public_html: o Apache recusa qualquer download dela.
function protect_data_dir(string $dir): void
{
    $htaccess = $dir . '/.htaccess';
    if (!is_file($htaccess)) {
        @file_put_contents($htaccess, DENY_ALL_HTACCESS);
    }
    $index = $dir . '/index.html';
    if (!is_file($index)) {
        @file_put_contents($index, '');
    }
}

function migrate(PDO $pdo): void
{
    $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    if ($version >= SCHEMA_VERSION) {
        return;
    }

    $pdo->beginTransaction();
    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                username_key TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('gestor', 'admin', 'representante')),
                active INTEGER NOT NULL DEFAULT 1,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_login_at TEXT
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                hiperroll_number TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL CHECK (status IN ('rascunho', 'analise', 'aprovado', 'rejeitado')),
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                deleted_by TEXT
            )
        ");
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS counters (
                name TEXT PRIMARY KEY,
                value INTEGER NOT NULL
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attempt_key TEXT NOT NULL,
                attempted_at INTEGER NOT NULL
            )
        ");
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON login_attempts(attempt_key)');

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT,
                action TEXT NOT NULL,
                target TEXT,
                details TEXT,
                created_at TEXT NOT NULL
            )
        ");

        // Every statement uses IF NOT EXISTS, so a v1 database only gains the tables below.
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS cost_lines (
                key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                custo_base REAL NOT NULL,
                desp_com REAL NOT NULL,
                desp_adm REAL NOT NULL,
                price100 REAL NOT NULL,
                updated_at TEXT NOT NULL
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS freight_rates (
                uf TEXT NOT NULL,
                praca_type TEXT NOT NULL CHECK (praca_type IN ('Capital', 'Interior', 'Fluvial')),
                label TEXT NOT NULL DEFAULT '',
                tier1 REAL NOT NULL,
                tier2 REAL NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (uf, praca_type)
            )
        ");

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS products (
                codigo TEXT PRIMARY KEY,
                descricao TEXT NOT NULL,
                categoria TEXT NOT NULL DEFAULT '',
                subcat TEXT NOT NULL DEFAULT '',
                cost_line_key TEXT NOT NULL REFERENCES cost_lines(key),
                weight REAL NOT NULL,
                ncm TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                price_override REAL,
                table_margin REAL NOT NULL DEFAULT 10,
                updated_at TEXT NOT NULL
            )
        ");
        // A v2 database already has the table without the column; SQLite has no "ADD COLUMN IF NOT EXISTS".
        ensure_column($pdo, 'products', 'price_override', 'REAL');
        ensure_column($pdo, 'products', 'table_margin', 'REAL NOT NULL DEFAULT 10');

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT NOT NULL,
                entity TEXT NOT NULL,
                entity_key TEXT NOT NULL,
                field TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                username TEXT,
                note TEXT,
                created_at TEXT NOT NULL
            )
        ");
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_price_history_created ON price_history(created_at)');

        $pdo->exec('PRAGMA user_version = ' . SCHEMA_VERSION);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function ensure_column(PDO $pdo, string $table, string $column, string $definition): void
{
    foreach ($pdo->query("PRAGMA table_info({$table})")->fetchAll() as $info) {
        if ($info['name'] === $column) {
            return;
        }
    }
    $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
}

function audit(string $action, ?string $target = null, array $details = []): void
{
    $user = current_user();
    $stmt = db()->prepare('INSERT INTO audit_log (user_id, username, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $user['id'] ?? null,
        $user['username'] ?? null,
        $action,
        $target,
        $details ? json_encode($details, JSON_UNESCAPED_UNICODE) : null,
        now_iso(),
    ]);
}
