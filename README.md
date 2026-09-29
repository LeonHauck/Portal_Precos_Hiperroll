<div align="center">
  <img src="logo-hiperroll.png" alt="Logo Hiperroll" width="140" />
  <h1>Portal de Preços Hiperroll</h1>
  <p><strong>Precificação CIF/FOB, negociação comercial e aprovação de pedidos</strong></p>
  <p>
    <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
    <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
    <img src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript Vanilla" />
    <img src="https://img.shields.io/badge/PHP-8+-777BB4?style=for-the-badge&logo=php&logoColor=white" alt="PHP" />
    <img src="https://img.shields.io/badge/Tema-Claro%20%2F%20Escuro-0b1220?style=for-the-badge&logo=darkreader&logoColor=white" alt="Tema claro e escuro" />
  </p>
</div>

## 📋 Visão Geral

O Portal de Preços Hiperroll é uma aplicação web para apoiar a equipe comercial na formação de preços, montagem de pedidos e negociação com clientes. A aplicação cruza produtos, custos, pesos e regras de frete para calcular valores **FOB** e **CIF** conforme o estado, o tipo de praça e a faixa de peso selecionados.

Além da calculadora, o portal oferece um fluxo de negociação com preço unitário editável, descontos, contratos, acompanhamento de margem, rascunhos, envio para análise, aprovação ou rejeição por usuários autorizados e exportação de pedidos em PDF.

## ⚙️ Funcionalidades

### 💰 Precificação

- Pesquisa de produtos por descrição, código e categoria.
- Seleção de UF, tipo de praça e faixa de peso.
- Cálculo de FOB a partir do custo base e do peso do produto.
- Cálculo de frete por UF, praça e faixa de peso.
- Cálculo do preço CIF usando custos, despesas e divisor da categoria.
- Exibição de peso, frete, preço FOB e preço CIF por item.

### 🤝 Negociação e margem

- Inclusão de produtos em um pedido com quantidade ajustável.
- Alteração do preço negociado por item.
- Sincronização entre preço negociado e desconto unitário.
- Desconto geral e percentual de contrato no pedido.
- Margem calculada com base no preço negociado e no FOB.
- Classificação visual da margem:
  - acima de 15%: margem segura;
  - de 11% a 15%: margem de atenção;
  - abaixo de 11%: margem crítica.

### 🧾 Pedidos e workflow comercial

- Geração automática do número interno Hiperroll com cinco dígitos.
- Registro de cliente, representante, validade da proposta e número do pedido do cliente.
- Salvamento e carregamento de rascunhos.
- Envio de pedidos para o status **Em Análise**.
- Histórico de status com data, usuário e motivo.
- Consulta dos pedidos do usuário na aba **Histórico e Entregas**.
- Aprovação ou rejeição com justificativa e observação do supervisor.
- Previsão de faturamento calculada após a aprovação.
- Exclusão de registros armazenados localmente quando necessário.

### 🖨️ Exportação

- Geração de proposta comercial em PDF com os dados do pedido, itens, valores, descontos, contrato e margem.
- Exportação controlada pelo `html2pdf.js`, carregado via CDN no HTML principal.

## 🎨 Interface e experiência

- **🌓 Tema claro e escuro:** botão dedicado no cabeçalho para alternar o tema; a escolha é salva no navegador e, no primeiro acesso, o portal detecta automaticamente a preferência do sistema operacional.
- **🏷️ Identidade visual da Hiperroll:** cabeçalho com o logo oficial em destaque sobre um degradê nas cores da marca (vermelho → azul-marinho), reaproveitado também na tela de login.
- **🧩 Painéis padronizados:** os modais de Supervisor, Lixeira, Faturamento, Detalhes do Pedido, Histórico de Status e Envio de Pedido seguem o mesmo padrão visual (cabeçalho com ícone, corpo rolável e rodapé de ações).
- **🔘 Botões com hierarquia clara:** a ação principal de cada tela (como "Enviar Pedido ao Sistema") se destaca visualmente das ações secundárias (PDF, Salvar Rascunho, Ver Meus Pedidos).
- **🖼️ Ícone da aba (favicon)** com o logo da Hiperroll e rodapé com crédito de desenvolvimento.

## 👥 Perfis e permissões

