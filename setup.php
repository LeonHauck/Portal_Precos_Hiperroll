<?php
// Configuração inicial do Portal (use uma única vez, logo após publicar os arquivos).
// Cria a conta do gestor e a do administrador técnico. Depois que existir qualquer
// usuário, esta página deixa de funcionar — novas contas são criadas dentro do portal.

require_once __DIR__ . '/api/bootstrap.php';

start_session();

function h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

$checks = [];
$checks[] = ['PHP 8.0 ou superior', version_compare(PHP_VERSION, '8.0.0', '>='), 'Versão atual: ' . PHP_VERSION . '. Ajuste em cPanel → MultiPHP Manager.'];
$checks[] = ['Extensão pdo_sqlite', extension_loaded('pdo_sqlite'), 'Ative em cPanel → Select PHP Version → Extensions.'];
$checks[] = ['Extensão mbstring', extension_loaded('mbstring'), 'Ative em cPanel → Select PHP Version → Extensions.'];

$dbError = null;
$configured = false;
try {
    $configured = count_users() > 0;
} catch (Throwable $e) {
    $dbError = $e->getMessage();
}
$checks[] = ['Banco de dados acessível', $dbError === null, $dbError ?? ''];

$dbDir = realpath(dirname(app_config()['db_path']));
$docRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
$dbInsideWebRoot = $dbDir && $docRoot && strpos($dbDir, $docRoot) === 0;
$warnings = [];
if ($dbInsideWebRoot) {
    $warnings[] = 'O banco está dentro da pasta pública. O .htaccess bloqueia o download, mas o mais seguro é movê-lo para fora do public_html (veja api/config.local.example.php).';
}
if (!is_https()) {
    $warnings[] = 'A página não está em HTTPS. Ative o SSL gratuito (AutoSSL) no cPanel antes de usar o portal com senhas reais.';
}

$errors = [];
$success = false;
$allChecksOk = !in_array(false, array_column($checks, 1), true);

