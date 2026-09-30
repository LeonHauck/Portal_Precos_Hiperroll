<?php
// Espelho de PRICING_RULES / calculateOrderTotals do script_v5.js.
// O navegador calcula para mostrar na tela; o servidor recalcula para decidir.
// Se mudar uma regra aqui, mude também no JavaScript (e vice-versa).

const PRICING_MIN_ORDER_MARGIN = 10.0;
const PRICING_TARGET_MARGIN = 15.0;
const PRICING_EARLY_PAYMENT_DISCOUNT = 2.0;
const PRICING_FOB_FREIGHT_DISCOUNT = 3.0;
const PRICING_MIN_JUSTIFICATION_LENGTH = 10;

// Percentages always come from the server rules, never from the request body,
// so a tampered request can't claim "antecipado" at 0% to inflate the margin.
function normalize_order_conditions($conditions): array
{
    $c = is_array($conditions) ? $conditions : [];
    return [
        'manualDiscount' => min(num_field($c['manualDiscount'] ?? 0), 100.0),
        'contract' => min(num_field($c['contract'] ?? 0), 100.0),
        'earlyPayment' => !empty($c['earlyPayment']),
        'fobFreight' => !empty($c['fobFreight']),
        'earlyPaymentPercent' => PRICING_EARLY_PAYMENT_DISCOUNT,
        'fobFreightPercent' => PRICING_FOB_FREIGHT_DISCOUNT,
        'minMargin' => PRICING_MIN_ORDER_MARGIN,
        'lowMarginJustification' => str_field($c['lowMarginJustification'] ?? '', 1000),
    ];
}

function order_discount_percent(array $c): float
{
    return $c['manualDiscount']
        + ($c['earlyPayment'] ? $c['earlyPaymentPercent'] : 0)
        + ($c['fobFreight'] ? $c['fobFreightPercent'] : 0);
}

function calculate_order_totals(array $cart, array $conditions): array
{
    $discountPercent = order_discount_percent($conditions);
    $discountFactor = max(1 - $discountPercent / 100, 0);
    $contractFactor = 1 + $conditions['contract'] / 100;

    $totalFob = 0.0;
    $totalNet = 0.0;
    $totalInvoice = 0.0;
    foreach ($cart as $item) {
        $qty = (float) $item['qty'];
        $negotiatedUnit = $item['negotiatedPrice'] > 0 ? $item['negotiatedPrice'] : $item['cif'];
        $netUnit = $negotiatedUnit * $discountFactor;
        $totalFob += $item['fob'] * $qty;
        $totalNet += $netUnit * $qty;
        $totalInvoice += $netUnit * $contractFactor * $qty;
    }

    // Contract raises the invoice but is paid out by Hiperroll: profit is net − FOB,
    // measured against the full invoice (same rule as calculateOrderTotals in script_v5.js).
    $margin = $totalInvoice > 0 ? (($totalNet - $totalFob) / $totalInvoice) * 100 : 0.0;
    return [
        'margin' => $margin,
        'discountPercent' => $discountPercent,
        'totalNet' => $totalNet,
        'totalInvoice' => $totalInvoice,
        'belowMinimum' => count($cart) > 0 && $margin < $conditions['minMargin'],
    ];
}
