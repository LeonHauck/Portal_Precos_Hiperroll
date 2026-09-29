<?php
// Entrega as tabelas de produtos, custos e fretes (data.js) somente para usuários logados.
// O arquivo data.js em si fica bloqueado para download direto pelo .htaccess da raiz.

require_once __DIR__ . '/bootstrap.php';

start_session();
header('Content-Type: application/javascript; charset=UTF-8');
header('Cache-Control: private, no-store');

$user = current_user();
if (!$user || (int) $user['must_change_password'] === 1) {
    echo "window.PORTAL_DATA_LOCKED = true;\n";
    exit;
}

readfile(dirname(__DIR__) . '/data.js');
echo "\nwindow.PORTAL_DATA_LOCKED = false;\n";
