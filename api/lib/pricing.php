<?php
// REGRAS COMERCIAIS: os VALORES (limites de desconto, percentuais, avisos) ficam no arquivo
// api/regras_comerciais.php, que NÃO vai para o Git (o repositório é público). No Git fica só o
// modelo api/regras_comerciais.example.php, com números de exemplo.
// O servidor usa as regras para decidir (calculate_order_totals) e as envia para a tela junto com
// a sessão (pricing_rules_for_client), que só as usa para mostrar os cálculos enquanto o pedido é
// montado. Para mudar uma regra, mude o regras_comerciais.php do servidor e nada mais.

// Reads and checks api/regras_comerciais.php once per request. Without it (or with a broken one)
// every action that depends on prices stops with a clear message instead of using wrong numbers.
function pricing_rules(): array
{
    static $rules = null;
    if ($rules !== null) {
        return $rules;
    }
    $path = dirname(__DIR__) . '/regras_comerciais.php';
    $missing = 'As regras comerciais não estão configuradas no servidor: falta o arquivo api/regras_comerciais.php (copie de api/regras_comerciais.example.php e preencha os valores).';
    if (!is_file($path)) {
        fail(500, $missing);
    }
    $raw = require $path;
    $invalid = fn (string $what) => fail(500, "O arquivo api/regras_comerciais.php está incompleto: {$what}.");
    if (!is_array($raw)) {
        $invalid('ele precisa terminar com "return [ ... ];"');
    }
    foreach (['default_product_margin', 'early_payment_discount', 'fob_freight_discount', 'min_justification_length', 'max_negotiated_discount', 'margin_alert_drop'] as $key) {
        if (!isset($raw[$key]) || !is_numeric($raw[$key]) || $raw[$key] < 0) {
            $invalid("falta o número '{$key}'");
        }
    }
    $modes = [];
    foreach (($raw['invoice_modes'] ?? []) as $key => $mode) {
        if (!is_string($key) || !is_array($mode) || !isset($mode['name'], $mode['invoiceShare']) || !is_numeric($mode['maxDiscount'] ?? null)) {
            $invalid("a modalidade '{$key}' precisa de name, invoiceShare e maxDiscount");
        }
        $modes[$key] = [
            'name' => (string) $mode['name'],
            'invoiceShare' => (string) $mode['invoiceShare'],
            'maxDiscount' => (float) $mode['maxDiscount'],
            'notice' => (string) ($mode['notice'] ?? ''),
        ];
    }
    if (!$modes) {
        $invalid("falta a lista 'invoice_modes'");
    }
    $defaultMode = (string) ($raw['default_invoice_mode'] ?? '');
    if (!isset($modes[$defaultMode])) {
        $invalid("'default_invoice_mode' precisa ser uma das modalidades de 'invoice_modes'");
    }
    $rules = [
        'defaultProductMargin' => (float) $raw['default_product_margin'],   // produto sem margem informada
        'earlyPaymentDiscount' => (float) $raw['early_payment_discount'],
        'fobFreightDiscount' => (float) $raw['fob_freight_discount'],
        'minJustificationLength' => (int) $raw['min_justification_length'],
        // Teto do desconto negociado: acima dele o pedido não é enviado, nem com justificativa.
        'maxNegotiatedDiscount' => (float) $raw['max_negotiated_discount'],
        // "Margem preocupante": pontos que a margem do pedido pode cair abaixo da margem de tabela do
        // próprio pedido (só gestor e admin recebem este número).
        'marginAlertDrop' => (float) $raw['margin_alert_drop'],
        // Modalidade da nota, escolhida pelo representante em cada pedido. maxDiscount é o desconto
        // NEGOCIADO permitido contra o preço de tabela; acima dele o envio exige justificativa.
        // notice aparece para o representante e o gestor sempre que o pedido tem algum desconto.
        'invoiceModes' => $modes,
        'defaultInvoiceMode' => $defaultMode,
    ];
    return $rules;
}

function pricing_default_product_margin(): float
{
    return pricing_rules()['defaultProductMargin'];
}

