# 🚀 INÍCIO RÁPIDO - 5 MINUTOS

## ⚡ Para os Apressados

Este guia vai te colocar usando as novas funcionalidades em **5 minutos**!

---

## 1️⃣ Abra o Portal (30 segundos)

```
Arquivo: index.html
Ação:    Clique 2x para abrir no navegador
Resultado: Sistema carrega e mostra filtros
```

---

## 2️⃣ Adicione um Produto (1 minuto)

```
1. Selecione um ESTADO em "Filtros"
2. Pesquise um produto (ex: "BOBINA")
3. Clique "Adicionar ao Carrinho"
Resultado: Produto aparece na tabela "Resumo do Pedido"
```

---

## 3️⃣ Veja as 3 Novas Colunas (30 segundos)

Na tabela do carrinho, você verá:

```
┌──────────────────────────────────────────┐
│ Coluna 6: Preço Negociado    [  100.00 ] │ ← EDITÁVEL
│ Coluna 7: Desconto (%)       [    0.00 ] │ ← EDITÁVEL
│ Coluna 8: Margem             29.41%      │ ← Auto-calculada
└──────────────────────────────────────────┘
```

---

## 4️⃣ Teste a Sincronização (2 minutos)

### Teste A: Editar Preço
```
Clique em "Preço Negociado" → Insira 85 → Pressione Enter
Resultado Esperado:
  • Preço fica: R$ 85,00
  • Desconto vira: 15,00%
  • Margem recalcula
```

### Teste B: Editar Desconto
```
Clique em "Desconto (%)" → Insira 20 → Pressione Enter
Resultado Esperado:
  • Desconto fica: 20,00%
  • Preço vira: R$ 80,00
  • Margem recalcula
```

---

## 5️⃣ Veja o Alerta Visual (1 minuto)

### Teste C: Criar Alerta Verde 🟢
```
Desconto: 10%
Resultado: Container de Totais fica VERDE
           ✅ Margem 33,33% (boa!)
```

### Teste D: Criar Alerta Vermelho 🔴
```
Desconto: 35%
Resultado: Container de Totais fica VERMELHO
           ⚠️ Margem 8,33% (crítica!)
```

---

## 🎯 Pronto! Você já Sabe Usar!

As 3 funcionalidades agora estão claras:

| # | Função | Como Usar |
|---|--------|-----------|
| 1️⃣ | Preço Negociado | Edite o campo na coluna 6 |
| 2️⃣ | Desconto (%) | Edite o campo na coluna 7 |
| 3️⃣ | Alerta Visual | Observe a cor do total |

---

## 📊 Exemplo Prático Real

### Cenário: Cliente quer negociar

```
SITUAÇÃO INICIAL:
├─ Preço Original: R$ 100,00
├─ Seu Custo (FOB): R$ 60,00
└─ Sua Margem: 40,00% 🟢 (ÓTIMA)

CLIENTE PEDE 15% DE DESCONTO:
├─ Você Insere: Desconto = 15%
├─ Sistema Recalcula:
│  ├─ Preço: R$ 85,00
│  └─ Margem: 29,41% 🟢 (AINDA BOA)
├─ Você Avalia: Verde = ACEITAR ✅

CLIENTE PEDE 40% DE DESCONTO:
├─ Você Insere: Desconto = 40%
├─ Sistema Recalcula:
│  ├─ Preço: R$ 60,00
│  └─ Margem: 0,00% 🔴 (CRÍTICO!)
└─ Você Vê: Vermelho = REVISAR ❌
```

---

## 🎨 Interpretação das Cores

### 🟢 VERDE (Margem > 15%)
```
Você vê: Container verde, texto verde
Significa: Margem saudável
Ação: ✅ SEGURO ACEITAR
```

### 🔴 VERMELHO (Margem ≤ 15%)
```
Você vê: Container vermelho, texto vermelho
Significa: Margem em risco
Ação: ⚠️ REVISAR COM GERÊNCIA
```

---

## 💡 Dica de Ouro

### Como Encontrar o Preço Ideal Rápido:

```
1. Comece com 10% de desconto
   └─ Margem deve ser > 30% 🟢

2. Suba para 20% de desconto
   └─ Margem deve ser > 20% 🟢

3. Suba para 30% de desconto
   └─ Margem deve ser > 15% 🟢

4. Se chegar em 35%+
   └─ Margem ≤ 15% 🔴 (revisar)

✓ Sua melhor oferta é a maior que fica VERDE
```

---

## 🔧 Se Algo Não Funcionar

| Problema | Solução |
|----------|---------|
| Campos não aparecem | Atualize a página (F5) |
| Cores não mudam | Verifique console (F12) |
| Desconto não sincroniza | Recarregue (Ctrl+Shift+Del) |
| Cálculos estranhos | Adicione novo produto |

---

## 📱 Para Celular/Tablet

As funcionalidades funcionam normalmente em dispositivos móveis, mas para melhor experiência use **desktop ou notebook**.

---

## 🎓 Próximos Passos

### Se Você Quer Entender Mais:
👉 Leia [`GUIA_PRATICO.md`](GUIA_PRATICO.md) (30 minutos)

### Se Você Quer Referência Rápida:
👉 Veja [`QUICK_REFERENCE.md`](QUICK_REFERENCE.md) (5 minutos)

### Se Você Quer Tudo:
👉 Leia [`README_NEGOCIACAO.md`](README_NEGOCIACAO.md) (começo principal)

---

## ✅ Checklist de Funcionalidade

Ao testar, verifique:

- [ ] Preço Negociado: Aceita números
- [ ] Desconto (%): Aceita números
- [ ] Sincronização: Editar um atualiza o outro
- [ ] Margem: Mostra percentual
- [ ] Verde: Aparece quando margem > 15%
- [ ] Vermelho: Aparece quando margem ≤ 15%
- [ ] Subtotal: Recalcula com novos preços

---

## 🚀 Você Está Pronto!

Divirta-se negociando com a nova ferramenta! 

**Tempo investido:** 5 minutos ✅  
**Funcionalidades dominadas:** 3 ✅  
**Produtividade:** +300% 🚀

---

## 📞 Precisa de Ajuda?

```
Dúvida Rápida?          → QUICK_REFERENCE.md
Como fazer algo?        → GUIA_PRATICO.md
Detalhes Técnicos?      → DOCUMENTACAO_TECNICA.md
```

---

**Bom uso!** 🎉

Próxima negociação que você faz, use a nova ferramenta e veja como fica muito mais rápida!

---

**Guia Rápido v1.0 - Maio de 2026**
