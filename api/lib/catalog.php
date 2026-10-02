<?php

// Tabela de preços editável pelo gestor: grupos de preço — "cost lines" no código — (custos e preço 100% NF por kg),
// frete por UF/praça e cadastro de produtos.
// Enquanto a tabela não é importada, o portal continua usando o data.js. Depois da importação,
// o banco vira a fonte oficial: toda alteração guarda "de → para" em price_history e incrementa
// a versão da tabela (counters.pricing_version), que os pedidos gravam para rastreabilidade.

const PRACA_TYPES = ['Capital', 'Interior', 'Fluvial'];
const FREIGHT_TIERS = ['tier1', 'tier2'];
const MAX_PRICE_VALUE = 100000.0;
const MAX_PRODUCT_WEIGHT = 10000.0;
const MAX_CATALOG_ROWS = 5000;
const BULK_MIN_PERCENT = -50.0;
const BULK_MAX_PERCENT = 100.0;
const BULK_MODES = [
    'priceAndCosts' => ['custo_base', 'desp_com', 'desp_adm', 'price100'],
    'price' => ['price100'],
    'costs' => ['custo_base', 'desp_com', 'desp_adm'],
];
const COST_LINE_FIELDS = ['name' => 'text', 'custo_base' => 'num', 'desp_com' => 'num', 'desp_adm' => 'num', 'price100' => 'num'];
const FREIGHT_FIELDS = ['label' => 'text', 'tier1' => 'num', 'tier2' => 'num'];
const PRODUCT_FIELDS = [
    'descricao' => 'text',
    'categoria' => 'text',
    'subcat' => 'text',
    'cost_line_key' => 'text',
    'weight' => 'num',
    'ncm' => 'text',
    'active' => 'num',
    'price_override' => 'numnull',
    'min_margin' => 'num',
];
const PRODUCT_BULK_ACTIONS = ['percent', 'setLine', 'clearPrice'];

// Editing prices is a commercial decision (gestor). The admin can import and look, not change.
function can_edit_pricing(array $user): bool
{
    return is_gestor($user);
}

function can_view_pricing_admin(array $user): bool
{
    return in_array($user['role'], [ROLE_GESTOR, ROLE_ADMIN], true);
}

function catalog_is_imported(): bool
{
    return (int) db()->query('SELECT COUNT(*) FROM cost_lines')->fetchColumn() > 0;
}

function require_catalog_imported(): void
{
    if (!catalog_is_imported()) {
        fail(409, 'Importe a tabela de preços atual antes de editá-la.');
    }
}

function pricing_version(): int
{
    return (int) db()->query("SELECT value FROM counters WHERE name = 'pricing_version'")->fetchColumn();
}

// Must run inside the same transaction as the change it versions.
function bump_pricing_version(): int
{
    $pdo = db();
    $pdo->exec("INSERT OR IGNORE INTO counters (name, value) VALUES ('pricing_version', 0)");
    $pdo->exec("UPDATE counters SET value = value + 1 WHERE name = 'pricing_version'");
    return pricing_version();
}

function catalog_transaction(callable $work)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $work($pdo);
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

// ---------- Leitura ----------

function cost_line_to_client(array $row): array
{
    return [
        'key' => $row['key'],
        'name' => $row['name'],
        'custoBase' => (float) $row['custo_base'],
        'despCom' => (float) $row['desp_com'],
        'despAdm' => (float) $row['desp_adm'],
        'price100' => (float) $row['price100'],
        'updatedAt' => $row['updated_at'],
    ];
}

function freight_to_client(array $row): array
{
    return [
        'uf' => $row['uf'],
        'pracaType' => $row['praca_type'],
        'label' => $row['label'],
        'tier1' => (float) $row['tier1'],
        'tier2' => (float) $row['tier2'],
        'updatedAt' => $row['updated_at'],
    ];
}

function product_to_client(array $row): array
{
    return [
        'codigo' => $row['codigo'],
        'descricao' => $row['descricao'],
        'categoria' => $row['categoria'],
        'subcat' => $row['subcat'],
        'costLineKey' => $row['cost_line_key'],
        'weight' => (float) $row['weight'],
        'ncm' => $row['ncm'],
        'active' => (bool) (int) $row['active'],
        // Individual FOB price (R$ per unit) set by the gestor; null = price of the product line.
        'priceOverride' => $row['price_override'] === null ? null : (float) $row['price_override'],
        // Minimum margin (%) accepted for this product in a negotiation.
        'minMargin' => (float) $row['min_margin'],
        'updatedAt' => $row['updated_at'],
    ];
}

