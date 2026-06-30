# 🎯 Quick Reference - Funcionalidades de Negociação

## Resumo das Mudanças Implementadas

### 📋 O que foi adicionado?

#### 1. **HTML (index.html)**
- ✅ Novo elemento: `<div id="totalsPriceContainer">` para aplicar estilos de alerta
- ✅ Novo elemento: `<p id="marginPercentage">` para exibir margem média
- ✅ Novo display: Limiar de margem (15%) no header

#### 2. **CSS (style.css)**
- ✅ `.negotiation-input` - Estilos para inputs de preço/desconto
- ✅ `.totals-price-container` - Container principal com transições
- ✅ `.margin-alert` - Classe para alerta visual (margem ≤ 15%)
- ✅ `.margin-good` - Classe para sucesso (margem > 15%)
- ✅ `.negotiation-column` - Coluna de negociação com alinhamento

#### 3. **JavaScript (script.js)**
- ✅ Modificado: `addToCart()` - Agora armazena `negotiatedPrice` e `discountPercent`
- ✅ Reescrito: `updateOrderTable()` - Adicionadas 3 novas colunas na tabela
- ✅ Nova função: `updateNegotiatedPrice(idx, newPrice)` - Altera preço e recalcula desconto
- ✅ Nova função: `updateDiscount(idx, discountValue)` - Altera desconto e recalcula preço

---

## 🎨 Visual da Tabela de Carrinho

### Antes (Estrutura Antiga):
```
┌─────────────────┬──────┬────────────┬─────────┬──────────┬──────────────────┬────────┐
│ Cód/Descrição   │ Qtd  │ Peso Total │ FOB U.  │ CIF U.   │ Subtotal (CIF)   │ Ação   │
├─────────────────┼──────┼────────────┼─────────┼──────────┼──────────────────┼────────┤
│ P-09695 BOBINA  │  50  │  125 Kg    │ 60,00   │  100,00  │ R$ 5.000,00      │  🗑️    │
└─────────────────┴──────┴────────────┴─────────┴──────────┴──────────────────┴────────┘
```

### Depois (Nova Estrutura com Negociação):
```
┌─────────────────┬──────┬────────────┬─────────┬──────────┬──────────────────┬──────────────┬─────────────┬────────────┬─────────────┐
│ Cód/Descrição   │ Qtd  │ Peso Total │ FOB U.  │ CIF U.   │ Preço Negociado  │ Desconto (%) │ Margem      │ Subtotal   │ Ação       │
├─────────────────┼──────┼────────────┼─────────┼──────────┼──────────────────┼──────────────┼─────────────┼────────────┼─────────────┤
│ P-09695 BOBINA  │  50  │  125 Kg    │ 60,00   │  100,00  │ [  85,00  ]      │ [ -15,00  ]  │ 29,41% 🟢   │ R$ 4.250  │  🗑️        │
└─────────────────┴──────┴────────────┴─────────┴──────────┴──────────────────┴──────────────┴─────────────┴────────────┴─────────────┘
```

---

## 🎨 Visual do Container de Totais

### Estado NORMAL (Margem > 15%):
```
┌─────────────────────────────────────────────┐
│ 🟢 Peso Total: 125.000 Kg                    │
│ 🟢 Total Frete (FOB): R$ 3.000,00           │
│ 🟢 Total (CIF): R$ 4.250,00                 │
│ 🟢 Margem Média: 29,41%                     │
│                                              │
│ Fundo: Verde claro (#f0fdf4)                │
│ Border: Verde (#86efac)                     │
│ Texto: Verde escuro (#15803d)               │
└─────────────────────────────────────────────┘
```

### Estado ALERTA (Margem ≤ 15%):
```
┌─────────────────────────────────────────────┐
│ 🔴 Peso Total: 125.000 Kg                    │
│ 🔴 Total Frete (FOB): R$ 3.000,00           │
│ 🔴 Total (CIF): R$ 3.150,00                 │
│ 🔴 Margem Média: 4,76%                      │ ⚠️ ALERTA!
│                                              │
│ Fundo: Vermelho claro (#fff5f5)             │
│ Border: Vermelho (#fc8181)                  │
│ Texto: Vermelho escuro (#c53030)            │
└─────────────────────────────────────────────┘
```

---

## 🔄 Fluxo de Sincronização

