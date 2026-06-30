<div align="center">
  <img src="logo.png" alt="Hiperroll Logo" width="120" />
  <h1>Portal de Preços - Hiperroll</h1>
  <p><strong>Calculadora Dinâmica CIF & FOB e Simulador de Negociações</strong></p>

  <!-- Badges -->
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Status-Produção-success?style=for-the-badge" />
</div>

<br />

## 📖 Sobre o Projeto

O **Portal de Preços Hiperroll** é uma aplicação web avançada desenvolvida exclusivamente para a equipe comercial e supervisores da Hiperroll. Seu principal objetivo é facilitar a precificação, simulação de vendas e cálculo preciso de margens de lucro no formato **CIF** (Cost, Insurance and Freight) e **FOB** (Free On Board).

O sistema processa milhares de regras de fretes por UF, Tipo de Cidade (Capital, Interior, Fluvial) e Faixas de Peso, cruzando esses dados com o custo base do produto para fornecer aos vendedores uma plataforma de negociação inteligente e em tempo real.

---

## ✨ Principais Funcionalidades

- **🧮 Calculadora de Fretes Inteligente:** Calcula automaticamente o custo de envio cruzando a Região (UF), o Perfil Logístico (Capital, Interior, Fluvial) e o Peso (Kg).
- **💼 Módulo de Negociação Avançado:**
  - Inserção de **Preço Negociado** com atualização em tempo real.
  - Sincronização bidirecional entre o **Desconto (%)** e o Valor Final.
- **🚨 Alertas de Margem (Feedback Visual):**
  - Mostra a Margem de Lucro (% e R$) a cada mudança.
  - Alerta visual verde 🟢 para margens saudáveis (> 15%) e vermelho 🔴 para margens de risco (≤ 15%).
- **📄 Geração de PDF Comercial:** Exportação profissional da proposta comercial formatada para envio ao cliente.
- **⚙️ Automação de Carga de Dados:** Ferramentas em PowerShell (`update_data.ps1`) que atualizam o catálogo de preços consumindo planilhas `.csv` diretamente.
- **🔐 Controle de Acesso:** Visualização adaptada ao perfil do usuário (Vendedor vs Supervisor).

---

## 🛠️ Tecnologias Utilizadas

Este projeto foi construído focando em alta performance e ausência de dependências de infraestrutura complexa, garantindo que rode de forma leve em qualquer dispositivo comercial.

- **Frontend:** HTML5 Semântico, CSS3 (Custom Properties e Flexbox/Grid)
- **Lógica e Dados:** JavaScript Vanilla (ES6+)
- **Exportação:** `html2pdf.js` para manipulação e download dos orçamentos
- **Scripts Nativos:** PowerShell Scripts (`.ps1`) para automação de conversão de dados do Excel para JSON/JS.

---

## 🏗️ Arquitetura e Estrutura de Arquivos

```text
Portal_Precos_Hiperroll/
├── index.html            # Interface de Usuário Principal
├── style.css             # Estilizações e Design System
├── script.js             # Motor principal (Cálculos de Preços e DOM)
├── data.js               # Base de dados em memória (Tabelas de Frete e Produtos)
├── scratch/              # Scripts de suporte e automações de banco de dados
│   └── update_data.ps1   # Script PowerShell que converte os CSVs do Excel para data.js
└── README.md             # Esta documentação
```

---

## 🚀 Como Executar Localmente

O Portal de Preços foi desenvolvido para rodar no navegador de forma independente (Client-Side). 

1. Faça o clone do repositório:
   ```bash
   git clone https://github.com/SEU-USUARIO/portal-precos-hiperroll.git
   ```
2. Navegue até a pasta do projeto:
   ```bash
   cd portal-precos-hiperroll
   ```
3. Abra o arquivo `index.html` em qualquer navegador moderno (Google Chrome, Microsoft Edge, Firefox).

> **Dica:** Para atualizar a tabela de preços, basta depositar a planilha `.csv` mais recente gerada pelo comercial na área de trabalho e rodar o script local `scratch/update_data.ps1`.

---

## 📊 Fluxo de Geração de Pedidos

1. **Definição de Localidade:** O vendedor escolhe o Estado e o Tipo de Região para travar a base tarifária.
2. **Seleção de Produtos:** Adição dos itens no carrinho (o sistema consulta o peso e custo FOB base).
3. **Margens e Contratos:** O vendedor aplica (se houver) taxas extras, descontos corporativos ou negocia os preços produto a produto.
4. **Fechamento:** O sistema sumariza tudo, trava um código hash único para a proposta e gera o espelho do pedido em PDF.

---

<div align="center">
  <p>Desenvolvido com 💼 para a operação comercial da <strong>Hiperroll Embalagens</strong>.</p>
</div>