function pricing_min_justification_length(): int
{
    return pricing_rules()['minJustificationLength'];
}

function invoice_mode_label(array $mode): string
{
    return sprintf('%s (%s)', $mode['name'], $mode['invoiceShare']);
}

// Margins (of products and orders) are for the gestor and the admin only: representatives never
// receive them, neither on screen nor in the data the API sends (decision of 2026-11-10).
function can_see_margins(?array $user): bool
{
    return $user !== null && in_array($user['role'], [ROLE_GESTOR, ROLE_ADMIN], true);
}

// What the screen needs to show the same calculations while the order is being built.
function pricing_rules_for_client(?array $user): array
{
    $rules = pricing_rules();
    $modes = [];
    foreach ($rules['invoiceModes'] as $key => $mode) {
        $modes[] = ['key' => $key] + $mode;
    }
    $client = ['invoiceModes' => $modes] + $rules;
    if (!can_see_margins($user)) {
        unset($client['defaultProductMargin'], $client['marginAlertDrop']);
    }
    return $client;
}

// Percentages always come from the server rules, never from the request body,
// so a tampered request can't claim "antecipado" at 0% to inflate the margin.
function normalize_order_conditions($conditions): array
{
    $c = is_array($conditions) ? $conditions : [];
    $rules = pricing_rules();
    $mode = is_string($c['invoiceMode'] ?? null) && array_key_exists($c['invoiceMode'], $rules['invoiceModes'])
        ? $c['invoiceMode']
        : $rules['defaultInvoiceMode'];
    return [
        'manualDiscount' => min(num_field($c['manualDiscount'] ?? 0), 100.0),
        'contract' => min(num_field($c['contract'] ?? 0), 100.0),
        'earlyPayment' => !empty($c['earlyPayment']),
        'fobFreight' => !empty($c['fobFreight']),
        'earlyPaymentPercent' => $rules['earlyPaymentDiscount'],
        'fobFreightPercent' => $rules['fobFreightDiscount'],
        'invoiceMode' => $mode,
        'lowMarginJustification' => str_field($c['lowMarginJustification'] ?? '', 1000),
    ];
}

function order_discount_percent(array $c): float
{
    return $c['manualDiscount']
        + ($c['earlyPayment'] ? $c['earlyPaymentPercent'] : 0)
        + ($c['fobFreight'] ? $c['fobFreightPercent'] : 0);
}

function format_percent(float $value): string
{
    return rtrim(rtrim(number_format($value, 2, ',', ''), '0'), ',');
}

