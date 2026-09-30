<?php

// Gestor manages representatives; the technical admin manages every account.
function can_manage_role(array $actor, string $targetRole): bool
{
    if ($actor['role'] === ROLE_ADMIN) {
        return true;
    }
    return $actor['role'] === ROLE_GESTOR && $targetRole === ROLE_REP;
}

function require_user_row(int $id): array
{
    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        fail(404, 'Usuário não encontrado.');
    }
    return $row;
}

function list_users(): array
{
    $rows = db()->query("SELECT * FROM users ORDER BY CASE role WHEN 'gestor' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, display_name")->fetchAll();
    return array_map('public_user', $rows);
}

function create_user(array $actor, array $input): array
{
    $role = (string) ($input['role'] ?? ROLE_REP);
    if (!can_manage_role($actor, $role)) {
        fail(403, 'Você só pode criar contas de representante.');
    }
    $id = insert_user(
        trim((string) ($input['username'] ?? '')),
        (string) ($input['displayName'] ?? ''),
        $role,
        (string) ($input['password'] ?? ''),
        true
    );
    audit('user.create', (string) $id, ['role' => $role]);
    return public_user(require_user_row($id));
}

function count_active_gestores(): int
{
    return (int) db()->query("SELECT COUNT(*) FROM users WHERE role = 'gestor' AND active = 1")->fetchColumn();
}

function update_user(array $actor, int $id, array $input): array
{
    $target = require_user_row($id);
    if (!can_manage_role($actor, $target['role'])) {
        fail(403, 'Você não pode alterar esta conta.');
    }

    $displayName = array_key_exists('displayName', $input) ? str_field($input['displayName'], 80) : $target['display_name'];
    if ($displayName === '') {
        fail(422, 'Informe o nome do usuário.');
    }
    $active = array_key_exists('active', $input) ? (bool) $input['active'] : (bool) (int) $target['active'];
    $role = array_key_exists('role', $input) ? (string) $input['role'] : $target['role'];

    if (!in_array($role, ALL_ROLES, true)) {
        fail(422, 'Papel inválido.');
    }
    if ($role !== $target['role'] && $actor['role'] !== ROLE_ADMIN) {
        fail(403, 'Somente o administrador pode mudar o papel de uma conta.');
    }
    if ((int) $target['id'] === (int) $actor['id'] && (!$active || $role !== $target['role'])) {
        fail(422, 'Você não pode desativar nem mudar o papel da sua própria conta.');
    }
    $losesGestor = $target['role'] === ROLE_GESTOR && (int) $target['active'] === 1 && (!$active || $role !== ROLE_GESTOR);
    if ($losesGestor && count_active_gestores() <= 1) {
        fail(422, 'O sistema precisa de pelo menos um gestor ativo para aprovar pedidos.');
    }

    db()->prepare('UPDATE users SET display_name = ?, active = ?, role = ?, updated_at = ? WHERE id = ?')
        ->execute([$displayName, $active ? 1 : 0, $role, now_iso(), $id]);
    audit('user.update', (string) $id, ['active' => $active, 'role' => $role]);
    return public_user(require_user_row($id));
}

function reset_user_password(array $actor, int $id, string $password): array
{
    $target = require_user_row($id);
    if (!can_manage_role($actor, $target['role'])) {
        fail(403, 'Você não pode alterar esta conta.');
    }
    validate_new_password($password);
    db()->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), now_iso(), $id]);
    audit('user.reset_password', (string) $id);
    return public_user(require_user_row($id));
}

function change_own_password(array $user, string $current, string $new): array
{
    if (!password_verify($current, $user['password_hash'])) {
        fail(422, 'A senha atual está incorreta.');
    }
    if (hash_equals($current, $new)) {
        fail(422, 'A nova senha precisa ser diferente da atual.');
    }
    validate_new_password($new);
    db()->prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), now_iso(), $user['id']]);
    session_regenerate_id(true);
    audit('user.change_password', (string) $user['id']);
    return public_user(current_user(true));
}
