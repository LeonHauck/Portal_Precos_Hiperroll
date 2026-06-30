# 🎓 Guia Prático - Usando as Funcionalidades de Negociação

## 📖 Introdução

Este guia mostra passo a passo como usar as 3 novas funcionalidades implementadas no Portal de Preços Hiperroll para negociações em tempo real.

---

## 🚀 Exemplo Prático 1: Negociação Simples

### Cenário:
Você está negociando com um cliente sobre uma quantidade de BOBINA PIC. O cliente solicita um desconto.

### Passo a Passo:

#### 1️⃣ **Adicione o Produto ao Carrinho**
```
- Produto: BOBINA PIC (código P-09695)
- Preço Original (CIF): R$ 100,00
- Peso: 2,5 Kg
- Quantidade: 50 unidades
- Total: R$ 5.000,00
```

#### 2️⃣ **Primeira Oferta do Cliente: 10% de Desconto**

Na tabela do carrinho, você vê:
```
┌──────────────────────────────────────────────────────────┐
│ Linha: P-09695 BOBINA PIC                                │
├──────────────────────────────────────────────────────────┤
│ Qtd: 50 | Peso Total: 125 Kg                            │
│ FOB Unit: R$ 60,00 | CIF Unit: R$ 100,00                │
│                                                           │
│ Campo "Preço Negociado": [  100,00  ]                   │
│ Campo "Desconto (%)":     [   0,00  ]                   │
│ Margem: 40,00%  🟢 (BOM)                                │
│ Subtotal: R$ 5.000,00                                   │
└──────────────────────────────────────────────────────────┘
```

**Ação:** Clique no campo "Desconto (%)" e insira `10`

**Resultado Automático:**
```
┌──────────────────────────────────────────────────────────┐
│ Preço Negociado: [   90,00  ] ✓ (Recalculado!)        │
│ Desconto (%):     [   10,00 ] (Você inseriu)           │
│ Margem: 33,33%  🟢 (AINDA BOM)                         │
│ Subtotal: R$ 4.500,00                                   │
└──────────────────────────────────────────────────────────┘
```

**O que aconteceu:**
- Sistema recalculou o "Preço Negociado" de R$ 100,00 para R$ 90,00
- A margem mudou de 40% para 33,33% (ainda acima de 15%)
- O container de totais permanece VERDE

---

#### 3️⃣ **Segunda Oferta do Cliente: 30% de Desconto**

**Ação:** Altere o campo "Desconto (%)" para `30`

**Resultado:**
```
┌──────────────────────────────────────────────────────────┐
│ Preço Negociado: [   70,00  ] ✓ (Recalculado!)        │
│ Desconto (%):     [   30,00 ]                          │
│ Margem: 16,67%  🟢 (LIMITE SEGURO)                     │
│ Subtotal: R$ 3.500,00                                   │
└──────────────────────────────────────────────────────────┘
```

**Status:** Margem ainda está acima de 15%, mas está baixando

---

#### 4️⃣ **Terceira Oferta: 40% de Desconto**

**Ação:** Altere para `40` no campo "Desconto (%)"

**Resultado:**
```
┌──────────────────────────────────────────────────────────┐
│ Preço Negociado: [   60,00  ] ✓ (Recalculado!)        │
│ Desconto (%):     [   40,00 ]                          │
│ Margem: 0,00%    ⚠️  (MARGEM ZERO!)                    │
│ Subtotal: R$ 3.000,00                                   │
│                                                           │
│ ALERTA: O preço negociado (R$ 60) = FOB (R$ 60)        │
│ Sem margem de lucro!                                     │
└──────────────────────────────────────────────────────────┘
```

**O container agora está VERMELHO!** 🔴

---

#### 5️⃣ **Contraoferta: 35% de Desconto**

**Ação:** Altere para `35` no campo "Desconto (%)"