function all_cost_lines(): array
{
    return db()->query('SELECT * FROM cost_lines ORDER BY name')->fetchAll();
}

function all_freight_rates(): array
{
    return db()->query("SELECT * FROM freight_rates ORDER BY uf, CASE praca_type WHEN 'Capital' THEN 0 WHEN 'Interior' THEN 1 ELSE 2 END")->fetchAll();
}

function find_cost_line(string $key): ?array
{
    $stmt = db()->prepare('SELECT * FROM cost_lines WHERE key = ?');
    $stmt->execute([$key]);
    return $stmt->fetch() ?: null;
}

function find_freight_rate(string $uf, string $type): ?array
{
    $stmt = db()->prepare('SELECT * FROM freight_rates WHERE uf = ? AND praca_type = ?');
    $stmt->execute([$uf, $type]);
    return $stmt->fetch() ?: null;
}

function find_product(string $codigo): ?array
{
    $stmt = db()->prepare('SELECT * FROM products WHERE codigo = ?');
    $stmt->execute([$codigo]);
    return $stmt->fetch() ?: null;
}

// Representatives only receive active products; gestor/admin also see inactive ones to reactivate them.
function get_catalog(array $user): array
{
    $where = can_view_pricing_admin($user) ? '' : ' WHERE active = 1';
    $products = db()->query('SELECT * FROM products' . $where . ' ORDER BY sort_order, codigo')->fetchAll();
    return [
        'imported' => catalog_is_imported(),
        'version' => pricing_version(),
        'canEdit' => can_edit_pricing($user),
        'costLines' => array_map('cost_line_to_client', all_cost_lines()),
        'freight' => array_map('freight_to_client', all_freight_rates()),
        'products' => array_map('product_to_client', $products),
    ];
}

function list_price_history(int $limit = 300): array
{
    $stmt = db()->prepare('SELECT * FROM price_history ORDER BY id DESC LIMIT ?');
    $stmt->bindValue(1, $limit, PDO::PARAM_INT);
    $stmt->execute();
    return array_map(fn($row) => [
        'id' => (int) $row['id'],
        'batchId' => $row['batch_id'],
        'entity' => $row['entity'],
        'entityKey' => $row['entity_key'],
        'field' => $row['field'],
        'oldValue' => $row['old_value'],
        'newValue' => $row['new_value'],
        'username' => $row['username'],
        'note' => $row['note'],
        'createdAt' => $row['created_at'],
    ], $stmt->fetchAll());
}

// ---------- Validação ----------

function money_text(float $value): string
{
    return 'R$ ' . number_format($value, 2, ',', '.');
}

function price_value($value, string $label, bool $allowZero = true, float $max = MAX_PRICE_VALUE): float
{
    if (!is_numeric($value)) {
        fail(422, "Informe um número válido em {$label}.");
    }
    $number = round((float) $value, 4);
    if (!is_finite($number) || $number < 0 || $number > $max || (!$allowZero && $number <= 0)) {
        fail(422, "Valor fora do permitido em {$label}.");
    }
    return $number;
}

function normalize_cost_line_key($value): string
{
    return mb_strtolower(str_field($value, 80), 'UTF-8');
}

// CIF divides by (custos ÷ preço 100% NF): a zero cost, or a price at/below cost, breaks that math.
function assert_cost_line_consistent(array $line, string $label): void
{
    $costs = (float) $line['custo_base'] + (float) $line['desp_com'] + (float) $line['desp_adm'];
    if ($costs <= 0) {
        fail(422, "O grupo de preço \"{$label}\" precisa ter custo maior que zero.");
    }
    if ((float) $line['price100'] <= $costs) {
        fail(422, sprintf(
            'No grupo de preço "%s", o preço por kg (%s) precisa ser maior que custo + despesas (%s/kg).',
            $label,
            money_text((float) $line['price100']),
            money_text($costs)
        ));
    }
}

function clean_cost_line(array $input): array
{
    $key = normalize_cost_line_key($input['key'] ?? '');
    if ($key === '') {
        fail(422, 'Grupo de preço sem identificação.');
    }
    $name = str_field($input['name'] ?? '', 80);
    $label = $name !== '' ? $name : $key;
    $line = [
        'key' => $key,
        'name' => $name,
        'custo_base' => price_value($input['custoBase'] ?? null, "custo do produto ({$label})"),
        'desp_com' => price_value($input['despCom'] ?? null, "despesa comercial ({$label})"),
        'desp_adm' => price_value($input['despAdm'] ?? null, "despesa administrativa ({$label})"),
        'price100' => price_value($input['price100'] ?? null, "preço 100% NF ({$label})", false),
    ];
    assert_cost_line_consistent($line, $label);
    return $line;
}

