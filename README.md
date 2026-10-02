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
- **FOB** = preço por kg do grupo de preço do produto (o "100% NF" da planilha) × peso do produto.
- **CIF** = (custo + despesas + frete da UF/praça/faixa de peso) ÷ (custos ÷ preço 100% NF) × peso — o frete recebe o mesmo markup do grupo.
- Exibição de peso, preço FOB e preço CIF por item.
- **💲 Tabela de Preços (aba do gestor):** custos e preço por kg de cada **grupo de preço** (a "linha de produto" da planilha de custos), tabela de frete, cadastro de produtos (grupo, peso, ativo/inativo), **preço próprio por produto** (ex.: produto X = R$ 50,00), ações por **categoria** (reajuste %, mover de grupo, voltar ao preço do grupo), reajuste percentual em lote com pré-visualização e histórico "de → para" de cada alteração. Mudanças valem imediatamente para todos.
- **Vocabulário:** *categoria* é a família do produto (serve para filtrar); *grupo de preço* é o conjunto de produtos que compartilha um preço por kg. Uma categoria pode ter mais de um grupo (ex.: sacolas impressas brancas, azuis e verdes). No código, grupo de preço aparece como `costLines` / `cost_lines`.
- **Atualização automática:** cada portal aberto confere a versão da tabela a cada minuto (e ao voltar para a aba do navegador); se o gestor mudou algo, a busca e o pedido aberto se atualizam sozinhos.

### 🤝 Negociação e margem

- Inclusão de produtos em um pedido com quantidade ajustável.
- Alteração do preço negociado por item.
- Sincronização entre preço negociado e desconto unitário.
- Desconto manual, pagamento antecipado (−2%) e frete FOB (−3%), somados.
- **Modalidade do pedido**, marcada pelo representante. Ela define o desconto máximo e o aviso de implantação:

  | Modalidade | Desconto permitido | Aviso quando há desconto |
  |---|---|---|
  | 100% · Preço base (Livre) | nenhum | — |
  | 50% · Aval | até 10% | "PEDIDO DEVE SER IMPLANTADO AVAL." |
  | 10% · Garantia | até 20% | "PEDIDO DEVE SER IMPLANTADO GARANTIA." |

  - O **desconto** é o que o cliente paga comparado ao preço de tabela (CIF): entram o desconto por item, o desconto % do pedido, o pagamento antecipado e o frete FOB.
  - Acima do limite da modalidade, o pedido só é enviado com **justificativa** e chega ao gestor com o alerta "desconto acima do limite". O aviso de implantação aparece para o representante e para o gestor.
  - Pedidos salvos antes das modalidades não têm essa regra.
- **Margem do produto:** cada produto tem uma margem no preço cheio (coluna "Margem" da planilha: 5% nas sacolas, 10% nas bobinas, sacarias e hospitalar, 15% em condomínio/rolo/perfumado, 20% no dobrado, 30% em Freezer e Micro-Ondas). Um produto de R$ 100 com margem de 5% precisa manter R$ 95; os descontos baixam o preço e esse valor fica igual:
  `margem = (preço líquido − preço de tabela × (1 − margem do produto)) ÷ valor da nota`.
  - Desconto em um item muda só a margem dele; desconto no pedido muda a de todos. Ex.: 2% de desconto em um produto de 5% → 3,06%.
  - A margem é informação para o gestor (verde no preço cheio, amarela com desconto, vermelha quando negativa). **Ela não trava o envio**; quem trava é a faixa de desconto da modalidade.
  - O gestor altera a margem de cada produto na aba Tabela de Preços → Produtos.
  - Pedidos salvos antes desta regra mantêm a conta antiga (lucro = líquido − FOB, mínimo de 10%).
- **Contrato (%):** acréscimo na nota para cobrir um custo que a própria Hiperroll paga (ex.: percentual logístico). Aumenta a nota sem aumentar o lucro, então reduz a margem; não conta como desconto.
- Margem do pedido ponderada por valor: soma dos lucros ÷ total da nota.
- **Preços atualizados:** ao abrir um rascunho, repetir um pedido ou enviar depois que o gestor mudou a tabela, o portal mostra o que mudou e o representante escolhe entre manter os preços negociados ou aplicar a nova tabela (mantendo o mesmo desconto em R$).

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
| Tabela de Preços (custos, frete, produtos, reajuste) | — | **✓ (edita)** | importa e consulta |

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

### 🎬 Sem PHP: modo demonstração

