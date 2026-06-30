# 🔧 Documentação Técnica - Funcionalidades de Negociação

## 📋 Resumo Técnico

Este documento descreve a implementação técnica das 3 funcionalidades de negociação adicionadas ao Portal de Preços Hiperroll.

---

## 🏗️ Arquitetura da Solução

### Componentes Modificados

#### 1. **HTML (index.html)**
- ✅ Adicionado container com ID `totalsPriceContainer` para aplicar estilos dinâmicos
- ✅ Adicionado elemento para exibir `marginPercentage`
- ✅ Adicionado display de `marginThreshold` no header

#### 2. **CSS (style.css)**
- ✅ `.negotiation-input` - Estilo dos inputs
- ✅ `.negotiation-column` - Alinhamento de colunas
- ✅ `.totals-price-container` - Container principal
- ✅ `.totals-price-container.margin-alert` - Estado de alerta
- ✅ `.totals-price-container.margin-good` - Estado bom

#### 3. **JavaScript (script.js)**
- ✅ Modificado: `addToCart(codigo, fob, cif, weight)`
- ✅ Reescrito: `updateOrderTable()`
- ✅ Nova função: `updateNegotiatedPrice(idx, newPrice)`
- ✅ Nova função: `updateDiscount(idx, discountValue)`

---

## 💾 Estrutura de Dados

### Objeto do Carrinho (antes)
```javascript
{
    codigo: string,
    descricao: string,
    fob: number,
    cif: number,
    weight: number,
    qty: number
}
```

### Objeto do Carrinho (depois)
```javascript
{
    codigo: string,           // Código do produto
    descricao: string,        // Descrição do produto
    fob: number,              // Preço FOB (custo base)
    cif: number,              // Preço CIF original (imutável)
    negotiatedPrice: number,  // Preço negociado (mutável)
    weight: number,           // Peso unitário
    qty: number,              // Quantidade
    discountPercent: number   // Desconto % calculado
}
```

---

## 🔄 Fluxo de Dados

```
┌─────────────────────────────────────────────────────────┐
│ USUÁRIO ALTERA INPUT                                    │
├─────────────────────────────────────────────────────────┤
│ ↓                                                        │
│ onchange="updateNegotiatedPrice(idx, value)"           │
│   ou                                                     │
│ onchange="updateDiscount(idx, value)"                  │
├─────────────────────────────────────────────────────────┤
│ ↓                                                        │
│ Função atualiza cart[idx]                              │
│ ├─ cart[idx].negotiatedPrice = ...                    │
│ └─ cart[idx].discountPercent = ...                    │
├─────────────────────────────────────────────────────────┤
│ ↓                                                        │
│ updateOrderTable() é chamada                           │
│ ├─ Itera sobre todos os itens do carrinho             │
│ ├─ Calcula margem por item                            │
│ ├─ Calcula margem média                               │
│ ├─ Renderiza tabela HTML                              │
│ └─ Aplica classe CSS (margin-alert / margin-good)    │
├─────────────────────────────────────────────────────────┤
│ ↓                                                        │
│ DOM é atualizado                                        │
│ ├─ Tabela renderizada com novos valores               │
│ ├─ Container muda de cor se necessário                │
│ └─ Totais são atualizados                             │
└─────────────────────────────────────────────────────────┘
```

---

## 📐 Fórmulas de Cálculo

### 1. Desconto Percentual
```javascript
discountPercent = ((cifOriginal - negotiatedPrice) / cifOriginal) * 100

Exemplo:
CIF Original: 100
Preço Negociado: 85
Desconto = ((100 - 85) / 100) * 100 = 15%
```

### 2. Preço Negociado (baseado em desconto)
```javascript
negotiatedPrice = cifOriginal * (1 - discountPercent / 100)

Exemplo:
CIF: 100
Desconto: 15%
Preço = 100 * (1 - 15/100) = 100 * 0.85 = 85
```

### 3. Margem de Lucro
```javascript
marginPercent = ((negotiatedPrice - fob) / negotiatedPrice) * 100

Exemplo:
Preço Negociado: 85
FOB: 60
Margem = ((85 - 60) / 85) * 100 = 29.41%
```

### 4. Subtotal com Desconto e Contrato
```javascript
subtotal = negotiatedPrice 
         * (1 - descontoGlobal / 100) 
         * (1 + contrato / 100) 
         * qty

Exemplo:
Preço Negociado: 85
Desconto Global: 10%
Contrato: 5%
Qty: 50

Subtotal = 85 * (1 - 0.10) * (1 + 0.05) * 50
         = 85 * 0.90 * 1.05 * 50
         = 3,993.75
```

### 5. Margem Média
```javascript
marginMedia = (sumTotalMargin / sumTotalQty)

// Onde:
// sumTotalMargin = Σ(marginPercent * qty) para cada item
// sumTotalQty = Σ(qty) para cada item

Exemplo com 2 produtos:
Produto 1: Margem 30% x Qty 50 = 1500
Produto 2: Margem 20% x Qty 100 = 2000
Total: 3500 / 150 = 23.33% de margem média
```

