param(
    [string[]] $Modos,
    [string] $Destino
)
# Gera as capturas de tela usadas no README (docs/screenshots), com usuários e clientes de
# exemplo e com preços, descontos e margens trocados por zeros desfocados (ver testes_portal.js,
# modos "readme_*"). Também serve para conferir o visual: os modos "layout_*" mostram as telas
# com valores, e as imagens ficam em tests/resultados/prints (fora do Git).
#
#   powershell -ExecutionPolicy Bypass -File tests\gerar_prints.ps1
#   powershell -ExecutionPolicy Bypass -File tests\gerar_prints.ps1 -Modos layout_hist,layout_mobile
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
$tests = $PSScriptRoot
$raiz = Split-Path -Parent $tests
$saida = Join-Path $tests 'resultados'
New-Item -ItemType Directory -Force $saida | Out-Null
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$raizUrl = ([Uri]((Resolve-Path $raiz).Path.TrimEnd('\') + '\')).AbsoluteUri

# Nome do arquivo e tamanho da janela de cada tela.
$telas = [ordered]@{
    readme_login       = @('01-login.png', '1280,760')
    readme_precos      = @('02-consulta-de-precos.png', '1280,820')
    readme_pedido      = @('03-pedido.png', '1280,1180')
    readme_historico   = @('04-historico-do-pedido.png', '1280,820')
    readme_tabela      = @('05-tabela-de-precos.png', '1280,820')
    readme_aprovacoes  = @('06-aprovacoes.png', '1280,820')
    readme_pedidos     = @('07-historico-e-entregas.png', '1280,1000')
    readme_faturamento = @('08-faturamento.png', '1280,820')
    readme_usuarios    = @('09-usuarios.png', '1280,820')
    layout_full        = @('layout_full.png', '1280,2300')
    layout_hist        = @('layout_hist.png', '1280,1500')
    layout_super       = @('layout_super.png', '1280,900')
    layout_users       = @('layout_users.png', '1280,900')
    layout_mobile      = @('layout_mobile.png', '375,1700')
    layout_dark        = @('layout_dark.png', '1280,1400')
}
# Aceita "-Modos a,b" vindo do powershell -File (chega como um texto só).
$Modos = @($Modos | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if (-not $Modos) { $Modos = @($telas.Keys | Where-Object { $_ -like 'readme_*' }) }

$html = [IO.File]::ReadAllText((Join-Path $raiz 'Portal_Hiperroll_Final.html'), $utf8)
$html = $html.Replace('<meta charset="UTF-8">', "<meta charset=""UTF-8""><base href=""$raizUrl"">")
$html = [regex]::Replace($html, '<script src="https://cdnjs[^"]*html2pdf[^"]*"></script>', '')
$html = $html.Replace('<script src="api/data.php"></script>', '<script src="tests/api_simulada.js"></script><script src="data.js"></script>')
$last = [regex]::Matches($html, '<script src="js/[^"]+"></script>') | Select-Object -Last 1
$html = $html.Insert($last.Index + $last.Length, '<script src="tests/testes_portal.js"></script>')
$pagina = Join-Path $saida 'pagina_prints.html'
[IO.File]::WriteAllText($pagina, $html, $utf8)

foreach ($modo in $Modos) {
    if (-not $telas.Contains($modo)) { Write-Warning "Modo desconhecido: $modo"; continue }
    $arquivo, $janela = $telas[$modo]
    $pasta = if ($Destino) { $Destino } elseif ($modo -like 'readme_*') { Join-Path $raiz 'docs\screenshots' } else { Join-Path $saida 'prints' }
    New-Item -ItemType Directory -Force $pasta | Out-Null
    $png = Join-Path $pasta $arquivo
    $url = ([Uri]$pagina).AbsoluteUri + "?mode=$modo"
    $largura, $altura = $janela -split ','
    # O Edge sem janela não desenha páginas com menos de ~480 px de largura. Para a tela de celular,
    # a página abre dentro de um quadro (iframe) da largura do celular e a imagem é recortada nela.
    $celular = [int]$largura -lt 480
    if ($celular) {
        $moldura = Join-Path $saida "moldura_$modo.html"
        [IO.File]::WriteAllText($moldura, "<!DOCTYPE html><html><body style='margin:0'><iframe src='$url' width='$largura' height='$altura' style='border:0;display:block'></iframe></body></html>", $utf8)
        $url = ([Uri]$moldura).AbsoluteUri
        $janela = "520,$altura"
    }
    $edgeArgs = @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$saida\edge_print_$modo", '--allow-file-access-from-files', "--window-size=$janela", '--virtual-time-budget=15000', "--screenshot=$png", $url)
    Start-Process -FilePath $edge -ArgumentList $edgeArgs -RedirectStandardOutput "$saida\print_$modo.txt" -RedirectStandardError "$saida\print_erros_$modo.txt" -Wait -NoNewWindow
    if ($celular -and (Test-Path $png)) {
        Add-Type -AssemblyName System.Drawing
        $imagem = [Drawing.Bitmap]::FromFile($png)
        $recorte = $imagem.Clone([Drawing.Rectangle]::new(0, 0, [int]$largura, $imagem.Height), $imagem.PixelFormat)
        $imagem.Dispose()
        $recorte.Save($png, [Drawing.Imaging.ImageFormat]::Png)
        $recorte.Dispose()
    }
    "{0,-20} -> {1}" -f $modo, $png
}