A pasta `demo/` fica só na máquina de desenvolvimento (está no `.gitignore`, não vai para o repositório). Para ver e apresentar o sistema sem servidor, abra **`demo/index.html`** com dois cliques. O arquivo `demo/demo_api.js` simula a API dentro do navegador com as mesmas regras do PHP (papéis, modalidades e limites de desconto, versão da tabela de preços, histórico).

- A barra no canto inferior troca de usuário (gestor, administrador, representantes) e tem o botão **Zerar dados**. As contas de exemplo aceitam qualquer senha.
- Os dados ficam só no `localStorage` daquele navegador; nada é enviado a lugar nenhum.
- A demonstração **não testa o PHP** e não é segurança de verdade: serve para navegar, treinar e apresentar.
- `demo/index.html` é gerado a partir do HTML principal. Depois de mudar o `Portal_Hiperroll_Final.html`, rode `powershell -File demo\gerar_demo.ps1`.
- A pasta `demo/` não deve ser enviada para a hospedagem (e o `.htaccess` dela bloqueia o acesso se for).

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
- **Tabela de preços:** na primeira vez que o gestor (ou o administrador) abre a aba 💲 Tabela de Preços, a tabela do `data.js` é copiada para o banco automaticamente, sem mudar nenhum preço. A partir daí, grupos de preço, frete, produtos e o histórico de preços ficam no mesmo banco SQLite, com um número de versão que sobe a cada alteração e é gravado em cada pedido.
- Até essa primeira abertura, o portal usa o `data.js`, entregue pelo `api/data.php` **somente para usuários logados**. Depois dela o `data.js` não é mais necessário no servidor.
- Preferências de interface (tema claro/escuro) continuam salvas no navegador.

## 🔒 Segurança

- Senhas guardadas com `password_hash()` (bcrypt); o login é limitado a 5 tentativas a cada 15 minutos por usuário/IP.
- Sessão em cookie `HttpOnly`/`SameSite` e renovada no login; toda alteração exige um token CSRF.
- O desconto e o limite da modalidade são recalculados no servidor (`api/lib/pricing.php`), e, com a tabela no banco, o preço de tabela (CIF), o FOB e a margem de cada produto também vêm do banco (`api/lib/catalog.php`) — não dá para esconder um desconto nem inflar a margem alterando o JavaScript no navegador.
- Um pedido montado com uma versão antiga da tabela é recusado no envio até o representante revisar os novos preços.
- `.htaccess` bloqueia o download do banco, da planilha, dos scripts de manutenção, dos backups e de arquivos ocultos.
- `api/config.local.php` e o banco `.sqlite` estão no `.gitignore` e nunca devem ir para o repositório.
- As senhas que existiam no código até setembro de 2026 estão no histórico público do repositório e **não devem ser reutilizadas**.

## 🔄 Atualização das bases

### Atualização de preços, produtos e fretes

O gestor entra na aba **💲 Tabela de Preços** e altera direto na tela (digita o valor e aperta Enter), sem importar nem mexer em arquivos:

- **Grupos de preço:** preço por kg de cada grupo; "Mostrar custos" revela custo, despesas, total e markup.
- **Frete:** valores por UF/praça e faixa de peso; é possível adicionar ou remover praças.
- **Produtos:** descrição, grupo de preço, peso, ativo/inativo e **preço FOB próprio** ("↺ usar grupo" desfaz). Dá para alterar vários produtos e gravar todos de uma vez em **Salvar alterações** (ou Enter); as alterações pendentes continuam guardadas ao trocar de filtro. Filtro por **uma ou mais categorias**, com ações para todos os produtos listados: reajuste %, mover para outro grupo e voltar ao preço do grupo. Produtos com preço próprio não acompanham os reajustes do grupo. Cadastro de produtos novos.
- **Reajuste em lote:** um percentual sobre os grupos de preço escolhidos (preço e custos juntos, só preço ou só custos) ou sobre o frete das UFs escolhidas. Sempre com pré-visualização antes de aplicar.
- **Histórico:** quem mudou, quando, o valor anterior, o novo e o motivo.

Os scripts abaixo só servem para atualizar o `data.js` **antes** de a tabela ir para o banco:

- `scratch/update_data.ps1`: lê a planilha de produtos `.xlsx` direto (sem Excel e sem exportar CSV) e regrava o bloco `PRODUTOS_CSV` do `data.js`. Uso: `powershell -File scratch/update_data.ps1 -Xlsx "TABELA HIPERROLL PRODUTOS - ATUALIZADA SETEMBRO.xlsx"`. O portal acha as colunas pelo nome do cabeçalho (Margem, Linha, Categoria, Cod. Produto, Descrição, Peso Caixa/Frd líquido, NCM), então colunas novas ou fora de ordem não quebram nada.
- `scratch/update_data.py`: versão antiga, que importava um CSV exportado do Excel (mantida só como histórico).
- `update_product_weights.py`: atualiza pesos por código de produto em `data.js` usando um mapa de códigos.
- `update_weights.ps1`: rotina PowerShell equivalente para atualização de pesos.
- `extract_excel.ps1` e `read_excel.ps1`: scripts auxiliares para leitura e extração de planilhas.