**Resultado:**
```
┌──────────────────────────────────────────────────────────┐
│ Preço Negociado: [   65,00  ] ✓ (Recalculado!)        │
│ Desconto (%):     [   35,00 ]                          │
│ Margem: 8,33%    🔴 (CRÍTICO - ABAIXO DE 15%)         │
│ Subtotal: R$ 3.250,00                                   │
│                                                           │
│ AVISO: Margem abaixo do limiar de 15%!                 │
│        Considere revisar a proposta.                     │
└──────────────────────────────────────────────────────────┘
```

**Container permanece VERMELHO** 🔴

**Decisão Comercial:**
- ❌ 35% é arriscado (margem muito baixa)
- ✅ 30% seria aceitável (16,67% de margem)
- ✅ 25% seria confortável (25% de margem)

---

## 🎯 Exemplo Prático 2: Editando Preço Negociado Diretamente

### Cenário:
Em vez de usar desconto percentual, você quer inserir o preço final que o cliente aceitou.

#### 1️⃣ **Situação Inicial**
```
CIF Unit: R$ 100,00
Cliente quer pagar: R$ 75,00
```

#### 2️⃣ **Ação:** Clique diretamente no campo "Preço Negociado" e insira `75`

**Resultado Automático:**
```
┌──────────────────────────────────────────────────────────┐
│ Preço Negociado: [   75,00  ] (Você inseriu)          │
│ Desconto (%):     [  -25,00 ] ✓ (Recalculado!)       │
│ Margem: 25,00%   🟢 (BOM)                             │
│ Subtotal: R$ 3.750,00                                   │
└──────────────────────────────────────────────────────────┘
```

**O que aconteceu:**
- Sistema detectou que R$ 75,00 significa 25% de desconto
- Desconto foi recalculado automaticamente
- Margem e subtotal foram atualizados

---

## 📊 Exemplo Prático 3: Múltiplos Itens com Margens Diferentes

### Cenário:
Você negocia um pedido com 3 produtos. Cada um tem margem diferente.

#### Situação:
```
┌─────────────────────────────────────────────────────────────────┐
│ PRODUTO 1: BOBINA PIC                                           │
│ Preço Negociado: R$ 85,00 | Margem: 29,41% 🟢                  │
├─────────────────────────────────────────────────────────────────┤
│ PRODUTO 2: SACOLA VERDE                                         │
│ Preço Negociado: R$ 18,00 | Margem: 2,38% 🔴                   │
├─────────────────────────────────────────────────────────────────┤
│ PRODUTO 3: FUNDO RETO                                           │
│ Preço Negociado: R$ 22,00 | Margem: 32,86% 🟢                  │
├─────────────────────────────────────────────────────────────────┤
│ TOTAL: R$ 11.500,00                                             │
│ MARGEM MÉDIA: 15,88%  🟢 (DENTRO DO LIMITE)                    │
│ Container de Totais: VERDE                                      │
└─────────────────────────────────────────────────────────────────┘
```

**Análise:**
- Produto 2 tem margem muito baixa (2,38%)
- Mas a margem média (15,88%) mantém o pedido viável
- Você pode considerar aumentar o preço do Produto 2 ou remover da negociação

---

## ⚡ Dicas Rápidas de Negociação

### 1️⃣ **Verificar Viabilidade Rápida**
```
ANTES DE ACEITAR UMA PROPOSTA:
1. Veja o campo "Desconto (%)"
2. Verifique a cor do container de totais
3. Se for VERDE → Aceitável
4. Se for VERMELHO → Revisar com gerência
```

### 2️⃣ **Encontrar o Ponto de Equilíbrio**
```
PARA NEGOCIAR MELHOR:
- Use o campo "Preço Negociado" para testar valores
- Procure o preço máximo que mantém margem > 15%
- Apresente isso como sua melhor oferta
```

### 3️⃣ **Documentar a Negociação**
```
ANTES DE IMPRIMIR:
1. Ajuste todos os preços negociados
2. Insira o Desconto e Contrato globais (se houver)
3. Verifique que o container está na cor esperada
4. Clique em "Exportar Pedido (PDF)"
5. Compartilhe com o cliente ou arquivo interno
```

---

## 🎨 Entendendo as Cores