if (!$configured && $allChecksOk && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    if (!hash_equals(csrf_token(), (string) ($_POST['csrf'] ?? ''))) {
        $errors[] = 'Formulário expirado. Recarregue a página e tente de novo.';
    } else {
        $accounts = [
            ['prefix' => 'gestor', 'role' => ROLE_GESTOR, 'label' => 'gestor'],
            ['prefix' => 'admin', 'role' => ROLE_ADMIN, 'label' => 'administrador'],
        ];
        foreach ($accounts as $account) {
            if (($_POST[$account['prefix'] . '_password'] ?? '') !== ($_POST[$account['prefix'] . '_password2'] ?? '')) {
                $errors[] = 'As senhas do ' . $account['label'] . ' não conferem.';
            }
        }
        if (normalize_username((string) ($_POST['gestor_username'] ?? '')) === normalize_username((string) ($_POST['admin_username'] ?? ''))) {
            $errors[] = 'O gestor e o administrador precisam de logins diferentes.';
        }

        if (!$errors) {
            $pdo = db();
            $pdo->beginTransaction();
            try {
                if (count_users() > 0) {
                    throw new ApiError(409, 'O sistema já foi configurado por outra pessoa.');
                }
                foreach ($accounts as $account) {
                    insert_user(
                        trim((string) ($_POST[$account['prefix'] . '_username'] ?? '')),
                        (string) ($_POST[$account['prefix'] . '_name'] ?? ''),
                        $account['role'],
                        (string) ($_POST[$account['prefix'] . '_password'] ?? ''),
                        false
                    );
                }
                $pdo->commit();
                $success = true;
                $configured = true;
            } catch (ApiError $e) {
                $pdo->rollBack();
                $errors[] = $e->getMessage();
            } catch (Throwable $e) {
                $pdo->rollBack();
                error_log('[portal-setup] ' . $e->getMessage());
                $errors[] = 'Não foi possível criar as contas. Verifique o log de erros do PHP no cPanel.';
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>Configuração inicial — Portal Hiperroll</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; color: #1f2937; margin: 0; padding: 32px 16px; }
        .box { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.08); overflow: hidden; }
        header { background: linear-gradient(115deg, #E31E24 0%, #b91620 38%, #071A3D 100%); color: #fff; padding: 22px 26px; }
        header h1 { margin: 0; font-size: 1.4rem; }
        header p { margin: 6px 0 0; opacity: .85; }
        main { padding: 22px 26px; }
        ul.checks { list-style: none; padding: 0; margin: 0 0 18px; }
        ul.checks li { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
        .ok { color: #15803d; font-weight: 700; }
        .bad { color: #b91c1c; font-weight: 700; }
        .hint { display: block; color: #6b7280; font-size: .85rem; margin-top: 2px; }
        .warn, .error, .success { padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: .92rem; }
        .warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
        .error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
        .success { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
        fieldset { border: 1px solid #e5e7eb; border-radius: 10px; margin: 0 0 16px; padding: 14px 16px; }
        legend { font-weight: 700; padding: 0 6px; }
        label { display: block; font-weight: 600; font-size: .9rem; margin: 10px 0 4px; }
        input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1.5px solid #d1d5db; border-radius: 8px; font-size: .95rem; }
        button, .btn { display: inline-block; background: linear-gradient(135deg, #E31E24, #071A3D); color: #fff; border: none; border-radius: 10px; padding: 12px 22px; font-weight: 700; font-size: .95rem; cursor: pointer; text-decoration: none; }
        small { color: #6b7280; }
    </style>
</head>
<body>
<div class="box">
    <header>
        <h1>Configuração inicial</h1>
        <p>Portal de Preços Hiperroll</p>
    </header>
    <main>
        <?php if ($success): ?>
            <div class="success">✓ Contas criadas com sucesso. Esta página agora está desativada.</div>
            <a class="btn" href="Portal_Hiperroll_Final.html">Abrir o portal</a>
        <?php elseif ($configured): ?>
            <p>O sistema já está configurado. Novas contas são criadas dentro do portal, na tela <strong>Usuários</strong>.</p>
            <a class="btn" href="Portal_Hiperroll_Final.html">Abrir o portal</a>
        <?php else: ?>
            <h2 style="font-size:1.05rem;">1. Verificação do servidor</h2>
            <ul class="checks">
                <?php foreach ($checks as [$label, $ok, $hint]): ?>
                    <li>
                        <span class="<?= $ok ? 'ok' : 'bad' ?>"><?= $ok ? '✓' : '✗' ?></span> <?= h($label) ?>
                        <?php if (!$ok && $hint): ?><span class="hint"><?= h($hint) ?></span><?php endif; ?>
                    </li>
                <?php endforeach; ?>
            </ul>
            <?php foreach ($warnings as $warning): ?>
                <div class="warn">⚠️ <?= h($warning) ?></div>
            <?php endforeach; ?>

            <?php if ($allChecksOk): ?>
                <h2 style="font-size:1.05rem;">2. Contas iniciais</h2>
                <?php foreach ($errors as $error): ?>
                    <div class="error"><?= h($error) ?></div>
                <?php endforeach; ?>
                <form method="post" autocomplete="off">
                    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
                    <fieldset>
                        <legend>Gestor (aprova os pedidos)</legend>
                        <label>Login</label>
                        <input name="gestor_username" value="<?= h($_POST['gestor_username'] ?? 'Gabriel.Ferreira') ?>" required>
                        <label>Nome</label>
                        <input name="gestor_name" value="<?= h($_POST['gestor_name'] ?? 'Gabriel Ferreira') ?>" required>
                        <label>Senha (mínimo <?= (int) app_config()['min_password_length'] ?> caracteres)</label>
                        <input type="password" name="gestor_password" required autocomplete="new-password">
                        <label>Repita a senha</label>
                        <input type="password" name="gestor_password2" required autocomplete="new-password">
                    </fieldset>
                    <fieldset>
                        <legend>Administrador técnico (usuários e backup, sem aprovar)</legend>
                        <label>Login</label>
                        <input name="admin_username" value="<?= h($_POST['admin_username'] ?? 'Leon') ?>" required>
                        <label>Nome</label>
                        <input name="admin_name" value="<?= h($_POST['admin_name'] ?? 'Leon Hauck') ?>" required>
                        <label>Senha (mínimo <?= (int) app_config()['min_password_length'] ?> caracteres)</label>
                        <input type="password" name="admin_password" required autocomplete="new-password">
                        <label>Repita a senha</label>
                        <input type="password" name="admin_password2" required autocomplete="new-password">
                    </fieldset>
                    <p><small>Não reutilize as senhas antigas do portal: elas estão no histórico público do GitHub.</small></p>
                    <button type="submit">Criar contas</button>
                </form>
            <?php endif; ?>
        <?php endif; ?>
    </main>
</div>
</body>
</html>
