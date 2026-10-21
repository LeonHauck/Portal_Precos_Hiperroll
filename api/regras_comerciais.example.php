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

    // Desconto do pagamento antecipado e do frete FOB (%). Contam no desconto total do pedido.
    'early_payment_discount' => 1.5,
    'fob_freight_discount' => 2.5,

    // Tamanho mínimo da justificativa quando o desconto passa do limite da modalidade.
    'min_justification_length' => 10,

    // Modalidades que o representante escolhe no pedido. maxDiscount = desconto total permitido
    // contra o preço de tabela (%); notice = aviso mostrado quando o pedido tem desconto.
    'invoice_modes' => [
        'livre' => ['name' => 'Livre', 'invoiceShare' => '100%', 'maxDiscount' => 0.0, 'notice' => ''],
        'aval' => ['name' => 'Aval', 'invoiceShare' => '50%', 'maxDiscount' => 8.0, 'notice' => 'PEDIDO DEVE SER IMPLANTADO AVAL.'],
        'garantia' => ['name' => 'Garantia', 'invoiceShare' => '10%', 'maxDiscount' => 15.0, 'notice' => 'PEDIDO DEVE SER IMPLANTADO GARANTIA.'],
    ],

    // Modalidade marcada num pedido novo.
    'default_invoice_mode' => 'livre',
];
