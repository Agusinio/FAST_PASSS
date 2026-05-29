<#
.SYNOPSIS
    FAST >>> PASS — Harness Engineering Init Script
    Valida que el entorno de desarrollo esta listo para trabajar.

.DESCRIPTION
    Comprueba:
    1. Git portable en E:\PortableGit
    2. Acceso a rutas de red (NAS)
    3. PowerShell >= 5.1
    4. Skills de Roo cargadas
    5. Archivos criticos del proyecto presentes
    6. Centro de control .roo/

.EXAMPLE
    .\.roo\init.ps1
#>

param(
    [switch]$Quiet = $false
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PassCount = 0
$FailCount = 0
$WarnCount = 0

function Write-Check {
    param([string]$Label, [string]$Status, [string]$Detail = "")
    $icon = switch ($Status) {
        "PASS"  { "OK" }
        "FAIL"  { "XX" }
        "WARN"  { "!!" }
        "INFO"  { "ii" }
        default { "  " }
    }
    $color = switch ($Status) {
        "PASS"  { "Green" }
        "FAIL"  { "Red" }
        "WARN"  { "Yellow" }
        "INFO"  { "Cyan" }
        default { "White" }
    }
    $line = "$icon $Label"
    if ($Detail) { $line += "`n      $Detail" }
    Write-Host $line -ForegroundColor $color

    switch ($Status) {
        "PASS" { $script:PassCount++ }
        "FAIL" { $script:FailCount++ }
        "WARN" { $script:WarnCount++ }
    }
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  FAST >>> PASS — Harness Init v1.0.0" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# ===========================================
# 1. POWERSHELL VERSION
# ===========================================
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -ge 5) {
    Write-Check "PowerShell $psVer" "PASS"
} else {
    Write-Check "PowerShell $psVer (requiere >= 5.1)" "FAIL"
}

# ===========================================
# 2. GIT PORTABLE
# ===========================================
$gitPath = "E:\PortableGit\bin\git.exe"
if (Test-Path $gitPath) {
    $gitVer = & $gitPath --version 2>$null
    if ($gitVer) {
        Write-Check "Git Portable" "PASS" "$gitVer"
    } else {
        Write-Check "Git Portable (no ejecutable)" "FAIL" $gitPath
    }
} else {
    Write-Check "Git Portable" "FAIL" "No encontrado en: $gitPath"
}

# ===========================================
# 3. RUTAS DE RED (NAS)
# ===========================================
$nasPaths = @(
    "\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES",
    "\\nas1.ad-ccrtv.local\informatius\001 RECURSOS"
)

foreach ($nas in $nasPaths) {
    $parts = $nas -split '\\'
    $displayName = $parts[-2] + "\" + $parts[-1]
    if (Test-Path $nas) {
        Write-Check "NAS: $displayName" "PASS"
    } else {
        Write-Check "NAS: $displayName" "WARN" "Ruta no accesible (VPN?)"
    }
}

# ===========================================
# 4. SKILLS DE ROO
# ===========================================
$skillsDir = "$ProjectRoot\.roo\skills"
$expectedSkills = @("coder-genius", "fmt-escaletes", "powershell")

foreach ($skill in $expectedSkills) {
    $skillPath = "$skillsDir\$skill\SKILL.md"
    if (Test-Path $skillPath) {
        Write-Check "Skill: $skill" "PASS"
    } else {
        Write-Check "Skill: $skill" "FAIL" "SKILL.md no encontrado en $skillPath"
    }
}

# ===========================================
# 5. ARCHIVOS CRITICOS DEL PROYECTO
# ===========================================
$criticalFiles = @(
    "index.html",
    "CSXS\manifest.xml",
    "js\main.js",
    "jsx\main.jsx",
    "js\core\utils.js",
    "js\core\escaleta_config.js",
    "Profile.json",
    "package.json"
)

foreach ($file in $criticalFiles) {
    $fullPath = "$ProjectRoot\$file"
    if (Test-Path $fullPath) {
        Write-Check "Archivo: $file" "PASS"
    } else {
        Write-Check "Archivo: $file" "FAIL" "No encontrado"
    }
}

# ===========================================
# 6. CENTRO DE CONTROL .roo/
# ===========================================
$rooFiles = @(
    ".roo\agents.md",
    ".roo\features.json",
    ".roo\init.ps1"
)

foreach ($file in $rooFiles) {
    $fullPath = "$ProjectRoot\$file"
    if (Test-Path $fullPath) {
        Write-Check ".roo/: $file" "PASS"
    } else {
        Write-Check ".roo/: $file" "FAIL" "Artefacto Harness no encontrado"
    }
}

# Progress dir
$progressDir = "$ProjectRoot\.roo\progress"
if (Test-Path $progressDir) {
    $sessionCount = (Get-ChildItem $progressDir -Filter "*.md" -ErrorAction SilentlyContinue).Count
    Write-Check ".roo/progress/" "PASS" "$sessionCount sesiones registradas"
} else {
    Write-Check ".roo/progress/" "WARN" "Directorio no existe aun"
}

# ===========================================
# 7. DIRECTORIOS DE DOCS
# ===========================================
$docDirs = @(
    "docs\guides",
    "docs\specs",
    "docs\audits",
    "docs\debug",
    "docs\archive"
)

foreach ($dir in $docDirs) {
    $fullDir = "$ProjectRoot\$dir"
    if (Test-Path $fullDir) {
        Write-Check "Docs: $dir" "PASS"
    } else {
        Write-Check "Docs: $dir" "WARN" "Directorio no existe aun (se creara en migracion)"
    }
}

# ===========================================
# RESUMEN
# ===========================================
Write-Host ""
Write-Host "-------------------------------------------" -ForegroundColor Cyan
Write-Host "  RESULTADO: " -NoNewline

$total = $PassCount + $FailCount + $WarnCount
if ($FailCount -eq 0 -and $WarnCount -eq 0) {
    Write-Host "TODO OK — Entorno listo para trabajar" -ForegroundColor Green
} elseif ($FailCount -eq 0) {
    Write-Host "ADVERTENCIAS ($WarnCount) — Se puede trabajar con precaucion" -ForegroundColor Yellow
} else {
    Write-Host "FALLOS ($FailCount) — Corrige los errores antes de continuar" -ForegroundColor Red
}

Write-Host "   $PassCount pasados | $FailCount fallos | $WarnCount avisos | $total total"
Write-Host "-------------------------------------------" -ForegroundColor Cyan
Write-Host ""

exit $FailCount
