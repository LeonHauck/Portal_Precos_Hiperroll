param(
    [string[]] $Modos = @('anon', 'newrep', 'rep', 'gestor', 'repcat', 'admincat'),
    [switch] $SemDemo
)
# Roda os testes automáticos da tela do portal no Microsoft Edge sem janela (headless).
#
#   powershell -ExecutionPolicy Bypass -File tests\rodar_testes.ps1
#   powershell -ExecutionPolicy Bypass -File tests\rodar_testes.ps1 -Modos gestor   (só um cenário)
#
# O que é testado: a TELA (script em js/), conversando com uma API simulada (api_simulada.js) que
# segue o mesmo contrato do api/index.php. O PHP em si não é executado aqui.
# Precisa do data.js na pasta do projeto (ele fica fora do Git) e do Microsoft Edge instalado.
# Cada cenário (modo) entra com um tipo de usuário diferente; ver testes_portal.js.
$ErrorActionPreference = 'Stop'
# Aceita "-Modos a,b" vindo do powershell -File (chega como um texto só).
$Modos = @($Modos | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$utf8 = [Text.UTF8Encoding]::new($false)
$tests = $PSScriptRoot
$raiz = Split-Path -Parent $tests
$saida = Join-Path $tests 'resultados'
New-Item -ItemType Directory -Force $saida | Out-Null
if (-not (Test-Path (Join-Path $raiz 'data.js'))) { throw 'Falta o data.js na pasta do projeto (ele fica fora do Git).' }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge não encontrado.' }
$raizUrl = ([Uri]((Resolve-Path $raiz).Path.TrimEnd('\') + '\')).AbsoluteUri

function Remove-PdfLib([string] $html) {
    return [regex]::Replace($html, '<script src="https://cdnjs[^"]*html2pdf[^"]*"></script>', '')
}
function Add-AfterLastAppScript([string] $html, [string] $tag) {
    $last = [regex]::Matches($html, '<script src="js/[^"]+"></script>') | Select-Object -Last 1
    if (-not $last) { throw 'Não achei os <script src="js/..."> na página.' }
    return $html.Insert($last.Index + $last.Length, $tag)
}
# Abre a página no Edge sem janela, espera os testes e devolve as linhas "PASS | ..." / "FAIL | ...".
function Invoke-TestPage([string] $page, [string] $name, [int] $budget = 20000) {
    $out = Join-Path $saida "saida_$name.html"
    $url = ([Uri]$page).AbsoluteUri + "?mode=$name"
    $edgeArgs = @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$saida\edge_$name", '--allow-file-access-from-files', "--virtual-time-budget=$budget", '--dump-dom', $url)
    Start-Process -FilePath $edge -ArgumentList $edgeArgs -RedirectStandardOutput $out -RedirectStandardError "$saida\erros_$name.txt" -Wait -NoNewWindow
    $dom = [IO.File]::ReadAllText($out)
    $match = [regex]::Match($dom, '<pre id="test-out">([\s\S]*?)</pre>')
    if (-not $match.Success) { return @("FAIL | $name | a página não terminou os testes") }
    return [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) -split "`n" | Where-Object { $_ -ne '' }
}

# Página de teste = página real do portal + API simulada + roteiro de testes.
$html = [IO.File]::ReadAllText((Join-Path $raiz 'Portal_Hiperroll_Final.html'), $utf8)
$html = $html.Replace('<meta charset="UTF-8">', "<meta charset=""UTF-8""><base href=""$raizUrl"">")
$html = (Remove-PdfLib $html).Replace('<script src="api/data.php"></script>', '<script src="data.js"></script><script>window.PORTAL_DATA_LOCKED = false;</script><script src="tests/api_simulada.js"></script>')
$html = Add-AfterLastAppScript $html '<script src="tests/testes_portal.js"></script>'
$pagina = Join-Path $saida 'pagina_teste.html'
[IO.File]::WriteAllText($pagina, $html, $utf8)

$total = 0; $falhas = @()
foreach ($modo in $Modos) {
    $linhas = Invoke-TestPage $pagina $modo
    $ruins = @($linhas | Where-Object { $_ -notmatch '^PASS' })
    "{0,-10} {1,4} verificações, {2} com problema" -f $modo, $linhas.Count, $ruins.Count
    $total += $linhas.Count; $falhas += $ruins
}

# Modo demonstração (pasta demo/, fora do Git): só roda se ela existir.
$demo = Join-Path $raiz 'demo\index.html'
if (-not $SemDemo -and (Test-Path $demo)) {
    $d = [IO.File]::ReadAllText($demo, $utf8).Replace('<base href="../">', "<base href=""$raizUrl"">")
    $d = (Remove-PdfLib $d).Replace('<script src="demo/demo_api.js"></script>', "<script>localStorage.removeItem('hr_demo_state_v2'); sessionStorage.setItem('hr_demo_user', '3');</script><script src=""demo/demo_api.js""></script>")
    $d = Add-AfterLastAppScript $d '<script src="tests/testes_demo.js"></script>'
    $paginaDemo = Join-Path $saida 'pagina_demo.html'
    [IO.File]::WriteAllText($paginaDemo, $d, $utf8)
    $linhas = Invoke-TestPage $paginaDemo 'demo' 25000
    $ruins = @($linhas | Where-Object { $_ -notmatch '^PASS' })
    "{0,-10} {1,4} verificações, {2} com problema" -f 'demo', $linhas.Count, $ruins.Count
    $total += $linhas.Count; $falhas += $ruins
}

''
"TOTAL: $total verificações, $($falhas.Count) com problema"
$falhas | ForEach-Object { "  $_" }
if ($falhas.Count) { exit 1 }
