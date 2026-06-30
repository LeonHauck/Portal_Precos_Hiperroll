$excelFile = 'c:\Users\leon.rodrigues\Desktop\Portal_Precos_Hiperroll\TABELA PRODUTOS HIPERROLL - ATUALIZAÇÃO JUNHO 26 - Utilizar no projeto de preços.xlsx'

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $workbook = $excel.Workbooks.Open($excelFile, $null, $true)
    $worksheet = $workbook.Sheets(1)
    
    Write-Host "Nome da aba: $($worksheet.Name)"
    Write-Host "Últimas linhas usadas: $($worksheet.UsedRange.Rows.Count) linhas, $($worksheet.UsedRange.Columns.Count) colunas"
    Write-Host ""
    Write-Host "=== CABEÇALHOS (Primeira linha) ==="
    for ($col = 1; $col -le 15; $col++) {
        $cell = $worksheet.Cells.Item(1, $col)
        if ($cell.Value) {
            Write-Host "Coluna $col``: $($cell.Value)"
        }
    }
    
    Write-Host ""
    Write-Host "=== PRIMEIRAS 2 LINHAS DE DADOS ==="
    for ($row = 2; $row -le 3; $row++) {
        Write-Host "Linha $row`:"
        for ($col = 1; $col -le 12; $col++) {
            $cell = $worksheet.Cells.Item($row, $col)
            if ($cell.Value) {
                Write-Host "  Col$col``: $($cell.Value)"
            }
        }
    }
    
    $workbook.Close($false)
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
} catch {
    Write-Host "Erro: $_"
}
