<?php
// Espelho de PRICING_RULES / INVOICE_MODES / calculateOrderTotals do script_v5.js.
// O navegador calcula para mostrar na tela; o servidor recalcula para decidir.
// Se mudar uma regra aqui, mude também no JavaScript (e vice-versa).

const PRICING_DEFAULT_PRODUCT_MARGIN = 10.0;   // produto sem margem informada na tabela
const PRICING_EARLY_PAYMENT_DISCOUNT = 2.0;
const PRICING_FOB_FREIGHT_DISCOUNT = 3.0;
const PRICING_MIN_JUSTIFICATION_LENGTH = 10;

// Modalidade da nota, escolhida pelo representante em cada pedido. maxDiscount é o desconto
// total permitido contra o preço de tabela; acima dele o envio exige justificativa.
const PRICING_INVOICE_MODES = [
    'livre' => ['label' => 'Livre (100%)', 'maxDiscount' => 0.0],
    'aval' => ['label' => 'Aval (50%)', 'maxDiscount' => 10.0],
    'garantia' => ['label' => 'Garantia (10%)', 'maxDiscount' => 20.0],
];
const PRICING_DEFAULT_INVOICE_MODE = 'livre';

// Percentages always come from the server rules, never from the request body,
// so a tampered request can't claim "antecipado" at 0% to inflate the margin.
function normalize_order_conditions($conditions): array
{
    $c = is_array($conditions) ? $conditions : [];
    $mode = is_string($c['invoiceMode'] ?? null) && array_key_exists($c['invoiceMode'], PRICING_INVOICE_MODES)
        ? $c['invoiceMode']
        : PRICING_DEFAULT_INVOICE_MODE;
    return [
        'manualDiscount' => min(num_field($c['manualDiscount'] ?? 0), 100.0),
        'contract' => min(num_field($c['contract'] ?? 0), 100.0),
        'earlyPayment' => !empty($c['earlyPayment']),
        'fobFreight' => !empty($c['fobFreight']),
        'earlyPaymentPercent' => PRICING_EARLY_PAYMENT_DISCOUNT,
        'fobFreightPercent' => PRICING_FOB_FREIGHT_DISCOUNT,
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
// of R$ 100 with 5% of margin means R$ 95 must be kept; discounts lower the price while that
// amount stays put:  margem = (líquido − tabela × (1 − margem do produto)) ÷ valor da nota.
// The contract raises the invoice but is paid out by Hiperroll, so it lowers the margin.
// Items saved before the product margins existed (tableMargin null) keep lucro = líquido − FOB.
// The margin is stored for the gestor to see; it blocks nothing.
//
// DESCONTO: what the customer pays against the table price (item discounts, order discount,
// antecipado and frete FOB all count). Above the modality's limit the order needs a justification.
function calculate_order_totals(array $cart, array $conditions): array
{
    $discountPercent = order_discount_percent($conditions);
    $discountFactor = max(1 - $discountPercent / 100, 0);
    $contractFactor = 1 + $conditions['contract'] / 100;

    $totalNet = 0.0;
    $totalInvoice = 0.0;
    $totalProfit = 0.0;
    $totalTable = 0.0;
    foreach ($cart as $item) {
        $qty = (float) $item['qty'];
        $negotiatedUnit = $item['negotiatedPrice'] > 0 ? $item['negotiatedPrice'] : $item['cif'];
        $tableUnit = $item['cif'] > 0 ? $item['cif'] : $negotiatedUnit;
        $netUnit = $negotiatedUnit * $discountFactor;
        $keepUnit = isset($item['tableMargin'])
            ? $tableUnit * (1 - $item['tableMargin'] / 100)
            : $item['fob'];
        $totalNet += $netUnit * $qty;
        $totalInvoice += $netUnit * $contractFactor * $qty;
        $totalProfit += ($netUnit - $keepUnit) * $qty;
        $totalTable += $tableUnit * $qty;
    }

    $margin = $totalInvoice > 0 ? ($totalProfit / $totalInvoice) * 100 : 0.0;
    // Rounded to cents of a percent so float noise never turns "exactly 10%" into "above 10%".
    $effectiveDiscount = $totalTable > 0 ? max(round((1 - $totalNet / $totalTable) * 100, 2), 0.0) : 0.0;

    $mode = PRICING_INVOICE_MODES[$conditions['invoiceMode']] ?? null;
    $discountExceeded = count($cart) > 0 && $mode !== null && $effectiveDiscount > $mode['maxDiscount'];

    $alerts = [];
    if ($discountExceeded) {
        $alerts[] = $mode['maxDiscount'] == 0
            ? sprintf('Desconto de %s%% na modalidade %s, que não permite desconto', format_percent($effectiveDiscount), $mode['label'])
            : sprintf('Desconto de %s%% acima do limite de %s%% da modalidade %s', format_percent($effectiveDiscount), format_percent($mode['maxDiscount']), $mode['label']);
    }

    return [
        'margin' => $margin,
        'discountPercent' => $discountPercent,
        'effectiveDiscount' => $effectiveDiscount,
        'totalNet' => $totalNet,
        'totalInvoice' => $totalInvoice,
        'discountExceeded' => $discountExceeded,
        'requiresJustification' => $discountExceeded,
        'alerts' => $alerts,
    ];
}
