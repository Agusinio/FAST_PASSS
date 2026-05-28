---
name: fmt-escaletes
description: Formateo diario de archivos JSON de escaletas (minified → pretty-print) usando scripts PowerShell en /bin.
modeSlugs:
  - code
  - ask
---

# 📋 Formateo Diario de Escaletas JSON

Skill para el formateo diario de archivos JSON de escaleta ubicados en la carpeta de red `\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES`.

## 🔍 Contexto

Cada día, el usuario abre en VSCode 3 archivos JSON de escaleta (uno por programa: `TN_COMARQUES`, `TN_MIGDIA`, `TN_VESPRE`) que llegan en formato *minificado* (single-line). El objetivo es convertir estos archivos a formato *pretty-print* con indentación de 4 espacios para facilitar su inspección visual.

> ⚠️ **Importante:** La carpeta en el servidor es `ESCALETES` (sin S final). No confundir con `ESCALETAS`.

## ⚡ Comando Rápido (Batch — Recomendado)

Este comando formatea **todos** los JSON del día actual para los 3 programas en una sola ejecución:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\check_and_fmt.ps1" -BaseDir "\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES"
```

**Lo que hace:**
1. Busca archivos con el patrón `TN_COMARQUES_202605*.json`, `TN_MIGDIA_202605*.json`, `TN_VESPRE_202605*.json` en el directorio base
2. Detecta si cada archivo está minificado (regex: `^\{"[a-z]"`)
3. Si está minificado, lo formatea con [`fmt-json.ps1`](bin/fmt-json.ps1)
4. Si ya está formateado, lo salta

**Fecha del patrón:** El script usa `202605*` hardcodeado. Si se necesita formatear archivos de otro mes/año, editar la línea 6 de [`bin/check_and_fmt.ps1`](bin/check_and_fmt.ps1) y cambiar el patrón (ej: `202606*`).

## 📄 Comando Individual (Un solo archivo)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\fmt-json.ps1" -FilePath "\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES\TN_VESPRE_20260519_215504.json"
```

## 🛠️ Detalles de los Scripts

### `check_and_fmt.ps1` — Batch Formatter
- **Parámetros:** `-BaseDir` (ruta UNC al directorio de escaletas)
- **Programas:** `TN_COMARQUES`, `TN_MIGDIA`, `TN_VESPRE`
- **Patrón:** `*_202605*.json` (hardcodeado, requiere edición para otros meses)
- **Detección de minificado:** Regex `^\{"[a-z]"` — detecta si el JSON empieza con `{"clave":` sin espacios
- **Salida:** Log por archivo con estado `minified=true/false`, líneas `Formatting...` y `OK:` para cada archivo procesado, y `Done.` al final

### `fmt-json.ps1` — Single-File Formatter
- **Parámetros:** `-FilePath` (ruta absoluta al archivo JSON)
- **Indentación:** 4 espacios por nivel
- **Encoding:** UTF-8 sin BOM
- **Proceso interno:**
  1. Lee el archivo con `Get-Content -Raw -Encoding UTF8`
  2. Elimina BOM si existe
  3. Convierte a objeto con `ConvertFrom-Json`
  4. Re-compacta con `ConvertTo-Json -Compress -Depth 100`
  5. Formatea con `Format-Json4` (parser carácter por carácter)
  6. Escribe con `[System.IO.File]::WriteAllText` (UTF-8 sin BOM)
- **⚠️ Reescribe el archivo in-place** — no crea copia de seguridad

## 🚨 Troubleshooting

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `Get-Content: PathNotFound` en ruta UNC | Nombre de directorio incorrecto (`ESCALETAS` en vez de `ESCALETES`) | Usar `ESCALETES` (sin S): `\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES\` |
| `powershell` no funciona en la terminal de VSCode | La terminal por defecto es `cmd.exe` o `pwsh` no está en PATH | Usar explícitamente `powershell` (Windows PowerShell 5.1) como prefijo |
| `.\[script]` se cuelga sin salida | Se intentó ejecutar un `.ps1` directamente desde `cmd.exe` sin intérprete | **Siempre** prefijar con `powershell -NoProfile -ExecutionPolicy Bypass -File` |
| `read_file` retorna ENOENT para rutas UNC | La herramienta `read_file` no puede leer rutas de red UNC (`\\...`) | Verificar visualmente en las pestañas de VSCode; los archivos se recargan automáticamente tras el formateo |
| El script no encuentra archivos | El patrón de fecha no coincide (mes/año distinto) | Editar `bin/check_and_fmt.ps1` línea 6 y cambiar `202605` por el prefijo de fecha correcto |

## 🔄 Flujo de Trabajo Diario

1. El usuario abre los 3 JSON desde la ruta de red en VSCode
2. El usuario pide formatearlos
3. Ejecutar el comando batch:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\check_and_fmt.ps1" -BaseDir "\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES"
   ```
4. Esperar salida `Done.` (exit code 0) — verificar que los 3 archivos del día muestran `OK:`
5. Confirmar al usuario que los archivos se han formateado — se recargarán automáticamente en las pestañas de VSCode

---

© 2026 FAST >>> PASS | fmt-escaletes Skill v2.1.0