Cada representante tem o próprio login. As permissões são verificadas **no servidor** a cada ação; a tela apenas esconde o que o usuário não pode usar.

| Ação | Representante | Gestor | Administrador técnico |
|---|---|---|---|
| Criar rascunhos e enviar os próprios pedidos | ✓ | ✓ | ✓ |
| Ver pedidos | só os próprios | **todos** | só os próprios |
| Aprovar, rejeitar e registrar faturamento | — | **✓ (exclusivo)** | — |
| Lixeira | dos próprios pedidos | de todos | dos próprios pedidos |
| Excluir definitivamente | só rascunhos/rejeitados próprios | qualquer pedido | só rascunhos/rejeitados próprios |
| Criar, desativar e redefinir senha de usuários | — | representantes | todas as contas |
| Baixar backup | — | ✓ | ✓ |

- Contas novas recebem uma **senha provisória**; no primeiro acesso o sistema obriga a criação de uma senha pessoal.
- O sistema impede desativar o último gestor ativo.

## 🚀 Como executar localmente

O portal agora depende do backend PHP (login, pedidos compartilhados e tabelas de preço). Abrir o HTML direto pelo Windows (`file://`) mostra apenas a tela de login com erro de conexão.

Com PHP 8+ instalado, na pasta do projeto:

```powershell
php -S localhost:8000
```

1. Acesse `http://localhost:8000/setup.php` e crie as contas do gestor e do administrador.
2. Depois use `http://localhost:8000/Portal_Hiperroll_Final.html`.

## ☁️ Publicação na HostGator

1. **PHP:** em cPanel → *MultiPHP Manager*, selecione PHP 8.1 ou superior. Em *Select PHP Version → Extensions*, confirme `pdo_sqlite` e `mbstring` marcados.
2. **SSL:** em cPanel → *SSL/TLS Status*, ative o AutoSSL (gratuito). Depois descomente o bloco "forçar HTTPS" no `.htaccess` da raiz.
3. **Arquivos:** envie para uma pasta do `public_html` (ex.: `public_html/portal/`) somente o necessário:
   `Portal_Hiperroll_Final.html`, `script_v5.js`, `style.css`, `data.js`, `setup.php`, `.htaccess`, `logo.png`, `logo-hiperroll.png`, `logo-transparent.png` e as pastas `api/` e `data/`.
   Não é preciso enviar a planilha, os scripts `.py`/`.ps1`, os arquivos `*_backup.*`, o `data.json` nem o `README.md` (e o `.htaccess` bloqueia o download deles caso sejam enviados).
4. **Banco fora da pasta pública (recomendado):** copie `api/config.local.example.php` para `api/config.local.php` e aponte `db_path` para algo como `/home/SEU_USUARIO/portal_data/portal.sqlite`.
5. **Primeiro acesso:** abra `https://seudominio.com.br/portal/setup.php`, confira a verificação do servidor e crie as contas do gestor e do administrador. A página se desativa sozinha depois disso.
6. **Representantes:** o gestor entra no portal → **👥 Usuários** → cria cada representante com uma senha provisória.

## 💾 Dados e persistência

- Usuários, pedidos, lixeira, numeração Hiper Roll e o registro de auditoria ficam em um banco **SQLite** (um único arquivo, `data/portal.sqlite` por padrão), criado automaticamente pelo PHP.
- O número Hiper Roll é gerado pelo servidor quando o pedido é salvo pela primeira vez, então dois representantes nunca recebem o mesmo número. O número exibido em um pedido ainda não salvo é uma previsão.
- **Backup:** gestor ou administrador → **👥 Usuários → ⬇️ Baixar backup** (arquivo JSON com pedidos e usuários, sem as senhas). Para uma cópia completa, baixe o arquivo `.sqlite` pelo Gerenciador de Arquivos do cPanel; para restaurar, basta substituí-lo.
- As tabelas de produtos, custos e fretes continuam no `data.js`, mas são entregues pelo `api/data.php` **somente para usuários logados** — o arquivo não pode ser baixado diretamente.
- Preferências de interface (tema claro/escuro) continuam salvas no navegador.

## 🔒 Segurança