function clean_freight(array $input): array
{
    $uf = strtoupper(str_field($input['uf'] ?? '', 10));
    if (!preg_match('/^[A-Z]{2}$/', $uf)) {
        fail(422, 'UF inválida no frete (use a sigla, ex.: MG).');
    }
    $type = (string) ($input['pracaType'] ?? '');
    if (!in_array($type, PRACA_TYPES, true)) {
        fail(422, "Tipo de praça inválido para {$uf}.");
    }
    $label = "{$uf} / {$type}";
    return [
        'uf' => $uf,
        'praca_type' => $type,
        'label' => str_field($input['label'] ?? '', 200),
        'tier1' => price_value($input['tier1'] ?? null, "frete de 150 a 199 kg ({$label})"),
        'tier2' => price_value($input['tier2'] ?? null, "frete acima de 200 kg ({$label})"),
    ];
}

function clean_product(array $input): array
{
    $codigo = str_field($input['codigo'] ?? '', 40);
    // Some legacy codes carry a space ("P- 02819"); orders already reference them, so it stays allowed.
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/', $codigo)) {
        fail(422, 'Código de produto inválido: use letras, números, espaço, ponto, barra ou hífen (ex.: P-07004).');
    }
    $descricao = str_field($input['descricao'] ?? '', 200);
    if ($descricao === '') {
        fail(422, "Informe a descrição do produto {$codigo}.");
    }
    return [
        'codigo' => $codigo,
        'descricao' => $descricao,
        'categoria' => str_field($input['categoria'] ?? '', 80),
        'subcat' => str_field($input['subcat'] ?? '', 80),
        'cost_line_key' => normalize_cost_line_key($input['costLineKey'] ?? ''),
        'weight' => price_value($input['weight'] ?? null, "peso do produto {$codigo}", false, MAX_PRODUCT_WEIGHT),
        'ncm' => str_field($input['ncm'] ?? '', 20),
        'active' => array_key_exists('active', $input) && !$input['active'] ? 0 : 1,
        'price_override' => clean_price_override($input['priceOverride'] ?? null, $codigo),
        'min_margin' => array_key_exists('minMargin', $input) && $input['minMargin'] !== null && $input['minMargin'] !== ''
            ? round(price_value($input['minMargin'], "margem mínima do produto {$codigo}", true, 100.0), 2)
            : PRICING_MIN_ORDER_MARGIN,
    ];
}

// Empty means "use the product line price"; otherwise a positive FOB price in R$ per unit.
function clean_price_override($value, string $codigo): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    return round(price_value($value, "preço do produto {$codigo}", false), 2);
}

function input_rows($rows, string $emptyMessage): array
{
    $list = array_values(array_filter(is_array($rows) ? $rows : [], 'is_array'));
    if (!$list) {
        fail(422, $emptyMessage);
    }
    if (count($list) > MAX_CATALOG_ROWS) {
        fail(422, 'Linhas demais em uma única alteração.');
    }
    return $list;
}

// ---------- Histórico ----------

function new_price_batch(): string
{
    return gmdate('YmdHis') . '-' . bin2hex(random_bytes(3));
}

function history_value($value): ?string
{
    if ($value === null) {
        return null;
    }
    if (is_float($value) || is_int($value)) {
        return rtrim(rtrim(number_format((float) $value, 4, '.', ''), '0'), '.');
    }
    return (string) $value;
}

