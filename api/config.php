<?php
// Configuração padrão do backend. Para ajustar algo só na hospedagem (sem versionar),
// copie config.local.example.php para config.local.php e altere apenas as chaves desejadas.

$config = [
    // Recomendado na HostGator: apontar para uma pasta FORA do public_html,
    // ex.: '/home/SEU_USUARIO/portal_data/portal.sqlite' (via config.local.php).
    'db_path' => dirname(__DIR__) . '/data/portal.sqlite',

    'session_name' => 'hr_portal_sid',
    'session_idle_timeout' => 60 * 60 * 10,

    'login_max_attempts' => 5,
    'login_window_seconds' => 15 * 60,

    'min_password_length' => 8,

    // Limite do anexo de nota fiscal (em bytes, depois de decodificado).
    'max_invoice_bytes' => 2 * 1024 * 1024,

    // Pasta onde ficam os arquivos das notas fiscais. null = pasta "invoices" ao lado do banco
    // (acompanha o db_path, então fica fora do public_html quando o banco também fica).
    'invoice_dir' => null,

    // Mostra detalhes de erro nas respostas. Deixe false em produção.
    'debug' => false,
];

$localConfigPath = __DIR__ . '/config.local.php';
if (is_file($localConfigPath)) {
    $local = require $localConfigPath;
    if (is_array($local)) {
        $config = array_replace($config, $local);
    }
}

return $config;
