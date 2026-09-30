<#
    rep.ps1 — Executa una comanda i deixa la sortida SENCERA en un fitxer, amb la consola neta.
    Evita la contaminació/truncament de sortides llargues: sempre es llegeix del fitxer.

    Ús:
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\rep.ps1" -Nom context -Cmd "Select-String -LiteralPath 'js\core\4_Context.js' -Pattern 'checkContext'"
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\rep.ps1" -Nom git -Cmd "& 'E:\PortableGit\bin\git.exe' -C (Get-Location) status --short"

    Paràmetres:
      -Nom  nom del fitxer de sortida (sense extensió)
      -Cmd  comanda PowerShell a executar (s'executa amb el repo com a directori actual)

    Sortida: C:\temp\fp\<Nom>.txt
#>
param(
    [Parameter(Mandatory = $true)][string]$Nom,
    [Parameter(Mandatory = $true)][string]$Cmd
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$outDir = 'C:\temp\fp'
if (!(Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$out = Join-Path $outDir (($Nom -replace '[^a-zA-Z0-9_\-]', '_') + '.txt')

Push-Location -LiteralPath $root
try {
    $res = & ([scriptblock]::Create($Cmd)) 2>&1
}
finally {
    Pop-Location
}

$lines = @($res | ForEach-Object { if ($_ -is [string]) { $_ } else { ($_ | Out-String).TrimEnd() } })
[System.IO.File]::WriteAllLines($out, $lines)

Write-Host ("{0} linies -> {1}" -f $lines.Count, $out)
if ($lines.Count -gt 120) { Write-Host 'Sortida gran: llegeix el fitxer amb start_line/end_line' }