- Senhas guardadas com `password_hash()` (bcrypt); o login é limitado a 5 tentativas a cada 15 minutos por usuário/IP.
- Sessão em cookie `HttpOnly`/`SameSite` e renovada no login; toda alteração exige um token CSRF.
- A regra de margem mínima é recalculada no servidor (`api/lib/pricing.php`), então não dá para burlá-la alterando o JavaScript no navegador.
- `.htaccess` bloqueia o download do banco, da planilha, dos scripts de manutenção, dos backups e de arquivos ocultos.
- `api/config.local.php` e o banco `.sqlite` estão no `.gitignore` e nunca devem ir para o repositório.
- As senhas que existiam no código até setembro de 2026 estão no histórico público do repositório e **não devem ser reutilizadas**.

## 🔄 Atualização das bases

### Atualização de produtos e fretes

O arquivo `data.js` contém as tabelas usadas diretamente pela aplicação. Para atualizar a base, substitua os dados pela planilha CSV mais recente e revise o resultado antes de publicar.

Há scripts de apoio para diferentes rotinas:

- `scratch/update_data.py`: importa o CSV de produtos para o bloco `PRODUTOS_CSV` de `data.js`.
- `scratch/update_data.ps1`: versão PowerShell da atualização do bloco de produtos.
- `update_product_weights.py`: atualiza pesos por código de produto em `data.js` usando um mapa de códigos.
- `update_weights.ps1`: rotina PowerShell equivalente para atualização de pesos.
- `extract_excel.ps1` e `read_excel.ps1`: scripts auxiliares para leitura e extração de planilhas.

Os caminhos de entrada de alguns scripts apontam para pastas locais específicas. Revise e ajuste esses caminhos antes de executar em outra máquina.

### Regras de margem

As regras (margem mínima de 10%, alvo de 15%, antecipado −2%, frete FOB −3%) existem em dois lugares que precisam andar juntos: `PRICING_RULES` no `script_v5.js` (o que a tela mostra) e `api/lib/pricing.php` (o que o servidor aceita).

## 🗂️ Estrutura principal

```text
Portal_Precos_Hiperroll/
├── Portal_Hiperroll_Final.html  # Página principal da aplicação
├── script_v5.js                 # Interface, regras de preço e cliente da API
├── style.css                    # Estilos, temas claro/escuro e layout responsivo
├── data.js                      # Produtos, custos e fretes (servido via api/data.php)
├── setup.php                    # Configuração inicial (cria gestor e administrador)
├── .htaccess                    # Bloqueios de arquivos sensíveis no Apache
├── api/
│   ├── index.php                # Único ponto de entrada da API (?action=...)
│   ├── data.php                 # Entrega o data.js só para usuários logados
│   ├── config.php               # Configuração padrão
│   ├── config.local.example.php # Modelo para ajustes da hospedagem
│   └── lib/                     # Banco, autenticação, pedidos, usuários e regra de margem
├── data/                        # Banco SQLite (criado automaticamente; fora do git)
├── scratch/                     # Scripts auxiliares de atualização de dados
├── logo-hiperroll.png           # Logo oficial (fundo transparente) — cabeçalho e favicon
└── logo.png                     # Logo com fundo sólido — usado na exportação em PDF
```

Arquivos como `index_backup.html`, `data_backup.js`, `style_backup.css` e `data.json` são mantidos apenas como histórico e não são usados pela aplicação.

## ⚠️ Limitações atuais

- O custo FOB de cada item é enviado pelo navegador junto com o pedido. O servidor recalcula a margem, mas ainda não recalcula o FOB a partir da tabela de produtos — esse é o próximo passo para fechar totalmente a regra.
- As notas fiscais anexadas ficam dentro do banco (em base64); com muitos anexos grandes, vale movê-las para arquivos separados.
- O histórico de status exibido no botão "📋 Histórico" do resumo do pedido é local ao navegador.
- Os scripts de atualização dependem de planilhas e caminhos locais que podem variar por máquina.

## 📄 Licença e uso

Este projeto é destinado ao uso interno da operação comercial da Hiperroll, caso ocorra a intenção de utilizar a mesma ferramenta altere a parte que consta nomes e documentação da empresa Hiperroll.

<div align="center">
  <p>Desenvolvido para apoiar a operação comercial da <strong>Hiperroll Embalagens</strong>.</p>
  <p>👤 Desenvolvido por <a href="https://www.linkedin.com/in/leon-hauck/">Leon Hauck</a></p>
</div>
