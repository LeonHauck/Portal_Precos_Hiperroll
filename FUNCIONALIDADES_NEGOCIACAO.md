# 📋 Funcionalidades de Negociação - Portal de Preços Hiperroll

## ✅ Implementações Realizadas

Foram adicionadas 3 novas funcionalidades principais ao sistema de precificação, integradas perfeitamente na tabela de resumo do pedido:

---

## 1️⃣ Campo "Preço Negociado"

### O que é?
Um input numérico que permite ao vendedor alterar o preço unitário do produto durante a negociação, sem alterar os dados originais do produto.

### Funcionalidades:
- **Input Editável**: Cada linha do carrinho tem um campo "Preço Negociado" (coluna 6)
- **Sincronização Automática**: Quando você altera o preço negociado, o "Desconto (%)" é automaticamente recalculado
- **Cálculo Baseado**: O novo preço é usado para calcular a margem e o subtotal da linha
- **Valor Inicial**: Começa igual ao "CIF Unit." (preço original)

### Como usar:
1. Adicione um produto ao carrinho
2. Na tabela do resumo, localize a coluna "Preço Negociado"
3. Clique no campo e insira o novo preço unitário
4. Pressione Enter ou clique fora do campo
5. O sistema recalculará automaticamente o desconto e margem

### Exemplo:
```
CIF Unit: R$ 100,00
Preço Negociado: R$ 85,00
Desconto calculado: 15%
```

---

## 2️⃣ Campo "Desconto (%)"

### O que é?
Um campo que exibe e permite editar o desconto percentual aplicado sobre o preço base, mantendo sincronização bidirecional com o "Preço Negociado".

### Funcionalidades:
- **Sincronização Bidirecional**: 
  - Se você altera o Preço Negociado → Desconto (%) é recalculado automaticamente
  - Se você altera o Desconto (%) → Preço Negociado é recalculado automaticamente
- **Fórmulas Utilizadas**:
  - `Desconto (%) = ((CIF Original - Preço Negociado) / CIF Original) × 100`
  - `Preço Negociado = CIF Original × (1 - Desconto / 100)`
- **Intervalo**: Aceita valores de -100% a +100% (permite sobrepreços)

### Como usar:
1. Na tabela do resumo, localize a coluna "Desconto (%)"
2. Clique no campo e insira o desconto desejado
3. Pressione Enter ou clique fora do campo
4. O "Preço Negociado" será automaticamente recalculado
5. A margem será atualizada em tempo real

### Exemplo:
```
CIF Original: R$ 100,00
Desconto inserido: -10% (sobrepreço)
Preço Negociado será: R$ 110,00
```

---

## 3️⃣ Alerta Visual de Margem Ruim

### O que é?
Um sistema visual que muda a cor do container "Valor Total do Pedido" quando a margem média do pedido está abaixo do limiar (atualmente 15%).

