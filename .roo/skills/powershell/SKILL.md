---
name: powershell
description: Guía de uso correcto de PowerShell en el entorno VSCode + Windows 10 para el proyecto FAST >>> PASS. Evita errores comunes de shell.
modeSlugs:
  - code
  - ask
  - architect
  - debug
  - orchestrator
---

# ⚡ PowerShell — Guía de Uso Correcto

Skill para ejecutar comandos PowerShell correctamente en el entorno del proyecto **FAST >>> PASS** (Windows 10, VSCode).

## 🔍 Contexto del Entorno

| Variable | Valor |
|----------|-------|
| **SO** | Windows 10 |
| **Shell por defecto en VSCode** | `C:\Program Files\PowerShell\7\pwsh.exe` (NO instalado → fallback a cmd.exe) |
| **PowerShell disponible** | `powershell` (Windows PowerShell 5.1, siempre presente) |
| **PowerShell 7 (`pwsh`)** | ❌ NO instalado en esta máquina |
| **Node.js** | ❌ NO está en el PATH del sistema |
| **Terminal donde se ejecutan comandos** | La herramienta `execute_command` lanza una terminal nueva; el shell efectivo depende de la configuración de VSCode |

## ⚡ Regla de Oro

> **SIEMPRE** usar `powershell -Command "..."` como prefijo para cualquier comando PowerShell.

**NUNCA** usar:
- `pwsh` — no instalado
- `$variable = ...` directamente — cmd.exe no entiende sintaxis PowerShell
- `& "ruta\a\script.ps1"` directamente — cmd.exe no entiende el operador `&`
- `node script.js` — Node no está en PATH

## 📋 Recetas para Tareas Comunes

### 1. Ejecutar un script `.ps1`

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\check_and_fmt.ps1" -BaseDir "\\ruta\unc\..."
```

### 2. Ejecutar comandos PowerShell inline (una línea)

```powershell
powershell -Command "Get-ChildItem -Path '.' -Filter '*.js' | Select-Object Name, Length"
```

### 3. Ejecutar comandos PowerShell inline (multilínea)

Para comandos complejos, usar `;` como separador de statements:

```powershell
powershell -Command "$content = Get-Content -Path 'file.txt' -Raw; $content = $content -replace 'old', 'new'; Set-Content -Path 'file.txt' -Value $content"
```

### 4. Leer y modificar archivos con regex

```powershell
powershell -Command "$txt = [System.IO.File]::ReadAllText('ruta\archivo.js'); $txt = $txt -replace 'pattern', 'replacement'; [System.IO.File]::WriteAllText('ruta\archivo.js', $txt)"
```

**Importante:** Usar `[System.IO.File]` en vez de `Get-Content`/`Set-Content` para preservar encoding UTF-8 sin BOM.

### 5. Escribir contenido multilínea a un archivo (here-string)

```powershell
powershell -Command "$block = @'\nlinea 1\nlinea 2\n'@; [System.IO.File]::WriteAllText('salida.txt', $block)"
```

### 6. Mover/renombrar archivos (forzar sobrescritura)

```powershell
powershell -Command "Move-Item -Path 'origen.js' -Destination 'destino.js' -Force"
```

### 7. Eliminar archivos

```powershell
powershell -Command "Remove-Item -Path 'archivo.txt' -Force"
```

### 8. Buscar texto en archivos (equivalente a `grep`)

```powershell
powershell -Command "Select-String -Path 'js\**\*.js' -Pattern 'function place' -List"
```

### 9. Contar líneas de un archivo

```powershell
powershell -Command "(Get-Content 'archivo.js').Count"
```

### 10. Verificar si un archivo existe

```powershell
powershell -Command "Test-Path 'ruta\archivo.js'"
```

## ❌ Errores Comunes y Soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| `$file : The term '$file' is not recognized` | Se ejecutó sintaxis PowerShell en cmd.exe | Prefijar con `powershell -Command "..."` |
| `pwsh : The term 'pwsh' is not recognized` | PowerShell 7 no está instalado | Usar `powershell` (Windows PowerShell 5.1) |
| `& was unexpected at this time.` | cmd.exe no entiende el operador `&` | Usar `powershell -Command "& 'script.ps1'"` o `-File` |
| `node : The term 'node' is not recognized` | Node no está en PATH | No usar Node; buscar alternativa en PowerShell |
| `File ... is locked` (Move-Item falla) | VSCode mantiene el archivo abierto | Escribir a un archivo temporal nuevo y usar Move-Item -Force |
| `Out-File`/`Set-Content` añade BOM | PowerShell 5.1 escribe UTF-8 con BOM por defecto | Usar `[System.IO.File]::WriteAllText()` para UTF-8 sin BOM |
| Rutas UNC (`\\server\...`) no accesibles desde algunas herramientas | `read_file` no soporta rutas UNC | Leer desde pestañas de VSCode; usar `execute_command` con PowerShell para operaciones de archivo |
| `-replace` con backslashes en regex | Windows usa `\` como separador de ruta | Escapar con doble backslash `\\` en patrones regex; o usar `[regex]::Escape()` |

## 🔄 Patrón de Chaining en PowerShell

Cuando se necesita ejecutar múltiples comandos secuencialmente, usar `;` (NO `&&` como en bash):

```powershell
powershell -Command "cd 'C:\ruta'; .\script.ps1; Write-Host 'Done'"
```

Para condicionales (solo ejecutar B si A tiene éxito):

```powershell
powershell -Command "if (Test-Path 'file.txt') { Get-Content 'file.txt' } else { Write-Host 'Not found' }"
```

---

© 2026 FAST >>> PASS | powershell Skill v1.0.0
