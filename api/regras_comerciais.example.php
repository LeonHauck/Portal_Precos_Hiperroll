<?php
// MODELO das regras comerciais. Os números abaixo são EXEMPLOS, não os da empresa.
//
// Na instalação: copie este arquivo para api/regras_comerciais.php (que NÃO vai para o Git) e
// coloque os valores reais. Sem esse arquivo o servidor recusa as ações que dependem de preço,
// com uma mensagem dizendo o que falta.
//
// Os valores reais ficam só na máquina de desenvolvimento e no servidor; o repositório é público.
return [
    // Margem usada quando um produto da tabela não tem margem informada (%).
    'default_product_margin' => 12.0,

    // Desconto do pagamento antecipado e do frete FOB (%). Baixam o preço (e a margem), mas ficam
    // fora do limite da modalidade e do teto abaixo: só o desconto negociado conta neles.
    'early_payment_discount' => 1.5,
    'fob_freight_discount' => 2.5,

    // Tamanho mínimo da justificativa quando o desconto passa do limite da modalidade.
    'min_justification_length' => 10,

    // Teto do desconto negociado (%): acima dele o pedido não é enviado, nem com justificativa.
    'max_negotiated_discount' => 18.0,

    // "Margem preocupante": quantos pontos a margem do pedido pode cair abaixo da margem de tabela
    // do próprio pedido. Passou disso, o gestor vê o alerta forte e o pedido não é aprovado sozinho.
    'margin_alert_drop' => 6.0,

    // Modalidades que o representante escolhe no pedido. maxDiscount = desconto negociado permitido
    // contra o preço de tabela (%), acima dele só com justificativa; notice = aviso mostrado quando
    // o pedido tem desconto.
    'invoice_modes' => [
        'livre' => ['name' => 'Livre', 'invoiceShare' => '100%', 'maxDiscount' => 0.0, 'notice' => ''],
        'aval' => ['name' => 'Aval', 'invoiceShare' => '50%', 'maxDiscount' => 8.0, 'notice' => 'PEDIDO DEVE SER IMPLANTADO AVAL.'],
        'garantia' => ['name' => 'Garantia', 'invoiceShare' => '10%', 'maxDiscount' => 15.0, 'notice' => 'PEDIDO DEVE SER IMPLANTADO GARANTIA.'],
    ],

    // Modalidade marcada num pedido novo.
    'default_invoice_mode' => 'livre',
];
