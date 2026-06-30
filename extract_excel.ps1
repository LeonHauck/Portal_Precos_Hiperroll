$file = 'c:\Users\leon.rodrigues\Desktop\Portal_Precos_Hiperroll\TABELA PRODUTOS HIPERROLL - ATUALIZAÇÃO JUNHO 26 - Utilizar no projeto de preços.xlsx'
$outputFile = 'c:\Users\leon.rodrigues\Desktop\Portal_Precos_Hiperroll\dados_extraidos.txt'

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $wb = $excel.Workbooks.Open($file)
    $ws = $wb.Sheets(1)
    
    $linhas = @()
    for ($row = 2; $row -le $ws.UsedRange.Rows.Count; $row++) {
        $codigo = $ws.Cells($row, 6).Value
        $peso = $ws.Cells($row, 20).Value
        
        if ($codigo -and $peso) {
            $linhas += "$codigo|$peso"
        }
    }
    
    $linhas | Out-File $outputFile -Encoding UTF8
    Write-Host "Dados salvos em $outputFile"
    Write-Host "Total de linhas: $($linhas.Count)"
    
    $wb.Close($false)
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
    
} catch {
    Write-Host "Erro: $_"
}