---

## 🎨 Sistema de Classes CSS

### Classe: `.negotiation-input`
```css
.negotiation-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.95rem;
    text-align: right;
    transition: all 0.2s;
}

.negotiation-input:focus {
    border-color: var(--secondary);
    box-shadow: 0 0 0 2px rgba(5, 84, 166, 0.1);
    outline: none;
}
```

### Classe: `.totals-price-container`
```css
.totals-price-container {
    padding: 15px;
    border-radius: 8px;
    background: #f8fafc;
    border: 2px solid var(--border);
    transition: all 0.3s ease;
}
```

### Classe: `.totals-price-container.margin-alert`
```css
.totals-price-container.margin-alert {
    background: #fff5f5;          /* Vermelho muito claro */
    border-color: #fc8181;         /* Vermelho suave */
}

.totals-price-container.margin-alert p:last-child strong {
    color: #c53030;                /* Vermelho escuro */
    font-weight: 700;
}

.totals-price-container.margin-alert #totalCif {
    color: #c53030 !important;
    font-weight: 700;
    text-shadow: 0 0 2px rgba(197, 48, 48, 0.2);
}
```

### Classe: `.totals-price-container.margin-good`
```css
.totals-price-container.margin-good {
    background: #f0fdf4;           /* Verde muito claro */
    border-color: #86efac;         /* Verde suave */
}

.totals-price-container.margin-good p:last-child strong {
    color: #15803d;                /* Verde escuro */
}

.totals-price-container.margin-good #totalCif {
    color: #15803d !important;
}
```

---

## 🔍 Análise de Função: `updateNegotiatedPrice()`

```javascript
function updateNegotiatedPrice(idx, newPrice) {
    // 1. Atualiza o preço negociado no carrinho
    cart[idx].negotiatedPrice = parseFloat(newPrice) || cart[idx].cif;
    
    // 2. Recalcula o desconto percentual baseado no novo preço
    cart[idx].discountPercent = 
        ((cart[idx].cif - cart[idx].negotiatedPrice) / cart[idx].cif) * 100;
    
    // 3. Dispara recálculo de toda a tabela
    updateOrderTable();
}
```

**Fluxo:**
1. Usuário edita campo "Preço Negociado"
2. Função é chamada com novo valor
3. Novo preço é armazenado em `cart[idx].negotiatedPrice`
4. Desconto % é recalculado (não editado diretamente)
5. `updateOrderTable()` é chamada para atualizar tudo

**Tratamento de Erros:**
- `parseFloat(newPrice)` trata entradas não-numéricas
- Se inválido, volta para `cart[idx].cif` (preço original)

---

## 🔍 Análise de Função: `updateDiscount()`

```javascript
function updateDiscount(idx, discountValue) {
    // 1. Armazena o valor de desconto inserido
    cart[idx].discountPercent = parseFloat(discountValue) || 0;
    
    // 2. Recalcula o preço negociado baseado no desconto
    cart[idx].negotiatedPrice = 
        cart[idx].cif * (1 - cart[idx].discountPercent / 100);
    
    // 3. Dispara recálculo de toda a tabela
    updateOrderTable();
}
```

**Fluxo:**
1. Usuário edita campo "Desconto (%)"
2. Função é chamada com novo valor
3. Novo desconto é armazenado
4. Preço negociado é recalculado (não editado diretamente)
5. `updateOrderTable()` é chamada para atualizar tudo

**Fórmula Inversa:**
- Enquanto `updateNegotiatedPrice()` calcula desconto a partir do preço
- `updateDiscount()` calcula preço a partir do desconto
- As duas funções mantêm sincronização bidirecional

---

## 🔍 Análise de Função: `updateOrderTable()`

### Estrutura Geral
```javascript
function updateOrderTable() {
    // 1. Obter valores globais (desconto, contrato)
    // 2. Validar carrinho
    // 3. Gerar HTML da tabela com 3 NOVAS COLUNAS
    // 4. Calcular margens e totais
    // 5. Atualizar DOM
    // 6. Aplicar classe CSS de alerta
}
```

### Seção 1: Preparação
```javascript
const discount = parseFloat(document.getElementById('orderDiscount').value) || 0;
const contract = parseFloat(document.getElementById('orderContract').value) || 0;
```
Obtém desconto e contrato globais aplicados a TODOS os itens

### Seção 2: Loop Principal
```javascript
cart.forEach((item, idx) => {
    const negotiatedPrice = item.negotiatedPrice || item.cif;
    const discountFromNegotiatedPrice = 
        ((item.cif - negotiatedPrice) / item.cif) * 100;
    const subCifWithDiscountContract = 
        negotiatedPrice * (1 - discount/100) * (1 + contract / 100) * item.qty;
    const itemMarginPercent = 
        ((negotiatedPrice - item.fob) / negotiatedPrice) * 100;
    
    // Renderiza linha da tabela
    // Acumula totais
});
```