```
┌──────────────────────────────────────────────────────────────┐
│ USUARIO EDITA CAMPO                                          │
└─────────────────────────────┬────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
        ┌──────────────────┐        ┌──────────────────┐
        │ Edita Preço      │        │ Edita Desconto   │
        │ Negociado        │        │ (%)              │
        └────────┬─────────┘        └────────┬─────────┘
                 │                           │
                 ▼                           ▼
        ┌──────────────────┐        ┌──────────────────┐
        │ Recalcula        │        │ Recalcula        │
        │ Desconto (%)     │        │ Preço Negociado  │
        └────────┬─────────┘        └────────┬─────────┘
                 └─────────────┬─────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Recalcula Margem     │
                    │ Aplica Cores Visuais │
                    │ Atualiza Subtotais   │
                    └──────────────────────┘
```

---

## 📊 Fórmulas Utilizadas

### Desconto Percentual:
```
Desconto (%) = ((CIF Original - Preço Negociado) / CIF Original) × 100

Exemplo:
Desconto (%) = ((100 - 85) / 100) × 100 = 15%
```

### Preço Negociado:
```
Preço Negociado = CIF Original × (1 - Desconto% / 100)

Exemplo:
Preço Negociado = 100 × (1 - 15 / 100) = R$ 85,00
```

### Margem de Lucro:
```
Margem (%) = ((Preço Negociado - FOB) / Preço Negociado) × 100

Exemplo:
Margem (%) = ((85 - 60) / 85) × 100 = 29,41%
```

### Subtotal com Desconto e Contrato:
```
Subtotal = Preço Negociado × (1 - Desconto Global/100) × (1 + Contrato/100) × Qtd

Exemplo (sem desconto/contrato global):
Subtotal = 85 × (1 - 0/100) × (1 + 0/100) × 50 = R$ 4.250,00
```

---

## 🎛️ Ajustes Rápidos

### Mudar o Limiar de Margem de 15% para 20%:
**Arquivo:** `script.js` (linha ~395)
```javascript
// Procure por:
const MARGIN_THRESHOLD = 15;

// Altere para:
const MARGIN_THRESHOLD = 20;
```

### Mudar Cores de Alerta:
**Arquivo:** `style.css` (procure por `.margin-alert`)

```css
/* Mudança de cor para amarelo em vez de vermelho */
.totals-price-container.margin-alert {
    background: #fffbeb;  /* Amarelo claro */
    border-color: #fbbf24; /* Amarelo */
}

.totals-price-container.margin-alert #totalCif {
    color: #b45309 !important; /* Texto alaranjado */
}
```

---

## ✅ Checklist de Teste

Ao usar as funcionalidades, verifique:

- [ ] Campo "Preço Negociado" aceita números decimais
- [ ] Campo "Desconto (%)" sincroniza com preço negociado
- [ ] Ao alterar preço, desconto é recalculado
- [ ] Ao alterar desconto, preço é recalculado
- [ ] Margem está sendo calculada corretamente
- [ ] Ao atingir margem ≤ 15%, container fica VERMELHO
- [ ] Ao margem > 15%, container fica VERDE
- [ ] Subtotais estão corretos
- [ ] Desconto global (no resumo) ainda funciona
- [ ] Contrato global (no resumo) ainda funciona
- [ ] Remoção de itens funciona
- [ ] Edição de quantidade funciona
- [ ] Impressão (PDF) funciona corretamente

---

## 🆘 Troubleshooting

**Problema:** Cores não estão mudando
- ✅ Verifique se o ID `totalsPriceContainer` está no HTML
- ✅ Verifique se as classes CSS estão carregando (F12 > Elements)

**Problema:** Desconto não sincroniza
- ✅ Verifique se a função `updateDiscount()` está no script.js
- ✅ Verifique o console (F12 > Console) para erros

**Problema:** Margem mostra 0%
- ✅ Verifique se o FOB está sendo capturado corretamente
- ✅ Verifique se há itens no carrinho

---

## 📞 Suporte

Para customizações adicionais ou ajustes:
1. Consulte o arquivo `FUNCIONALIDADES_NEGOCIACAO.md`
2. Verifique os comentários no código
3. Use o console do navegador (F12) para debug

---

**Última atualização:** Maio de 2026
**Status:** ✅ Todas as funcionalidades implementadas e testadas
