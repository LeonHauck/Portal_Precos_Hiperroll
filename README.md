<div align="center">
  <img src="logo.png" alt="Logo Hiperroll" width="120" />
  <h1>Portal de Preços Hiperroll</h1>
  <p><strong>Precificação CIF/FOB, negociação comercial e aprovação de pedidos</strong></p>
  <p>
    <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
    <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
    <img src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript Vanilla" />
    <img src="https://img.shields.io/badge/PHP-8+-777BB4?style=for-the-badge&logo=php&logoColor=white" alt="PHP" />
  </p>
</div>

## Visão Geral

O Portal de Preços Hiperroll é uma aplicação web para apoiar a equipe comercial na formação de preços, montagem de pedidos e negociação com clientes. A aplicação cruza produtos, custos, pesos e regras de frete para calcular valores **FOB** e **CIF** conforme o estado, o tipo de praça e a faixa de peso selecionados.

Além da calculadora, o portal oferece um fluxo de negociação com preço unitário editável, descontos, contratos, acompanhamento de margem, rascunhos, envio para análise, aprovação ou rejeição por usuários autorizados e exportação de pedidos em PDF.

## Funcionalidades

### Precificação

- Pesquisa de produtos por descrição, código e categoria.
- Seleção de UF, tipo de praça e faixa de peso.
- Cálculo de FOB a partir do custo base e do peso do produto.
- Cálculo de frete por UF, praça e faixa de peso.
- Cálculo do preço CIF usando custos, despesas e divisor da categoria.
- Exibição de peso, frete, preço FOB e preço CIF por item.

### Negociação e margem

- Inclusão de produtos em um pedido com quantidade ajustável.
- Alteração do preço negociado por item.
- Sincronização entre preço negociado e desconto unitário.
- Desconto geral e percentual de contrato no pedido.
- Margem calculada com base no preço negociado e no FOB.
- Classificação visual da margem:
  - acima de 15%: margem segura;
  - de 11% a 15%: margem de atenção;
  - abaixo de 11%: margem crítica.

### Pedidos e workflow comercial

- Geração automática do número interno Hiperroll com cinco dígitos.
- Registro de cliente, representante, validade da proposta e número do pedido do cliente.
- Salvamento e carregamento de rascunhos.
- Envio de pedidos para o status **Em Análise**.
- Histórico de status com data, usuário e motivo.
- Consulta dos pedidos do usuário na aba **Histórico e Entregas**.
- Aprovação ou rejeição com justificativa e observação do supervisor.
- Previsão de faturamento calculada após a aprovação.
- Exclusão de registros armazenados localmente quando necessário.

### Exportação

- Geração de proposta comercial em PDF com os dados do pedido, itens, valores, descontos, contrato e margem.
- Exportação controlada pelo `html2pdf.js`, carregado via CDN no HTML principal.

## Perfis e permissões

- **Vendedor:** cria pedidos, salva rascunhos, negocia itens e envia pedidos para análise.
- **Supervisor:** acessa o painel de pedidos pendentes e pode aprovar ou rejeitar pedidos.
- **Desenvolvedor:** possui acesso administrativo previsto pelo perfil atual do sistema.
- A aprovação e a rejeição estão restritas atualmente aos usuários `Leon` e `Gabriel.Ferreira`.

## Como executar

### Execução recomendada com PHP

O portal pode ser aberto como página estática para testar parte da interface, mas o uso com servidor local é recomendado para evitar limitações do navegador e permitir a execução do backend PHP.

Na pasta do projeto, execute:

```powershell
php -S localhost:8000
```

Depois acesse:

```text
http://localhost:8000/Portal_Hiperroll_Final.html
```

Também é possível abrir `Portal_Hiperroll_Final.html` diretamente no navegador quando o backend PHP não for necessário. Nesse modo, os dados do frontend continuam dependendo do armazenamento local do navegador.

## Dados e persistência

O frontend atual armazena usuários, sessão, rascunhos, pedidos enviados, status, histórico e contador de pedidos no `localStorage` do navegador. Esses dados são locais ao navegador e ao perfil de usuário do Windows; limpar os dados do site ou trocar de navegador pode removê-los.

Os dados de produtos, custos e fretes são incorporados ao arquivo `data.js` a partir de blocos CSV. O arquivo `data.json` também está disponível como representação estruturada dos dados, mas a página principal carrega `data.js`.