### Funcionalidades:
- **Cálculo da Margem**: `Margem (%) = ((Preço Negociado - FOB) / Preço Negociado) × 100`
- **Avaliação em Tempo Real**: Recalcula a cada mudança
- **Indicadores Visuais**:
  - 🔴 **Margem ≤ 15%**: Fundo vermelho claro (#fff5f5) + texto vermelho escuro (#c53030)
  - 🟢 **Margem > 15%**: Fundo verde claro (#f0fdf4) + texto verde escuro (#15803d)

### Componentes Afetados:
- Container "Valor Total do Pedido" muda de cor
- Campo "Total (CIF)" muda de cor
- Percentual de margem é exibido em tempo real

### Cores Aplicadas:

| Estado | Cor Fundo | Cor Texto | Border |
|--------|-----------|-----------|--------|
| Margem ≤ 15% (ALERTA) | `#fff5f5` (vermelho claro) | `#c53030` (vermelho escuro) | `#fc8181` |
| Margem > 15% (BOM) | `#f0fdf4` (verde claro) | `#15803d` (verde escuro) | `#86efac` |

### Ajustes do Limiar (15%):
Se desejar alterar o limiar de 15% para outro valor:

**No arquivo `script.js`, localize na função `updateOrderTable()`:**
```javascript
const MARGIN_THRESHOLD = 15; // Altere este valor
```

---

## 📊 Estrutura de Dados do Carrinho

Cada item do carrinho agora armazena:

```javascript
{
    codigo: "P-09695",
    descricao: "BOBINA PIC",
    fob: 50.00,           // Custo original (FOB)
    cif: 65.00,           // Preço original (CIF)
    negotiatedPrice: 55.00, // Preço negociado (pode variar)
    weight: 2.5,          // Peso unitário
    qty: 100,             // Quantidade
    discountPercent: 15.38 // Desconto percentual calculado
}
```

---

## 🔄 Fluxo de Cálculo em Tempo Real

```
Usuário altera Preço Negociado
         ↓
Sistema recalcula Desconto (%)
         ↓
Sistema recalcula Margem por item
         ↓
Sistema calcula Margem Média
         ↓
Sistema aplica classe visual (margin-alert / margin-good)
         ↓
Subtotal é recalculado com Desconto e Contrato globais
         ↓
Totais são atualizados
```

---

## 🎨 Classes CSS Disponíveis

Para personalizar ainda mais, você pode usar as seguintes classes:

```css
.negotiation-input        /* Estilo dos inputs de Preço e Desconto */
.negotiation-column       /* Coluna de negociação na tabela */
.totals-price-container   /* Container principal de totais */
.totals-price-container.margin-alert  /* Estado de alerta (margem ruim) */
.totals-price-container.margin-good   /* Estado bom (margem OK) */
```

---

## 📝 Exemplo Prático Completo

### Cenário: Negociação de uma BOBINA PIC

**Dados Originais:**
- Código: P-09695
- CIF Unit: R$ 100,00
- FOB Unit: R$ 60,00
- Margem Original: 40%

**Ações do Vendedor:**
1. Adiciona 50 unidades ao carrinho
2. Durante negociação, cliente solicita desconto
3. Vendedor altera "Preço Negociado" para R$ 85,00
4. Sistema recalcula automaticamente:
   - Desconto (%): -15.00%
   - Margem: 29.41%
   - Subtotal: R$ 4.250,00
5. Container de totais continua **VERDE** (margem > 15%)

**Se vendedor reduzir ainda mais:**
1. Altera "Preço Negociado" para R$ 63,00
2. Sistema recalcula:
   - Desconto (%): -37.00%
   - Margem: 4.76%
   - Subtotal: R$ 3.150,00
3. Container de totais fica **VERMELHO** (margem ≤ 15%)
4. ⚠️ Alerta visual indica margem ruim!

---

## 🔧 Customizações Possíveis

### 1. Alterar o Limiar de Margem
No arquivo `script.js`, função `updateOrderTable()`:
```javascript
const MARGIN_THRESHOLD = 20; // Mude de 15% para 20%
```

### 2. Alterar Cores de Alerta
No arquivo `style.css`, procure por `.margin-alert` e `.margin-good`:
```css
.totals-price-container.margin-alert {
    background: #ffebee; /* Rosa claro */
    border-color: #ef5350; /* Vermelho */
}
```

### 3. Adicionar Sons ou Animações
Na função `updateOrderTable()`, após a linha que adiciona a classe:
```javascript
if (marginMediana <= MARGIN_THRESHOLD) {
    // Adicionar efeito de pulse CSS ou som aqui
}
```

---

## 🚀 Requisitos Técnicos

- **Navegadores Suportados**: Chrome, Firefox, Safari, Edge (todos com suporte a ES6)
- **Dependências**: Nenhuma! Usa JavaScript Vanilla puro
- **Compatibilidade**: Funciona em desktop e tablets

---

## 📌 Notas Importantes

1. **Desconto Global vs Desconto por Item**: 
   - O "Desconto (%)" na coluna é **por item**
   - O "Desconto (%)" no resumo é **global**
   - Ambos são aplicados multiplicativamente

2. **Fórmula Final do Subtotal**:
   ```
   Subtotal = Preço Negociado × (1 - Desconto Global/100) × (1 + Contrato/100) × Qtd
   ```

3. **Margem Usada para Alerta**:
   - A margem considera o **Preço Negociado** (não o desconto global)
   - Fórmula: `(Preço Negociado - FOB) / Preço Negociado`

4. **Perseverança de Dados**:
   - Os dados são mantidos na memória (array `cart`)
   - Se a página for recarregada, o carrinho será limpo
   - Para persistência, considere adicionar localStorage

---

## ✨ Conclusão

Todas as 3 funcionalidades estão totalmente integradas e funcionando em tempo real. O sistema oferece feedback visual imediato, facilitando decisões de negociação rápidas e precisas!

Para suporte ou ajustes adicionais, considere os pontos de customização acima. 🎯