### 🟢 Verde (Margem Boa)
```
Quando você vê: VERDE
Significa: Margem > 15%
Ação: ✅ Seguro aceitar
Exemplos de margem: 20%, 30%, 40%+
```

### 🔴 Vermelho (Margem Ruim)
```
Quando você vê: VERMELHO
Significa: Margem ≤ 15%
Ação: ⚠️ Revisar com gerência
Exemplos de margem: 5%, 10%, 15%
```

---

## 🔢 Tabelas de Referência Rápida

### Desconto vs Preço (CIF Original: R$ 100)

| Desconto (%) | Preço Negociado | Margem (FOB R$60) | Status |
|--------------|-----------------|-------------------|--------|
| 0% | R$ 100,00 | 40,00% | 🟢 Excelente |
| 10% | R$ 90,00 | 33,33% | 🟢 Bom |
| 20% | R$ 80,00 | 25,00% | 🟢 Bom |
| 30% | R$ 70,00 | 14,29% | 🔴 Crítico |
| 40% | R$ 60,00 | 0,00% | 🔴 Zero |
| 50% | R$ 50,00 | -20,00% | 🔴 Prejuízo |

### Preço Final vs Margem

| Preço Final | vs FOB R$60 | Margem | Status |
|------------|-----------|--------|--------|
| R$ 75,00 | +R$ 15,00 | 20,00% | 🟢 OK |
| R$ 70,00 | +R$ 10,00 | 14,29% | 🔴 Limite |
| R$ 67,50 | +R$ 7,50 | 11,11% | 🔴 Ruim |
| R$ 65,00 | +R$ 5,00 | 7,69% | 🔴 Muito ruim |

---

## 🛑 Casos de Uso Especiais

### Caso 1: Sobrepreço (Negociação Melhor que o Original)

**Situação:** Cliente aceita pagar MAIS que o preço original

**Ação:** Insira valor maior no "Preço Negociado"
```
CIF Original: R$ 100,00
Preço Negociado: R$ 110,00
Desconto: -10,00% (na verdade é um acréscimo!)
Margem: 45,45%  🟢🟢🟢
```

### Caso 2: Múltiplos Descontos

**Situação:** Já há desconto percentual geral + desconto por item

**Fórmula aplicada:**
```
Subtotal = Preço Negociado × (1 - Desconto Global/100) × Qtd

Exemplo:
Preço Negociado: R$ 85,00
Desconto Global: 10%
Qtd: 50

Subtotal = 85 × (1 - 10/100) × 50 = R$ 3.825,00
```

### Caso 3: Ajuste de Quantidade em Tempo Real

**Situação:** Durante negociação, aumenta a quantidade

**Ação:** Altere o campo "Qtd" na tabela
- Margem por item **NÃO MUDA** (depende do preço)
- Subtotal **MUDA** proporcionalmente
- Totais são recalculados

---

## 📋 Checklist para Cada Negociação

- [ ] Produto adicionado ao carrinho
- [ ] Quantidade correta
- [ ] Preço negociado inserido
- [ ] Desconto (%) verificado
- [ ] Margem por item está clara
- [ ] Margem média foi verificada
- [ ] Cor do container confere
- [ ] Desconto global ajustado (se necessário)
- [ ] Contrato ajustado (se necessário)
- [ ] Totais conferem
- [ ] Pedido exportado/impresso

---

## 🎯 Conclusão

Agora você tem 3 ferramentas poderosas para negociações rápidas e precisas:

1. **Preço Negociado** → Ajusta o preço do produto
2. **Desconto (%)** → Sincroniza automaticamente
3. **Alerta Visual** → Avisa quando margem está perigosa

Use-as juntas para negociar com confiança! 💪

---

**Dicas Finais:**
- 🎯 Sempre consulte a cor do container antes de aceitar
- 📊 Compare com a tabela de referência quando duvidoso
- 🖨️ Imprima o PDF como comprovante da negociação
- 💾 Considere salvar localmente os dados (sugestão futura)

Sucesso nas negociações! 🚀
