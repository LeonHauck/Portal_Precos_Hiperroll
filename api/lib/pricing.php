<?php
// Espelho de PRICING_RULES / calculateOrderTotals do script_v5.js.
// O navegador calcula para mostrar na tela; o servidor recalcula para decidir.
// Se mudar uma regra aqui, mude também no JavaScript (e vice-versa).

const PRICING_MIN_ORDER_MARGIN = 10.0;
const PRICING_TARGET_MARGIN = 15.0;
const PRICING_EARLY_PAYMENT_DISCOUNT = 2.0;
const PRICING_FOB_FREIGHT_DISCOUNT = 3.0;
const PRICING_MIN_JUSTIFICATION_LENGTH = 10;
// What leaves the invoice before it becomes margin, as in the cost spreadsheet (100% NF):
// ICMS 12 + PIS 1,65 + COFINS 7,6 + comissão 3 + despesa financeira 3,26.
const PRICING_SALE_DEDUCTIONS_PERCENT = 27.51;

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
        'deductionsPercent' => PRICING_SALE_DEDUCTIONS_PERCENT,
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

    $totalNet = 0.0;
    $totalInvoice = 0.0;
    $totalProfit = 0.0;
    $requiredProfit = 0.0;
    foreach ($cart as $item) {
        $qty = (float) $item['qty'];
        $negotiatedUnit = $item['negotiatedPrice'] > 0 ? $item['negotiatedPrice'] : $item['cif'];
        $netUnit = $negotiatedUnit * $discountFactor;
        $invoiceUnit = $netUnit * $contractFactor;
        $invoice = $invoiceUnit * $qty;
        // Net margin, as the cost spreadsheet forms a price: cost (product + expenses, plus the
        // region's freight unless the customer pays it) and the sale deductions leave the price.
        // Items saved before this rule have no cost: they keep lucro = líquido − FOB.
        $hasCost = isset($item['cost']) && $item['cost'] > 0;
        $costUnit = $hasCost
            ? $item['cost'] + ($conditions['fobFreight'] ? 0.0 : (float) ($item['freightCost'] ?? 0))
            : $item['fob'];
        $deductionsUnit = $hasCost ? $invoiceUnit * ($conditions['deductionsPercent'] / 100) : 0.0;
        $totalNet += $netUnit * $qty;
        $totalInvoice += $invoice;
        $totalProfit += ($netUnit - $costUnit - $deductionsUnit) * $qty;
        $requiredProfit += (($item['minMargin'] ?? $conditions['minMargin']) / 100) * $invoice;
    }

    // The contract raises the invoice but is paid out by Hiperroll, so it adds nothing to the
    // profit (same rule as calculateOrderTotals in script_v5.js).
    $margin = $totalInvoice > 0 ? ($totalProfit / $totalInvoice) * 100 : 0.0;
    // Each product has its own minimum margin; the order's minimum is their average weighted
    // by each item's invoice value. Rounded so float noise never flags an exact-minimum order.
    $minMargin = $totalInvoice > 0 ? round(($requiredProfit / $totalInvoice) * 100, 4) : (float) $conditions['minMargin'];
    return [
        'margin' => $margin,
        'minMargin' => $minMargin,
        'discountPercent' => $discountPercent,
        'totalNet' => $totalNet,
        'totalInvoice' => $totalInvoice,
        'belowMinimum' => count($cart) > 0 && $margin < $minMargin,
    ];
}