O arquivo `auth.php` fornece uma API PHP independente para login e cadastro usando `users.json`, com hashes de senha compatíveis com `password_hash()`/`password_verify()`. A implementação frontend atualmente mantém seu próprio fluxo local em `script_v5.js`; portanto, a API PHP não deve ser considerada uma sincronização automática com o `localStorage` sem uma integração adicional.

## Segurança de credenciais

- Nunca publique senhas reais, hashes ou dados pessoais no repositório.
- `.env` e `users.json` já estão listados no `.gitignore`.
- `users.json` deve permanecer apenas no ambiente local ou em um armazenamento seguro de produção.
- Use `.env.example` como modelo para criar um `.env` local.
- As credenciais de exemplo presentes em `.env.example` são destinadas ao desenvolvimento e devem ser alteradas antes de qualquer uso real.
- Se `users.json` já tiver sido rastreado pelo Git, o `.gitignore` não basta: remova-o do índice com `git rm --cached users.json` e faça um commit.

## Atualização das bases

### Atualização de produtos e fretes

O arquivo `data.js` contém as tabelas usadas diretamente pela aplicação. Para atualizar a base, substitua os dados pela planilha CSV mais recente e revise o resultado antes de publicar.

Há scripts de apoio para diferentes rotinas:

- `scratch/update_data.py`: importa o CSV de produtos para o bloco `PRODUTOS_CSV` de `data.js`.
- `scratch/update_data.ps1`: versão PowerShell da atualização do bloco de produtos.
- `update_product_weights.py`: atualiza pesos por código de produto em `data.js` usando um mapa de códigos.
- `update_weights.ps1`: rotina PowerShell equivalente para atualização de pesos.
- `extract_excel.ps1` e `read_excel.ps1`: scripts auxiliares para leitura e extração de planilhas.

Os caminhos de entrada de alguns scripts apontam para pastas locais específicas. Revise e ajuste esses caminhos antes de executar em outra máquina.

## Estrutura principal

```text
Portal_Precos_Hiperroll/
├── Portal_Hiperroll_Final.html  # Página principal da aplicação
├── script_v5.js                 # Regras de negócio, autenticação local e interface
├── style.css                    # Estilos e layout responsivo
├── data.js                      # Produtos, custos e fretes usados pelo frontend
├── data.json                    # Representação JSON dos dados
├── auth.php                     # API PHP independente de autenticação/cadastro
├── users.json                   # Usuários locais; ignorado pelo Git
├── .env.example                 # Modelo de configuração local
├── .gitignore                   # Arquivos que não devem ser versionados
├── scratch/                     # Scripts auxiliares de atualização de dados
├── logo.png                     # Identidade visual do portal
└── *.md                         # Guias, referências e documentação complementar
```

Arquivos como `index_backup.html`, `data_backup.js` e os documentos de validação são mantidos como histórico, apoio técnico ou referência e não são o ponto de entrada principal da aplicação.

## Documentação complementar

- `INICIO_RAPIDO_5MIN.md`: entrada rápida para conhecer o fluxo de negociação.
- `GUIA_PRATICO.md`: exemplos operacionais de negociação.
- `README_NEGOCIACAO.md`: visão geral das funcionalidades de negociação.
- `FUNCIONALIDADES_NEGOCIACAO.md`: descrição detalhada dos recursos de negociação.
- `DOCUMENTACAO_TECNICA.md`: fórmulas e detalhes da implementação.
- `CHECKLIST_VALIDACAO.md`: roteiro de validação manual.
- `QUICK_REFERENCE.md`: referência rápida para manutenção da interface.
- `INDICE_COMPLETO.md`: índice da documentação disponível.

## Limitações atuais

- A persistência principal de pedidos e usuários no frontend é local ao navegador.
- Não existe, no fluxo atual do frontend, um banco de dados compartilhado entre vendedores e supervisores.
- A API PHP e o fluxo de autenticação local são caminhos separados e precisam ser integrados antes de um uso multiusuário centralizado.
- Os scripts de atualização dependem de planilhas e caminhos locais que podem variar por máquina.

## Licença e uso

Este projeto é destinado ao uso interno da operação comercial da Hiperroll.

<div align="center">
  <p>Desenvolvido para apoiar a operação comercial da <strong>Hiperroll Embalagens</strong>.</p>
</div>
