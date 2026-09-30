<?php
// Entrega as tabelas de produtos, custos e fretes (data.js) somente para usuários logados.
// Usado só até a tabela ser importada para o banco (aba "Tabela de Preços"); depois disso
// o front lê tudo de api/index.php?action=pricing.get.
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
if (is_file($dataFile)) {
    readfile($dataFile);
}
echo "\nwindow.PORTAL_DATA_LOCKED = false;\n";