function record_price_change(string $batch, string $entity, string $key, string $field, $old, $new, array $user, string $note): void
{
    db()->prepare('INSERT INTO price_history (batch_id, entity, entity_key, field, old_value, new_value, username, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$batch, $entity, $key, $field, history_value($old), history_value($new), $user['username'], $note !== '' ? $note : null, now_iso()]);
}

// Compares the new values against the stored row, field by field. SQLite may hand numbers back
// as strings (PHP < 8.1), so numeric fields are compared as floats.
function diff_fields(array $old, array $new, array $fields): array
{
    $changes = [];
    foreach ($fields as $field => $type) {
        $before = $old[$field] ?? null;
        $after = $new[$field];
        if ($type === 'numnull') {
            if ($before === null && $after === null) {
                continue;
            }
            if ($before !== null && $after !== null && abs((float) $before - (float) $after) < 0.00005) {
                continue;
            }
            $changes[$field] = [$before === null ? null : (float) $before, $after === null ? null : (float) $after];
        } elseif ($type === 'num') {
            if ($before !== null && abs((float) $before - (float) $after) < 0.00005) {
                continue;
            }
            $changes[$field] = [$before === null ? null : (float) $before, (float) $after];
        } elseif ((string) $before !== (string) $after) {
            $changes[$field] = [$before, $after];
        }
    }
    return $changes;
}

function log_diff(string $batch, string $entity, string $key, array $diff, array $user, string $note): void
{
    foreach ($diff as $field => [$before, $after]) {
        record_price_change($batch, $entity, $key, $field, $before, $after, $user, $note);
    }
}

// ---------- Importação inicial (data.js → banco) ----------

// The browser already parses data.js exactly as the portal uses it today, so it sends those
// parsed values; the server validates every number before storing. Runs only once.
function import_catalog(array $user, $input): array
{
    if (catalog_is_imported()) {
        fail(409, 'A tabela de preços já foi importada. Use as telas de edição para alterá-la.');
    }
    $data = is_array($input) ? $input : [];

    $lines = [];
    foreach (input_rows($data['costLines'] ?? [], 'Importação sem grupos de preço.') as $raw) {
        $line = clean_cost_line($raw);
        $line['name'] = $line['name'] !== '' ? $line['name'] : $line['key'];
        $lines[$line['key']] = $line;
    }
    $freight = [];
    foreach (input_rows($data['freight'] ?? [], 'Importação sem tabela de frete.') as $raw) {
        $row = clean_freight($raw);
        $freight[$row['uf'] . '/' . $row['praca_type']] = $row;
    }
    $products = [];
    foreach (input_rows($data['products'] ?? [], 'Importação sem produtos.') as $raw) {
        $product = clean_product($raw);
        if (!isset($lines[$product['cost_line_key']])) {
            fail(422, "O produto {$product['codigo']} aponta para um grupo de preço inexistente ({$product['cost_line_key']}).");
        }
        // The portal always used the first row of a repeated code, so the import does the same.
        if (!isset($products[$product['codigo']])) {
            $products[$product['codigo']] = $product;
        }
    }

    return catalog_transaction(function (PDO $pdo) use ($user, $lines, $freight, $products) {
        $now = now_iso();
        $insertLine = $pdo->prepare('INSERT INTO cost_lines (key, name, custo_base, desp_com, desp_adm, price100, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach ($lines as $l) {
            $insertLine->execute([$l['key'], $l['name'], $l['custo_base'], $l['desp_com'], $l['desp_adm'], $l['price100'], $now]);
        }
        $insertFreight = $pdo->prepare('INSERT INTO freight_rates (uf, praca_type, label, tier1, tier2, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($freight as $f) {
            $insertFreight->execute([$f['uf'], $f['praca_type'], $f['label'], $f['tier1'], $f['tier2'], $now]);
        }
        $order = 0;
        foreach ($products as $p) {
            insert_product($pdo, $p, ++$order, $now);
        }

        $counts = ['costLines' => count($lines), 'freight' => count($freight), 'products' => count($products)];
        $summary = sprintf('%d grupos de preço, %d fretes, %d produtos', $counts['costLines'], $counts['freight'], $counts['products']);
        record_price_change(new_price_batch(), 'catalog', 'import', 'import', null, $summary, $user, 'Importação inicial do data.js');
        bump_pricing_version();
        audit('pricing.import', null, $counts);
        return $counts;
    });
}

// ---------- Edição ----------

function update_cost_lines(array $user, $lines, string $note): int
{
    require_catalog_imported();
    $rows = input_rows($lines, 'Nenhum grupo de preço enviado.');

    return catalog_transaction(function (PDO $pdo) use ($user, $rows, $note) {
        $batch = new_price_batch();
        $now = now_iso();
        $changed = 0;
        foreach ($rows as $raw) {
            $line = clean_cost_line($raw);
            $old = find_cost_line($line['key']);
            if (!$old) {
                if ($line['name'] === '') {
                    fail(422, 'Informe o nome do novo grupo de preço.');
                }
                $pdo->prepare('INSERT INTO cost_lines (key, name, custo_base, desp_com, desp_adm, price100, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    ->execute([$line['key'], $line['name'], $line['custo_base'], $line['desp_com'], $line['desp_adm'], $line['price100'], $now]);
                log_diff($batch, 'cost_line', $line['key'], diff_fields([], $line, COST_LINE_FIELDS), $user, $note);
                $changed++;
                continue;
            }
            if ($line['name'] === '') {
                $line['name'] = $old['name'];
            }
            $diff = diff_fields($old, $line, COST_LINE_FIELDS);
            if (!$diff) {
                continue;
            }
            $pdo->prepare('UPDATE cost_lines SET name = ?, custo_base = ?, desp_com = ?, desp_adm = ?, price100 = ?, updated_at = ? WHERE key = ?')
                ->execute([$line['name'], $line['custo_base'], $line['desp_com'], $line['desp_adm'], $line['price100'], $now, $line['key']]);
            log_diff($batch, 'cost_line', $line['key'], $diff, $user, $note);
            $changed++;
        }
        if ($changed) {
            bump_pricing_version();
            audit('pricing.cost_lines', null, ['changed' => $changed]);
        }
        return $changed;
    });
}

// Each row is created or updated; a row with "remove": true deletes that UF/praça.
function update_freight(array $user, $rows, string $note): int
{
    require_catalog_imported();
    $list = input_rows($rows, 'Nenhuma praça de frete enviada.');

    return catalog_transaction(function (PDO $pdo) use ($user, $list, $note) {
        $batch = new_price_batch();
        $now = now_iso();
        $changed = 0;
        foreach ($list as $raw) {
            $row = clean_freight($raw);
            $key = $row['uf'] . '/' . $row['praca_type'];
            $old = find_freight_rate($row['uf'], $row['praca_type']);
            if (!empty($raw['remove'])) {
                if ($old) {
                    $pdo->prepare('DELETE FROM freight_rates WHERE uf = ? AND praca_type = ?')->execute([$row['uf'], $row['praca_type']]);
                    record_price_change($batch, 'freight', $key, 'removido', $old['label'], null, $user, $note);
                    $changed++;
                }
                continue;
            }
            if (!$old) {
                $pdo->prepare('INSERT INTO freight_rates (uf, praca_type, label, tier1, tier2, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$row['uf'], $row['praca_type'], $row['label'], $row['tier1'], $row['tier2'], $now]);
                log_diff($batch, 'freight', $key, diff_fields([], $row, FREIGHT_FIELDS), $user, $note);
                $changed++;
                continue;
            }
            $diff = diff_fields($old, $row, FREIGHT_FIELDS);
            if (!$diff) {
                continue;
            }
            $pdo->prepare('UPDATE freight_rates SET label = ?, tier1 = ?, tier2 = ?, updated_at = ? WHERE uf = ? AND praca_type = ?')
                ->execute([$row['label'], $row['tier1'], $row['tier2'], $now, $row['uf'], $row['praca_type']]);
            log_diff($batch, 'freight', $key, $diff, $user, $note);
            $changed++;
        }
        if ($changed) {
            bump_pricing_version();
            audit('pricing.freight', null, ['changed' => $changed]);
        }
        return $changed;
    });
}

// The code is the product's identity (orders reference it), so it can be created but never renamed.
function save_product(array $user, $input, string $note): bool
{
    return save_products($user, [$input], $note) > 0;
}

// Saves one or many edited products in a single transaction: either every row is valid and
// saved, or nothing is. One history batch and one version bump for the whole set.
function save_products(array $user, $inputs, string $note): int
{
    require_catalog_imported();
    $rows = [];
    foreach (input_rows($inputs, 'Nenhum produto enviado.') as $raw) {
        $product = clean_product($raw);
        if (!find_cost_line($product['cost_line_key'])) {
            fail(422, "Escolha um grupo de preço válido para {$product['codigo']}.");
        }
        $rows[] = ['product' => $product, 'isNew' => !empty($raw['isNew'])];
    }

    return catalog_transaction(function (PDO $pdo) use ($user, $rows, $note) {
        $batch = new_price_batch();
        $now = now_iso();
        $changed = 0;
        foreach ($rows as $row) {
            $product = $row['product'];
            $old = find_product($product['codigo']);
            if ($row['isNew']) {
                if ($old) {
                    fail(409, "Já existe um produto com o código {$product['codigo']}.");
                }
                $order = (int) $pdo->query('SELECT COALESCE(MAX(sort_order), 0) FROM products')->fetchColumn() + 1;
                insert_product($pdo, $product, $order, $now);
                log_diff($batch, 'product', $product['codigo'], diff_fields([], $product, PRODUCT_FIELDS), $user, $note);
            } else {
                if (!$old) {
                    fail(404, "Produto {$product['codigo']} não encontrado.");
                }
                $diff = diff_fields($old, $product, PRODUCT_FIELDS);
                if (!$diff) {
                    continue;
                }
                update_product($pdo, $product, $now);
                log_diff($batch, 'product', $product['codigo'], $diff, $user, $note);
            }
            $changed++;
        }
        if ($changed) {
            bump_pricing_version();
            audit('pricing.products', null, ['changed' => $changed]);
        }
        return $changed;
    });
}

function insert_product(PDO $pdo, array $p, int $sortOrder, string $now): void
{
    $pdo->prepare('INSERT INTO products (codigo, descricao, categoria, subcat, cost_line_key, weight, ncm, active, sort_order, price_override, min_margin, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$p['codigo'], $p['descricao'], $p['categoria'], $p['subcat'], $p['cost_line_key'], $p['weight'], $p['ncm'], $p['active'], $sortOrder, $p['price_override'], $p['min_margin'], $now]);
}

function update_product(PDO $pdo, array $p, string $now): void
{
    $pdo->prepare('UPDATE products SET descricao = ?, categoria = ?, subcat = ?, cost_line_key = ?, weight = ?, ncm = ?, active = ?, price_override = ?, min_margin = ?, updated_at = ? WHERE codigo = ?')
        ->execute([$p['descricao'], $p['categoria'], $p['subcat'], $p['cost_line_key'], $p['weight'], $p['ncm'], $p['active'], $p['price_override'], $p['min_margin'], $now, $p['codigo']]);
}

// FOB of one product today: its individual price, or line price 100% NF × weight.
function product_fob(array $product, array $line): float
{
    return $product['price_override'] !== null
        ? (float) $product['price_override']
        : (float) $line['price100'] * (float) $product['weight'];
}

// Same change for many products at once — typically everything in one category, filtered on screen.
// percent    = individual price = today's FOB × (1 + %), rounded to cents;
// setLine    = move the products to another product line (their price follows that line);
// clearPrice = drop the individual price, back to the line price.
function bulk_update_products(array $user, $input): int
{
    require_catalog_imported();
    $data = is_array($input) ? $input : [];
    $action = (string) ($data['action'] ?? '');
    if (!in_array($action, PRODUCT_BULK_ACTIONS, true)) {
        fail(422, 'Ação em lote inválida.');
    }
    $codes = array_values(array_unique(array_filter(array_map(fn($v) => is_string($v) ? $v : '', is_array($data['codigos'] ?? null) ? $data['codigos'] : []))));
    if (!$codes) {
        fail(422, 'Nenhum produto selecionado.');
    }
    if (count($codes) > MAX_CATALOG_ROWS) {
        fail(422, 'Produtos demais em uma única alteração.');
    }
    $note = str_field($data['note'] ?? '', 300);

    $factor = 1.0;
    if ($action === 'percent') {
        if (!is_numeric($data['percent'] ?? null)) {
            fail(422, 'Informe o percentual do reajuste.');
        }
        $percent = round((float) $data['percent'], 4);
        if ($percent == 0 || $percent < BULK_MIN_PERCENT || $percent > BULK_MAX_PERCENT) {
            fail(422, sprintf('O reajuste precisa estar entre %d%% e %d%% e ser diferente de zero.', BULK_MIN_PERCENT, BULK_MAX_PERCENT));
        }
        $factor = 1 + $percent / 100;
        $note = trim(sprintf('Reajuste de %s%% nos produtos selecionados. %s', history_value($percent), $note));
    }
    $targetLine = null;
    if ($action === 'setLine') {
        $targetLine = find_cost_line(normalize_cost_line_key($data['costLineKey'] ?? ''));
        if (!$targetLine) {
            fail(422, 'Escolha um grupo de preço válido.');
        }
    }

    return catalog_transaction(function (PDO $pdo) use ($user, $codes, $action, $factor, $targetLine, $note) {
        $batch = new_price_batch();
        $now = now_iso();
        $lines = [];
        foreach (all_cost_lines() as $line) {
            $lines[$line['key']] = $line;
        }
        $changed = 0;
        foreach ($codes as $codigo) {
            $old = find_product($codigo);
            if (!$old) {
                continue;
            }
            $new = $old;
            if ($action === 'percent') {
                $new['price_override'] = round(product_fob($old, $lines[$old['cost_line_key']]) * $factor, 2);
            } elseif ($action === 'setLine') {
                $new['cost_line_key'] = $targetLine['key'];
            } else {
                $new['price_override'] = null;
            }
            $diff = diff_fields($old, $new, PRODUCT_FIELDS);
            if (!$diff) {
                continue;
            }
            update_product($pdo, $new, $now);
            log_diff($batch, 'product', $codigo, $diff, $user, $note);
            $changed++;
        }
        if ($changed) {
            bump_pricing_version();
            audit('pricing.products_bulk', null, ['action' => $action, 'changed' => $changed]);
        }
        return $changed;
    });
}

// ---------- Reajuste em lote ----------

// With "preview" it only returns what would change; the same request without it applies.
// Every new value is rounded to cents, the precision the spreadsheet already uses.
function bulk_adjust(array $user, $input): array
{
    require_catalog_imported();
    $data = is_array($input) ? $input : [];
    if (!is_numeric($data['percent'] ?? null)) {
        fail(422, 'Informe o percentual do reajuste.');
    }
    $percent = round((float) $data['percent'], 4);
    if ($percent == 0 || $percent < BULK_MIN_PERCENT || $percent > BULK_MAX_PERCENT) {
        fail(422, sprintf('O reajuste precisa estar entre %d%% e %d%% e ser diferente de zero.', BULK_MIN_PERCENT, BULK_MAX_PERCENT));
    }
    $factor = 1 + $percent / 100;
    $note = str_field($data['note'] ?? '', 300);
    $target = (string) ($data['target'] ?? '');
    $selected = array_values(array_filter(array_map(fn($v) => is_string($v) ? $v : '', is_array($data['keys'] ?? null) ? $data['keys'] : [])));

    $updates = [];
    if ($target === 'costLines') {
        $mode = (string) ($data['mode'] ?? 'priceAndCosts');
        if (!array_key_exists($mode, BULK_MODES)) {
            fail(422, 'Modo de reajuste inválido.');
        }
        $keys = array_map('normalize_cost_line_key', $selected);
        foreach (all_cost_lines() as $row) {
            if ($keys && !in_array($row['key'], $keys, true)) {
                continue;
            }
            $new = $row;
            foreach (BULK_MODES[$mode] as $field) {
                $new[$field] = round((float) $row[$field] * $factor, 2);
            }
            assert_cost_line_consistent($new, $row['name']);
            $diff = diff_fields($row, $new, COST_LINE_FIELDS);
            if ($diff) {
                $updates[] = ['entity' => 'cost_line', 'key' => $row['key'], 'label' => $row['name'], 'row' => $new, 'diff' => $diff];
            }
        }
    } elseif ($target === 'freight') {
        $ufs = array_map('strtoupper', $selected);
        foreach (all_freight_rates() as $row) {
            if ($ufs && !in_array($row['uf'], $ufs, true)) {
                continue;
            }
            $new = $row;
            foreach (FREIGHT_TIERS as $field) {
                $new[$field] = round((float) $row[$field] * $factor, 2);
            }
            $diff = diff_fields($row, $new, FREIGHT_FIELDS);
            if ($diff) {
                $updates[] = ['entity' => 'freight', 'key' => $row['uf'] . '/' . $row['praca_type'], 'label' => $row['uf'] . ' · ' . $row['praca_type'], 'row' => $new, 'diff' => $diff];
            }
        }
    } else {
        fail(422, 'Escolha se o reajuste é nos grupos de preço ou no frete.');
    }
    if (!$updates) {
        fail(422, 'Nenhum valor mudaria com esse reajuste. Confira a seleção.');
    }

    $changes = [];
    foreach ($updates as $u) {
        foreach ($u['diff'] as $field => [$before, $after]) {
            $changes[] = ['entity' => $u['entity'], 'key' => $u['key'], 'label' => $u['label'], 'field' => $field, 'oldValue' => $before, 'newValue' => $after];
        }
    }
    if (!empty($data['preview'])) {
        return ['applied' => false, 'percent' => $percent, 'changes' => $changes];
    }

    catalog_transaction(function (PDO $pdo) use ($user, $updates, $note, $percent) {
        $batch = new_price_batch();
        $now = now_iso();
        $note = trim(sprintf('Reajuste em lote de %s%%. %s', history_value($percent), $note));
        foreach ($updates as $u) {
            $r = $u['row'];
            if ($u['entity'] === 'cost_line') {
                $pdo->prepare('UPDATE cost_lines SET custo_base = ?, desp_com = ?, desp_adm = ?, price100 = ?, updated_at = ? WHERE key = ?')
                    ->execute([$r['custo_base'], $r['desp_com'], $r['desp_adm'], $r['price100'], $now, $r['key']]);
            } else {
                $pdo->prepare('UPDATE freight_rates SET tier1 = ?, tier2 = ?, updated_at = ? WHERE uf = ? AND praca_type = ?')
                    ->execute([$r['tier1'], $r['tier2'], $now, $r['uf'], $r['praca_type']]);
            }
            log_diff($batch, $u['entity'], $u['key'], $u['diff'], $user, $note);
        }
        bump_pricing_version();
        audit('pricing.bulk_adjust', null, ['percent' => $percent, 'items' => count($updates)]);
    });
    return ['applied' => true, 'percent' => $percent, 'changes' => $changes];
}

// ---------- Preços calculados no servidor para os pedidos ----------

// Same formulas as computeItemPrices() in script_v5.js:
// FOB = preço 100% NF × peso; CIF = (custos + frete) ÷ (custos ÷ preço 100% NF) × peso.
// A product with an individual price uses price ÷ weight as its "preço 100% NF", so its CIF
// keeps the line's proportion between freight and cost.
function server_item_prices(array $product, ?array $freightRate, string $weightTier): array
{
    $weight = (float) $product['weight'];
    $price100 = $product['price_override'] !== null && $weight > 0
        ? (float) $product['price_override'] / $weight
        : (float) $product['price100'];
    $costs = (float) $product['custo_base'] + (float) $product['desp_com'] + (float) $product['desp_adm'];
    // An individual price is used exactly as typed (no ÷ × rounding noise).
    $fob = $product['price_override'] !== null ? (float) $product['price_override'] : $price100 * $weight;
    $freight = $freightRate && in_array($weightTier, FREIGHT_TIERS, true) ? (float) $freightRate[$weightTier] * $weight : 0.0;
    $prices = ['weight' => $weight, 'fob' => $fob, 'cif' => null, 'cost' => $costs * $weight, 'freightCost' => $freight];
    if ($freightRate && $costs > 0 && in_array($weightTier, FREIGHT_TIERS, true)) {
        $divisor = $costs / $price100;
        $prices['cif'] = ($costs + (float) $freightRate[$weightTier]) / $divisor * $weight;
    }
    return $prices;
}

// With the catalog in the database, FOB (the margin base) and, when the item carries its region,
// the CIF reference are recalculated here: an outdated or tampered browser can't change the margin.
function apply_catalog_prices(array $cart, bool $submit): array
{
    if (!$cart || !catalog_is_imported()) {
        return $cart;
    }
    $codes = array_values(array_unique(array_column($cart, 'codigo')));
    $stmt = db()->prepare('
        SELECT p.codigo, p.active, p.weight, p.price_override, p.min_margin, c.custo_base, c.desp_com, c.desp_adm, c.price100
        FROM products p JOIN cost_lines c ON c.key = p.cost_line_key
        WHERE p.codigo IN (' . implode(',', array_fill(0, count($codes), '?')) . ')
    ');
    $stmt->execute($codes);
    $products = [];
    foreach ($stmt->fetchAll() as $row) {
        $products[$row['codigo']] = $row;
    }
    $freight = [];
    foreach (all_freight_rates() as $row) {
        $freight[$row['uf'] . '/' . $row['praca_type']] = $row;
    }

    foreach ($cart as &$item) {
        $product = $products[$item['codigo']] ?? null;
        if (!$product || !(int) $product['active']) {
            if ($submit) {
                fail(422, "O produto {$item['codigo']} não está mais disponível na tabela de preços. Remova-o do pedido para enviar.");
            }
            continue;
        }
        $rate = $freight[$item['uf'] . '/' . $item['cityType']] ?? null;
        $prices = server_item_prices($product, $rate, $item['weightTier']);
        $item['weight'] = $prices['weight'];
        $item['fob'] = $prices['fob'];
        $item['minMargin'] = (float) $product['min_margin'];
        $item['cost'] = $prices['cost'];
        $item['freightCost'] = $prices['freightCost'];
        if ($prices['cif'] !== null) {
            $item['cif'] = $prices['cif'];
            $item['unitDiscount'] = max($prices['cif'] - $item['negotiatedPrice'], 0);
        }
    }
    unset($item);
    return $cart;
}
