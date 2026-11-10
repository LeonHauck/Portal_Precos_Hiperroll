<?php
// Entrega as tabelas de produtos, custos e fretes (data.js) somente ao gestor e ao admin, que as
// usam para levar a tabela para o banco (aba "Tabela de Preços"). O representante nunca recebe o
// data.js (ele traz custos e margens): os preços dele vêm sempre de api/index.php?action=pricing.get,
// depois que a tabela foi importada.
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

// After the price table is imported into the database, data.js is no longer needed and may be deleted.
$dataFile = dirname(__DIR__) . '/data.js';
if (can_view_pricing_admin($user) && is_file($dataFile)) {
    readfile($dataFile);
}
echo "\nwindow.PORTAL_DATA_LOCKED = false;\n";
