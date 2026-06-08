<#
.SYNOPSIS
    Extrae todas las conversaciones de Roo Code del VSCode portable
    y crea un documento resumen consolidado en docs/.
#>

param(
    [string]$TaskDir = "E:\AAA_VSCode_4_WIN\data\user-data\User\globalStorage\rooveterinaryinc.roo-cline\tasks",
    [string]$OutputDir = "docs\conversations"
)

$RootDir = $PWD.Path
$OutputDirFull = Join-Path $RootDir $OutputDir
if (-not (Test-Path $OutputDirFull)) {
    New-Item -ItemType Directory -Path $OutputDirFull -Force | Out-Null
}

# Leer índice
$indexPath = Join-Path $TaskDir "_index.json"
$index = Get-Content $indexPath -Raw | ConvertFrom-Json

Write-Host "Encontradas $($index.entries.Count) conversaciones en el índice."

$allSummaries = @()

foreach ($entry in $index.entries) {
    $taskId = $entry.id
    $taskFolder = Join-Path $TaskDir $taskId
    
    if (-not (Test-Path $taskFolder)) {
        Write-Host "  [!] Carpeta no encontrada: $taskId"
        continue
    }

    # Leer api_conversation_history.json
    $convPath = Join-Path $taskFolder "api_conversation_history.json"
    if (-not (Test-Path $convPath)) {
        Write-Host "  [!] No tiene conversation history: $taskId"
        continue
    }

    Write-Host "  Procesando: $taskId ($($entry.task.Substring(0, [Math]::Min(80, $entry.task.Length))))..."

    try {
        $conv = Get-Content $convPath -Raw | ConvertFrom-Json
        
        $messages = @()
        $userMessages = @()
        $assistantMessages = @()

        foreach ($msg in $conv) {
            if ($msg.role -eq "user") {
                $text = ""
                foreach ($c in $msg.content) {
                    if ($c.type -eq "text") {
                        $text += $c.text
                    }
                }
                # Extraer solo el texto del usuario (dentro de <user_message>)
                if ($text -match '<user_message>\s*\n(.*?)\n\s*</user_message>') {
                    $userText = $Matches[1]
                } elseif ($text -match '<user_query>\s*\n(.*?)\n\s*</user_query>') {
                    $userText = $Matches[1]
                } else {
                    # Intentar extraer después de <user_message> sin cierre
                    if ($text -match '<user_message>(.*)$') {
                        $userText = $Matches[1]
                    } else {
                        $userText = $text.Substring(0, [Math]::Min(2000, $text.Length))
                    }
                }
                if ($userText.Trim()) {
                    $userMessages += $userText.Trim()
                }
            }
        }

        $date = ""
        if ($entry.ts) {
            $date = ([DateTimeOffset]::FromUnixTimeMilliseconds($entry.ts)).DateTime.ToString("yyyy-MM-dd HH:mm")
        }

        $summary = @"
### $(if($entry.task.Length -gt 100){$entry.task.Substring(0,100) + "..."}else{$entry.task})
- **ID**: `$taskId`
- **Fecha**: $date
- **Modo**: $($entry.mode)
- **Workspace**: $($entry.workspace)
- **Mensajes del usuario**: $($userMessages.Count)
- **Tokens in**: $($entry.tokensIn.ToString("N0"))
- **Tokens out**: $($entry.tokensOut.ToString("N0"))
- **Coste total**: $($entry.totalCost.ToString("C2"))

"@

        # Añadir los mensajes del usuario
        if ($userMessages.Count -gt 0) {
            $summary += "`n#### Mensajes del usuario:`n`n"
            foreach ($um in $userMessages) {
                # Limitar cada mensaje a 500 caracteres para el resumen
                if ($um.Length -gt 500) {
                    $summary += "- " + $um.Substring(0, 500).Replace("`n", "`n  ") + "...`n`n"
                } else {
                    $summary += "- " + $um.Replace("`n", "`n  ") + "`n`n"
                }
            }
        }

        $summary += "---`n"
        $allSummaries += $summary

    } catch {
        Write-Host "  [X] Error procesando $taskId : $_"
    }
}

# Generar documento consolidado
$outputPath = Join-Path $OutputDirFull "ROO_CONVERSATIONS_SUMMARY.md"
$now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$doc = @"
# 📜 Historial de Conversaciones con Roo Code — FAST >>> PASS

> **Generado**: $now
> **Fuente**: VSCode Portable en `E:\AAA_VSCode_4_WIN\data\user-data\User\globalStorage\rooveterinaryinc.roo-cline\tasks\`
> **Total de conversaciones**: $($allSummaries.Count)

---

## 📊 Resumen rápido

| # | Fecha | Modo | Tema |
|---|-------|------|------|
"@

foreach ($entry in $index.entries) {
    $date = ""
    if ($entry.ts) {
        $date = ([DateTimeOffset]::FromUnixTimeMilliseconds($entry.ts)).DateTime.ToString("yyyy-MM-dd")
    }
    $taskShort = if ($entry.task.Length -gt 80) { $entry.task.Substring(0, 80) + "..." } else { $entry.task }
    $doc += "| $($entry.number) | $date | $($entry.mode) | $($taskShort -replace '\n',' ' -replace '\|',' ') |`n"
}

$doc += @"

---

## 📋 Detalle por conversación

"@

$doc += $allSummaries -join "`n"

$doc += @"

---

*Documento generado automáticamente por `bin/extract_roo_conversations.ps1`*
"@

Set-Content -Path $outputPath -Value $doc -Encoding UTF8
Write-Host ""
Write-Host "=== RESUMEN CONSOLIDADO GUARDADO EN ==="
Write-Host "  $outputPath"
Write-Host "  Tamaño: $((Get-Item $outputPath).Length.ToString('N0')) bytes"