Os caminhos de entrada de alguns scripts apontam para pastas locais específicas. Revise e ajuste esses caminhos antes de executar em outra máquina.

### Regras de margem

As regras (modalidades e seus limites de desconto; margem padrão de 10% para produto sem margem informada; antecipado −2%; frete FOB −3%), a fórmula da margem e o cálculo do desconto sobre a tabela existem em dois lugares que precisam andar juntos: `PRICING_RULES` no `script_v5.js` (o que a tela mostra) e `api/lib/pricing.php` (o que o servidor aceita). O mesmo vale para as fórmulas de FOB/CIF: `computeItemPrices()` no `script_v5.js` e `server_item_prices()` em `api/lib/catalog.php`.

## 🗂️ Estrutura principal

```text
Portal_Precos_Hiperroll/
├── Portal_Hiperroll_Final.html  # Página principal da aplicação
├── script_v5.js                 # Interface, regras de preço e cliente da API
├── style.css                    # Estilos, temas claro/escuro e layout responsivo
├── data.js                      # Tabela inicial (usada só até a tabela ir para o banco)   
├── setup.php                    # Configuração inicial (cria gestor e administrador)
├── .htaccess                    # Bloqueios de arquivos sensíveis no Apache
├── api/
│   ├── index.php                # Único ponto de entrada da API (?action=...)
│   ├── data.php                 # Entrega o data.js só para usuários logados
│   ├── config.php               # Configuração padrão
│   ├── config.local.example.php # Modelo para ajustes da hospedagem
│   └── lib/                     # Banco, autenticação, pedidos, usuários, margem e tabela de preços
├── demo/                        # Modo demonstração local (fora do git; não publicar)
├── data/                        # Banco SQLite (criado automaticamente; fora do git)
├── scratch/                     # Scripts auxiliares de atualização de dados
├── logo-hiperroll.png           # Logo oficial (fundo transparente) — cabeçalho e favicon
└── logo.png                     # Logo com fundo sólido — usado na exportação em PDF
```

Arquivos como `index_backup.html`, `data_backup.js`, `style_backup.css` e `data.json` são mantidos apenas como histórico e não são usados pela aplicação.

## ⚠️ Limitações atuais

- Enquanto a tabela ainda não está no banco, o preço de tabela, o FOB e a margem de cada item ainda vêm do navegador; depois dela, o servidor recalcula tudo.
- A modalidade (100% / 50% / 10%) só define a faixa de desconto e o aviso: o preço de tabela é o mesmo nas três, e o portal não calcula impostos.
- A margem do produto vem da planilha como um percentual fixo no preço cheio; o portal não a deriva dos custos do grupo de preço.
- A ligação produto → grupo de preço vem de uma regra de palavras-chave (`getCategoryMatch()`) mais a tabela `LEGACY_CATEGORY_LINES` no `script_v5.js`: sacarias, sacos de lixo (um grupo por categoria) e bobinas de fundo reto têm grupos próprios, criados como cópia do grupo que os precificava (Fundo Reto ou Bobina estrela), sem alterar nenhum preço. Os grupos da planilha que nenhum produto usa (Corte solda MD/BD, Saco para lixo, Dobrado Azul/Preto, Bobina Forração) ficam fora do portal. Depois da importação, tudo isso passa a ser editado na aba Tabela de Preços.
- As notas fiscais anexadas ficam dentro do banco (em base64); com muitos anexos grandes, vale movê-las para arquivos separados.
- O histórico de status exibido no botão "📋 Histórico" do resumo do pedido é local ao navegador.
- Os scripts de atualização dependem de planilhas e caminhos locais que podem variar por máquina.

## 📄 Licença e uso

Este projeto é destinado ao uso interno da operação comercial da Hiperroll, caso ocorra a intenção de utilizar a mesma ferramenta altere a parte que consta nomes e documentação da empresa Hiperroll.

<div align="center">
  <p>Desenvolvido para apoiar a operação comercial da <strong>Hiperroll Embalagens</strong>.</p>
  <p>👤 Desenvolvido por <a href="https://www.linkedin.com/in/leon-hauck/">Leon Hauck</a></p>
</div>
