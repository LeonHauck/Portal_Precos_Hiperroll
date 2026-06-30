import os

csv_path = r'c:\Users\leon.rodrigues\Desktop\Arquivos salvos em formato CSV\Cópia TABELA HIPERROLL MAIO 2026.csv'
data_js_path = r'c:\Users\leon.rodrigues\Desktop\Portal_Precos_Hiperroll\data.js'

with open(csv_path, 'r', encoding='latin-1') as f:
    csv_content = f.read()

with open(data_js_path, 'r', encoding='utf-8') as f:
    data_js_lines = f.readlines()

# Find the start of PRODUTOS_CSV
start_index = -1
for i, line in enumerate(data_js_lines):
    if 'const PRODUTOS_CSV = `' in line:
        start_index = i
        break

if start_index != -1:
    new_data_js = data_js_lines[:start_index]
    new_data_js.append(f"const PRODUTOS_CSV = `{csv_content}`;\n")
    
    with open(data_js_path, 'w', encoding='utf-8') as f:
        f.writelines(new_data_js)
    print("Successfully updated data.js")
else:
    print("Could not find PRODUTOS_CSV in data.js")
