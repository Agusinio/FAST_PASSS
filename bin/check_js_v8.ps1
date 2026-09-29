<#
    check_js_v8.ps1 — Validador de SINTAXI REAL del panell (motor V8 del navegador).
    ============================================================================
    Per qué existeix: bin/check_js_balance.ps1 només compta claudàtors i NO entén
    els template literals (`...`) — un apòstrof dins d'un template (p. ex. "s'ha")
    el fa esclatar amb un fals DESEQUILIBRI (mesurat: flow_chyrons.js L353).
    Aquí es COMPILA cada fitxer amb el mateix motor JS que fa servir el CEF de CEP
    (Chromium/V8) via `new Function(src)`: no s'executa res, així que qualsevol
    SyntaxError és un error REAL de sintaxi.

    Ús:
        powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\check_js_v8.ps1
        powershell ... -File .\bin\check_js_v8.ps1 -ShowOk      # llista també els OK

    Sortida: una línia per fitxer FAIL (amb el missatge del motor) + resum.
    Exit code: 0 = tot OK · 1 = hi ha FAIL · 2 = error d'entorn (sense navegador).
    Per desar la sortida en un fitxer llegible des d'altres eines:
        ... -File .\bin\check_js_v8.ps1 | Out-File -Encoding utf8 C:\temp\fp_v8.txt
#>
param(
    [string]$BaseDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$ShowOk
)

$ErrorActionPreference = 'Stop'
$jsDir  = Join-Path $BaseDir 'js'
$jsxDir = Join-Path $BaseDir 'jsx'

$files = @()
$files += (Get-ChildItem $jsDir  -Recurse -File | Where-Object { $_.Extension -eq '.js'  } | ForEach-Object { $_.FullName })
$files += (Get-ChildItem $jsxDir -Recurse -File | Where-Object { $_.Extension -eq '.jsx' } | ForEach-Object { $_.FullName })
if ($files.Count -eq 0) { Write-Host 'CAP FITXER a validar.'; exit 2 }

$manifestPath = Join-Path $env:TEMP 'fp_manifest.json'
$htmlPath     = Join-Path $env:TEMP 'fp_syntax.html'
$domPath      = Join-Path $env:TEMP 'fp_dom.txt'
$errPath      = Join-Path $env:TEMP 'fp_err.txt'
[System.IO.File]::WriteAllText($manifestPath, (ConvertTo-Json $files -Compress))

$manifestUrl = 'file:///' + ($manifestPath -replace '\\', '/')
$html = @'
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>running</title></head>
<body><pre id="out">pending</pre>
<script>
// Compila cada fitxer amb V8 (new Function) sense executar-lo. Els .jsx es netegen
// de directives '#target/#include' que V8 no reconeix (la resta d'ES3 es ES5 valid).
(async function () {
    const out = document.getElementById('out');
    const lines = [];
    let ok = 0, bad = 0;
    try {
        const paths = JSON.parse(await (await fetch('__MANIFEST_URL__')).text());
        for (const p of paths) {
            const url = 'file:///' + p.replace(/\\/g, '/');
            const short = p.split('\\').slice(-2).join('/');
            try {
                let src = await (await fetch(url)).text();
                if (/\.jsx$/i.test(p)) { src = src.replace(/^[ \t]*#.*$/gm, ''); }
                try { new Function(src); ok++; lines.push('OK   ' + short); }
                catch (e) { bad++; lines.push('FAIL ' + short + ' :: ' + e.message); }
            } catch (e2) { bad++; lines.push('FETCHFAIL ' + short + ' :: ' + e2.message); }
        }
    } catch (eMan) { lines.push('MANIFEST-FAIL :: ' + eMan.message); }
    lines.push('TOTAL ' + (ok + bad) + ' | OK ' + ok + ' | FAIL ' + bad);
    out.textContent = lines.join('\n');
    document.title = 'DONE ok=' + ok + ' bad=' + bad;
})();
</script></body></html>
'@
[System.IO.File]::WriteAllText($htmlPath, $html.Replace('__MANIFEST_URL__', $manifestUrl))

$browser = $null
foreach ($b in @(
        'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
        'C:\Program Files\Google\Chrome\Application\chrome.exe')) {
    if (Test-Path $b) { $browser = $b; break }
}
if (-not $browser) { Write-Host 'SENSE NAVEGADOR (Edge/Chrome): no es pot validar.'; exit 2 }

$bArgs = @(
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--allow-file-access-from-files', ("--user-data-dir=" + (Join-Path $env:TEMP 'fp_jsv8_profile')),
    '--virtual-time-budget=30000', '--dump-dom', ('file:///' + ($htmlPath -replace '\\', '/'))
)
Remove-Item $domPath, $errPath -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $browser -ArgumentList $bArgs -Wait -PassThru -RedirectStandardOutput $domPath -RedirectStandardError $errPath
$dom = [System.IO.File]::ReadAllText($domPath)
$m = [regex]::Match($dom, '(?s)<pre id="out">(.*?)</pre>')
if (-not $m.Success) { Write-Host ('SENSE RESPOSTA DEL NAVEGADOR (' + $browser + ', exit ' + $proc.ExitCode + ').'); exit 2 }

$lines = $m.Groups[1].Value -split "`n" | ForEach-Object { $_.TrimEnd() }
Write-Host ('VALIDADOR: ' + $browser)
Write-Host ('FITXERS:   ' + $files.Count)
foreach ($l in $lines) {
    if ($l -like 'FAIL*' -or $l -like 'FETCHFAIL*' -or $l -like 'MANIFEST-FAIL*') { Write-Host $l }
    elseif ($ShowOk -and $l -like 'OK*') { Write-Host $l }
}
$summary = $lines | Where-Object { $_ -like 'TOTAL*' }
if ($summary) { Write-Host $summary }
$fails = ($lines | Where-Object { $_ -like 'FAIL*' -or $_ -like 'FETCHFAIL*' }).Count
exit $(if ($fails -gt 0) { 1 } else { 0 })
