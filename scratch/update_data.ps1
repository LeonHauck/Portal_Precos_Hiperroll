param(
    [Parameter(Mandatory)] [string] $Xlsx,
    [string] $DataJs
)
# Atualiza o bloco PRODUTOS_CSV do data.js a partir da planilha de produtos (.xlsx), sem Excel.
#
#   powershell -File scratch\update_data.ps1 -Xlsx "TABELA HIPERROLL PRODUTOS - ATUALIZADA SETEMBRO.xlsx"
#
# Lê a primeira aba, acha a linha de cabeçalho (a que tem "Cod. Produto") e grava cabeçalho +
# produtos. O portal localiza as colunas pelo NOME do cabeçalho (ver buildLegacyCatalog no
# script_v5.js), então colunas novas ou em outra ordem não quebram nada. Colunas que o portal usa:
# Margem, Linha, Categoria, Cod. Produto, Descrição - Nota Fiscal, Peso Caixa/Frd (o último, líquido), NCM.
# Só o bloco PRODUTOS_CSV muda: custos (BLENDAS_CSV) e frete (FRETE_CSV) ficam como estão.
$ErrorActionPreference = 'Stop'
if (-not $DataJs) { $DataJs = Join-Path (Split-Path -Parent $PSScriptRoot) 'data.js' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$inv = [Globalization.CultureInfo]::InvariantCulture
$ptBR = [Globalization.CultureInfo]::GetCultureInfo('pt-BR')

$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Xlsx).Path)
function Read-Entry([string] $name) {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $name }
    if (-not $entry) { return $null }
    $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Col-Index([string] $ref) {
    $n = 0
    foreach ($ch in ($ref -replace '\d', '').ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
    return $n - 1
}

$shared = @()
$sst = Read-Entry 'xl/sharedStrings.xml'
if ($sst) {
    foreach ($si in $sst.sst.si) {
        if ($si.r) { $shared += (($si.r | ForEach-Object { if ($_.t -is [string]) { $_.t } else { $_.t.'#text' } }) -join '') }
        elseif ($si.t -is [string]) { $shared += $si.t }
        else { $shared += [string]$si.t.'#text' }
    }
}
$wb = Read-Entry 'xl/workbook.xml'
$rels = Read-Entry 'xl/_rels/workbook.xml.rels'
$sheet = @($wb.workbook.sheets.sheet)[0]
$rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
$target = ($rels.Relationships.Relationship | Where-Object { $_.Id -eq $rid }).Target
$doc = Read-Entry ('xl/' + ($target -replace '^/xl/', ''))

# Each row becomes an array of clean cell texts (no line breaks, no ';', single spaces).
$rows = @()
foreach ($row in $doc.worksheet.sheetData.row) {
    $cells = @{}
    foreach ($c in $row.c) {
        $value = ''
        $isText = $false
        if ($c.t -eq 's') { $value = $shared[[int]$c.v]; $isText = $true }
        elseif ($c.t -eq 'inlineStr') { $value = [string]$c.is.t; $isText = $true }
        elseif ($null -ne $c.v) { $value = [string]$c.v }
        $value = ($value -replace '[\r\n;`\\]+', ' ' -replace '\s+', ' ').Trim()
        if ($value -ne '') { $cells[(Col-Index $c.r)] = [pscustomobject]@{ text = $value; isText = $isText } }
    }
    if ($cells.Count) { $rows += , $cells }
}
$zip.Dispose()

$headerRow = $rows | Where-Object { $_.Values.text -contains 'Cod. Produto' } | Select-Object -First 1
if (-not $headerRow) { throw 'Não encontrei a linha de cabeçalho (coluna "Cod. Produto") na planilha.' }
$columns = $headerRow.Keys | Sort-Object
$nameOf = @{}; foreach ($col in $columns) { $nameOf[$col] = $headerRow[$col].text }
$codeCol = $columns | Where-Object { $nameOf[$_] -eq 'Cod. Produto' } | Select-Object -First 1
$marginCol = $columns | Where-Object { $nameOf[$_] -eq 'Margem' } | Select-Object -First 1
$weightCols = @($columns | Where-Object { $nameOf[$_] -match '^Peso ' })

function Format-Cell($cell, [int] $col) {
    if (-not $cell) { return '' }
    $text = $cell.text
    $number = 0.0
    $isNumber = -not $cell.isText -and [double]::TryParse($text, [Globalization.NumberStyles]::Float, $inv, [ref]$number)
    if (-not $isNumber) { return $text }
    if ($col -eq $marginCol) { return ('{0}%' -f [math]::Round($number * 100, 2).ToString('0.##', $ptBR)) }
    # Weights with 3 decimals (as the portal always used); other decimals with up to 4.
    if ($weightCols -contains $col) { return [math]::Round($number, 3).ToString('0.000', $ptBR) }
    if ($text -match '[.eE]') { return [math]::Round($number, 4).ToString('0.####', $ptBR) }
    return $text
}

$lines = @(($columns | ForEach-Object { $nameOf[$_] }) -join ';')
$count = 0
foreach ($cells in $rows) {
    if ($cells -eq $headerRow -or -not $cells[$codeCol] -or $cells[$codeCol].text -notmatch '^[A-Za-z]-\s?\d') { continue }
    $lines += ($columns | ForEach-Object { Format-Cell $cells[$_] $_ }) -join ';'
    $count++
}
if ($count -lt 50) { throw "Só $count produtos encontrados: confira se a planilha é a de produtos." }

$encoding = [Text.UTF8Encoding]::new($true)
$content = [IO.File]::ReadAllText($DataJs, $encoding)
$start = $content.IndexOf('const PRODUTOS_CSV = `')
if ($start -lt 0) { throw 'Bloco PRODUTOS_CSV não encontrado no data.js.' }
$end = $content.IndexOf('`;', $start + 22)
if ($end -lt 0) { throw 'Fim do bloco PRODUTOS_CSV não encontrado no data.js.' }
$block = 'const PRODUTOS_CSV = `' + ($lines -join "`r`n") + "`r`n" + '`;'
[IO.File]::WriteAllText($DataJs, $content.Substring(0, $start) + $block + $content.Substring($end + 2), $encoding)
Write-Output "data.js atualizado: $count produtos, $($columns.Count) colunas."