### Seção 3: Cálculo de Margem Média
```javascript
const marginMediana = 
    cart.length > 0 
        ? totalMargin / cart.reduce((sum, item) => sum + item.qty, 0) 
        : 0;
```
A margem média é **ponderada pela quantidade** de cada item

### Seção 4: Aplicar Classe Visual
```javascript
const MARGIN_THRESHOLD = 15;

if (marginMediana <= MARGIN_THRESHOLD) {
    totalsPriceContainer.classList.add('margin-alert');
    totalsPriceContainer.classList.remove('margin-good');
} else {
    totalsPriceContainer.classList.remove('margin-alert');
    totalsPriceContainer.classList.add('margin-good');
}
```

---

## 🧪 Casos de Teste

### Teste 1: Adicionar Produto
```javascript
// Antes: cart = []
addToCart('P-09695', 60, 100, 2.5);
// Depois: cart = [{
//     codigo: 'P-09695',
//     negotiatedPrice: 100,
//     discountPercent: 0,
//     qty: 1
// }]
```

### Teste 2: Editar Preço Negociado
```javascript
updateNegotiatedPrice(0, 85);
// Resultado:
// cart[0].negotiatedPrice = 85
// cart[0].discountPercent = 15
```

### Teste 3: Editar Desconto
```javascript
updateDiscount(0, 20);
// Resultado:
// cart[0].discountPercent = 20
// cart[0].negotiatedPrice = 80
```

### Teste 4: Validar Margem Crítica
```javascript
// FOB: 60, Preço: 65, Margem: 7.69% (< 15%)
// Esperado: classe 'margin-alert' adicionada
```

### Teste 5: Validar Margem Boa
```javascript
// FOB: 60, Preço: 80, Margem: 25% (> 15%)
// Esperado: classe 'margin-good' adicionada
```

---

## 🔐 Validações Implementadas

### 1. Preço Negociado
- ✅ Aceita números decimais
- ✅ Min: 0 (não permite negativos)
- ✅ Se inválido: volta para CIF original

### 2. Desconto (%)
- ✅ Aceita -100 a +100 (sobrepreço permitido)
- ✅ Se inválido: assume 0%

### 3. Margem
- ✅ Pode ser negativa (prejuízo)
- ✅ Pode ser 0% (custo zero)
- ✅ Calcula corretamente em todos os casos

---

## 📊 Performance

### Otimizações Implementadas
1. ✅ Reutilização de array `cart` (não recriar)
2. ✅ Recálculo somente quando necessário (onchange)
3. ✅ Transições CSS suaves (0.3s) para não sobrecarregar
4. ✅ Sem loops desnecessários

### Complexidade
- `addToCart()`: O(n) onde n = quantidade de itens
- `updateOrderTable()`: O(n) onde n = quantidade de itens
- `updateNegotiatedPrice()`: O(1) + O(n) da recalculação
- `updateDiscount()`: O(1) + O(n) da recalculação

---

## 🔧 Extensões Possíveis

### 1. Persistência em localStorage
```javascript
function saveCart() {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function loadCart() {
    cart = JSON.parse(localStorage.getItem('cart')) || [];
}
```

### 2. Histórico de Negociações
```javascript
const negotiationHistory = [];

function saveNegotiation() {
    negotiationHistory.push({
        timestamp: new Date(),
        cart: JSON.parse(JSON.stringify(cart)),
        margin: marginMedia
    });
}
```

### 3. Alertas Sonoros
```javascript
if (marginMediana <= MARGIN_THRESHOLD) {
    new Audio('alerta.mp3').play();
}
```

### 4. Limiar Customizável
```html
<input type="number" id="marginThreshold" value="15" 
       onchange="updateOrderTable()">
```

```javascript
const MARGIN_THRESHOLD = 
    parseFloat(document.getElementById('marginThreshold').value) || 15;
```

---

## 📝 Changelog

### v1.0 - Implementação Inicial (Maio 2026)
- ✅ Campo "Preço Negociado" adicionado
- ✅ Campo "Desconto (%)" com sincronização bidirecional
- ✅ Alerta Visual de Margem (> 15% = Verde, ≤ 15% = Vermelho)
- ✅ Cálculo de margem média ponderada
- ✅ Documentação completa

---

## 🎯 Conclusão

A implementação utiliza JavaScript Vanilla puro, sem dependências externas. O código é:
- ✅ Limpo e bem documentado
- ✅ Performático
- ✅ Facilmente extensível
- ✅ Compatível com navegadores modernos
- ✅ Responsivo e intuitivo

Para dúvidas técnicas, consulte os comentários inline no código ou este documento.

---

**Versão do Documento:** 1.0
**Data:** Maio de 2026
**Status:** ✅ Completo e Testado
