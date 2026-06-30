$csvPath = Get-ChildItem -Path "c:\Users\leon.rodrigues\Desktop\Arquivos salvos em formato CSV\*TABELA HIPERROLL MAIO 2026.csv" | Select-Object -ExpandProperty FullName
$dataJsPath = "c:\Users\leon.rodrigues\Desktop\Portal_Precos_Hiperroll\data.js"

if ($csvPath) {
    Write-Output "Found CSV: $csvPath"
    $csvContent = Get-Content -Path $csvPath -Raw -Encoding String
    $dataJsContent = Get-Content -Path $dataJsPath -Raw

    $pattern = 'const PRODUTOS_CSV = `[\s\S]*?`;'
    $replacement = 'const PRODUTOS_CSV = `' + $csvContent + '`;'

    $newDataJsContent = [regex]::Replace($dataJsContent, $pattern, $replacement)

    Set-Content -Path $dataJsPath -Value $newDataJsContent -Encoding utf8
    Write-Output "Update completed successfully"
} else {
    Write-Output "CSV file not found"
}
