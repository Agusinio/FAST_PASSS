<#
    build_graph.ps1 - Regenera les DADES del mapa de dependencies del codi.
    ============================================================================
    Escriu NOMES el contingut del bloc
        <script id="fp-src" type="application/json"> ... </script>
    de docs/graph/DEPENDENCIES.html: un JSON amb el CODI FONT real (escapant
    '<' com \u003c per no trencar l'HTML) de cada fitxer que carrega l'extensio.
    El MOTOR de la pagina (parser de funcions, graf, filtres, diagnostic) viu
    dins la mateixa pagina i aquest script no el toca mai.

    Autoritats de carrega (les mateixes que check_dead.ps1; no hi ha carregador
    dinamic):
      - js/  -> index.html, llista <script src="js/...">
      - jsx/ -> jsx/main.jsx, crides load("X.jsx")
    Tambe inclou els fitxers de js/ i jsx/ que NINGU carrega: al mapa hi
    apareixeran com a nodes no abastables (codi mort visible a l'instant).

    Us:
        powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\build_graph.ps1"
        ... -Open      # obre la pagina al navegador al final

    Sortida: resum per consola. Exit code: 0 = OK, 2 = error d'entorn.
#>
param(
    [string]$BaseDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$Open
)

$ErrorActionPreference = 'Stop'

$jsDir    = Join-Path $BaseDir 'js'
$jsxDir   = Join-Path $BaseDir 'jsx'
$htmlPath = Join-Path $BaseDir 'index.html'
$mainJsx  = Join-Path $jsxDir 'main.jsx'
$page     = Join-Path $BaseDir 'docs\graph\DEPENDENCIES.html'

foreach ($p in @($jsDir, $jsxDir, $htmlPath, $mainJsx, $page)) {
    if (!(Test-Path -LiteralPath $p)) { Write-Host ('FALTA: ' + $p); exit 2 }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-Tier([string]$p) {
    if ($p -eq 'index.html')        { return 'HTML' }
    if ($p -like 'jsx/*')           { return 'JSX' }
    if ($p -like 'js/workflows/*')  { return 'WORKFLOW' }
    if ($p -like 'js/logic/*')      { return 'LOGIC' }
    if ($p -like 'js/inspectors/*') { return 'INSPECTOR' }
    if ($p -like 'js/core/*')       { return 'CORE' }
    return 'UI'
}

# --- 1. Autoritats de carrega -----------------------------------------------
$loadedJs = @()
foreach ($m in (Select-String -Path $htmlPath -Pattern 'src="(js/[^"?]+)' -AllMatches).Matches) {
    $p = $m.Groups[1].Value -replace '\\', '/'
    if ($p -like 'js/lib/*') { continue }          # vendor (CSInterface), no es dibuixa
    if ($loadedJs -notcontains $p) { $loadedJs += $p }
}

$loadedJsx = @()
foreach ($m in (Select-String -Path $mainJsx -Pattern 'load\("([^"]+)"\)' -AllMatches).Matches) {
    $loadedJsx += $m.Groups[1].Value
}


# --- 2. Inventari de disc (i noms carregats que no existeixin) ---------------
$diskJs = @(Get-ChildItem -LiteralPath $jsDir -Recurse -File -Filter '*.js' |
    ForEach-Object { $_.FullName.Substring($BaseDir.Length + 1) -replace '\\', '/' })
$diskJsx = @(Get-ChildItem -LiteralPath $jsxDir -Recurse -File -Filter '*.jsx' |
    ForEach-Object { $_.FullName.Substring($BaseDir.Length + 1) -replace '\\', '/' })

$missing = @()
foreach ($p in $loadedJs)  { if (!(Test-Path -LiteralPath (Join-Path $BaseDir $p))) { $missing += $p } }
$jsxPaths = @('jsx/main.jsx')
foreach ($n in $loadedJsx) {
    $hit = @($diskJsx | Where-Object { (Split-Path -Leaf $_) -eq $n })
    if ($hit.Count -eq 0) { $missing += $n; continue }
    foreach ($h in $hit) { if ($jsxPaths -notcontains $h) { $jsxPaths += $h } }
}

$extraJs  = @($diskJs  | Where-Object { $loadedJs -notcontains $_ -and $_ -notlike 'js/lib/*' })
$extraJsx = @($diskJsx | Where-Object { $jsxPaths -notcontains $_ })

$paths = @('index.html') + $loadedJs + $extraJs + $jsxPaths + $extraJsx

# --- 3. Llegeix el codi i munta el JSON --------------------------------------
$files = @()
foreach ($p in $paths) {
    $abs = Join-Path $BaseDir $p
    if (!(Test-Path -LiteralPath $abs)) { continue }
    $code = [System.IO.File]::ReadAllText($abs, $utf8)
    $files += [pscustomobject]@{ path = $p; tier = (Get-Tier $p); code = $code }
}

$obj = [pscustomobject]@{
    meta = [pscustomobject]@{
        generated = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        root      = $BaseDir
        source    = 'bin/build_graph.ps1'
        files     = $files.Count
    }
    files = @($files)
}
try   { $json = $obj | ConvertTo-Json -Depth 8 -Compress }
catch { Write-Host ('ERROR serialitzant el JSON: ' + $_.Exception.Message); exit 2 }
if ($json.Length -lt 50) { Write-Host 'ERROR: el JSON surt buit.'; exit 2 }

# '<' dins el JSON trencaria el <script> -> s'escapa com \u003c
$json = $json -replace '<', '\u003c'
try   { $null = $json | ConvertFrom-Json }
catch { Write-Host ('ERROR: el JSON generat no valida: ' + $_.Exception.Message); exit 2 }

# --- 4. Injeccio al bloc fp-src de la pagina ---------------------------------
$tag  = '<script id="fp-src" type="application/json">'
$html = [System.IO.File]::ReadAllText($page, $utf8)
$i1 = $html.IndexOf($tag)
if ($i1 -lt 0) { Write-Host ('ERROR: no trobo el bloc fp-src a ' + $page); exit 2 }
$i2 = $html.IndexOf('</script>', $i1 + $tag.Length)
if ($i2 -lt 0) { Write-Host 'ERROR: el bloc fp-src no te tancament.'; exit 2 }
$new = $html.Substring(0, $i1) + $tag + $json + $html.Substring($i2)
[System.IO.File]::WriteAllText($page, $new, $utf8)

# --- 5. Resum -----------------------------------------------------------------
$kb = [math]::Round($json.Length / 1024, 1)
Write-Host ('MAPA: ' + $files.Count + ' fitxers injectats (' + $kb + ' KB de JSON)')
foreach ($t in @('HTML', 'UI', 'WORKFLOW', 'LOGIC', 'INSPECTOR', 'CORE', 'JSX')) {
    $n = @($files | Where-Object { $_.tier -eq $t }).Count
    if ($n -gt 0) { Write-Host ('  ' + $t.PadRight(10) + $n.ToString().PadLeft(3) + ' fitxers') }
}
if ($extraJs.Count -gt 0 -or $extraJsx.Count -gt 0) {
    Write-Host ('AVIS: ' + ($extraJs.Count + $extraJsx.Count) + ' fitxers que NINGU carrega (sortiran com a codi mort al mapa):')
    foreach ($p in ($extraJs + $extraJsx)) { Write-Host ('  NO CARREGAT  ' + $p) }
}
if ($missing.Count -gt 0) {
    Write-Host ('AVIS: carregats pero INEXISTENTS: ' + ($missing -join ', '))
}
Write-Host ('Pagina: ' + $page)
if ($Open) { Start-Process $page }
exit 0