// MARGEM: each product has a margin at full price (tableMargin). Selling at the table price
// of R$ 100 with 8% of margin means R$ 92 must be kept; discounts lower the price while that
// amount stays put:  margem = (líquido − tabela × (1 − margem do produto)) ÷ valor da nota.
// The contract raises the invoice but is paid out by Hiperroll, so it lowers the margin.
// The margin is stored for the gestor to see; it blocks nothing.
//
// DESCONTO: two numbers.
//  - negotiatedDiscount: what the representative negotiated (item discounts + order discount)
//    against the table price. It is the one checked against the modality's limit (above it, only
//    with a justification) and against the ceiling maxNegotiatedDiscount (above it, never).
//  - effectiveDiscount: everything the customer pays less than the table, adding the pagamento
//    antecipado and the frete FOB. Those two are shown apart and count in no limit (2026-11-10).
function calculate_order_totals(array $cart, array $conditions): array
{
    $discountPercent = order_discount_percent($conditions);
    $discountFactor = max(1 - $discountPercent / 100, 0);
    $negotiatedFactor = max(1 - $conditions['manualDiscount'] / 100, 0);
    $contractFactor = 1 + $conditions['contract'] / 100;

    $totalNet = 0.0;
    $totalNegotiated = 0.0;
    $totalInvoice = 0.0;
    $totalProfit = 0.0;
    $totalTable = 0.0;
    $tableProfit = 0.0;
    $totalWeight = 0.0;
    $lines = [];
    foreach ($cart as $item) {
        $qty = (float) $item['qty'];
        $negotiatedUnit = $item['negotiatedPrice'] > 0 ? $item['negotiatedPrice'] : $item['cif'];
        $tableUnit = $item['cif'] > 0 ? $item['cif'] : $negotiatedUnit;
        $netUnit = $negotiatedUnit * $discountFactor;
        $invoiceUnit = $netUnit * $contractFactor;
        $productMargin = $item['tableMargin'] ?? pricing_default_product_margin();
        $keepUnit = $tableUnit * (1 - $productMargin / 100);
        $totalNet += $netUnit * $qty;
        $totalNegotiated += $negotiatedUnit * $negotiatedFactor * $qty;
        $totalInvoice += $invoiceUnit * $qty;
        $totalProfit += ($netUnit - $keepUnit) * $qty;
        $totalTable += $tableUnit * $qty;
        $tableProfit += $tableUnit * ($productMargin / 100) * $qty;
        $totalWeight += (float) ($item['weight'] ?? 0) * $qty;
        $lines[] = [
            'codigo' => $item['codigo'],
            'uf' => $item['uf'] ?? '',
            'cityType' => $item['cityType'] ?? '',
            'weightTier' => $item['weightTier'] ?? '',
            'unitPrice' => $netUnit,
            'margin' => $invoiceUnit > 0 ? (($netUnit - $keepUnit) / $invoiceUnit) * 100 : 0.0,
        ];
    }

    $margin = $totalInvoice > 0 ? ($totalProfit / $totalInvoice) * 100 : 0.0;
    // Margin this same order would have at full table price (each product's margin, weighted).
    $tableMargin = $totalTable > 0 ? ($tableProfit / $totalTable) * 100 : 0.0;
    // Rounded to cents of a percent so float noise never turns "exactly 10%" into "above 10%".
    $toDiscount = fn (float $paid) => $totalTable > 0 ? max(round((1 - $paid / $totalTable) * 100, 2), 0.0) : 0.0;
    $effectiveDiscount = $toDiscount($totalNet);
    $negotiatedDiscount = $toDiscount($totalNegotiated);

    $rules = pricing_rules();
    $mode = $rules['invoiceModes'][$conditions['invoiceMode']] ?? $rules['invoiceModes'][$rules['defaultInvoiceMode']];
    $hasItems = count($cart) > 0;
    $discountBlocked = $hasItems && $negotiatedDiscount > $rules['maxNegotiatedDiscount'];
    $discountExceeded = $hasItems && $negotiatedDiscount > $mode['maxDiscount'];
    // "Margem preocupante": the order lost more than marginAlertDrop points of its own table margin.
    $marginAlert = $hasItems && $margin < $tableMargin - $rules['marginAlertDrop'];

    $alerts = [];
    if ($discountBlocked) {
        $alerts[] = sprintf('Desconto negociado de %s%% acima do máximo de %s%%: o pedido não pode ser enviado', format_percent($negotiatedDiscount), format_percent($rules['maxNegotiatedDiscount']));
    } elseif ($discountExceeded) {
        $alerts[] = $mode['maxDiscount'] == 0
            ? sprintf('Desconto negociado de %s%% na modalidade %s, que não permite desconto', format_percent($negotiatedDiscount), invoice_mode_label($mode))
            : sprintf('Desconto negociado de %s%% acima do limite de %s%% da modalidade %s', format_percent($negotiatedDiscount), format_percent($mode['maxDiscount']), invoice_mode_label($mode));
    }

    return [
        'margin' => $margin,
        'tableMargin' => $tableMargin,
        'marginAlert' => $marginAlert,
        'discountPercent' => $discountPercent,
        'effectiveDiscount' => $effectiveDiscount,
        'negotiatedDiscount' => $negotiatedDiscount,
        'totalNet' => $totalNet,
        'totalInvoice' => $totalInvoice,
        'totalWeight' => $totalWeight,
        'discountExceeded' => $discountExceeded,
        'discountBlocked' => $discountBlocked,
        'requiresJustification' => $discountExceeded,
        'alerts' => $alerts,
        'lines' => $lines,
    ];
}
