param(
    [Parameter(Mandatory=$true)][string]$File
)
# Validador de balance de {}, (), [] per a fitxers JS
# Ignora comentaris (/* */, //) i strings ('...', "...") incloent escapes i regex /.../
$c = [System.IO.File]::ReadAllText($File)
$lines = Get-Content $File

# Linia inicial de cada posicio (per a diagnosi)
$lineOf = New-Object int[] $c.Length
$li = 0
for ($i = 0; $i -lt $c.Length; $i++) {
    if ($c[$i] -eq [char]10) { $li++ }
    $lineOf[$i] = $li
}

$stack = [System.Collections.Generic.List[object]]::new()
$pairs = @{ '{' = '}'; '(' = ')'; '[' = ']' }
$inStr = $null
$inComment = $false
$err = 0

for ($i = 0; $i -lt $c.Length; $i++) {
    $ch = [string]$c[$i]
    $nxt = if ($i + 1 -lt $c.Length) { [string]$c[$i + 1] } else { '' }

    if ($inComment) {
        if ($ch -eq '*' -and $nxt -eq '/') { $inComment = $false; $i++ }
        continue
    }
    if ($inStr) {
        if ($ch -eq [string][char]92) { $i++ }               # escape \x
        elseif ($ch -eq $inStr) { $inStr = $null }           # tanca string
        continue
    }
    if ($ch -eq '/' -and $nxt -eq '/') {                     # comentari de linia
        while ($i -lt $c.Length -and [string]$c[$i] -ne [string][char]10) { $i++ }
        continue
    }
    if ($ch -eq '/' -and $nxt -eq '*') { $inComment = $true; $i++; continue }
    if ($ch -eq "'" -or $ch -eq '"') { $inStr = $ch; continue }

    if ($pairs.ContainsKey($ch)) {
        $stack.Add(@{ ch = $ch; line = ($lineOf[$i] + 1) })
    } elseif ($pairs.Values -contains $ch) {
        if ($stack.Count -eq 0) {
            Write-Host ("CIERRE SIN APERTURA: [$ch] a la linia " + ($lineOf[$i] + 1))
            $err = 1; break
        }
        $top = $stack[$stack.Count - 1]
        if ($pairs[$top.ch] -eq $ch) { $stack.RemoveAt($stack.Count - 1) }
        else {
            Write-Host ("DESEQUILIBRIO a la linia " + ($lineOf[$i] + 1) + ": cierre [$ch], tope [" + $top.ch + "] (linia " + $top.line + ")")
            $err = 1; break
        }
    }
}

Write-Host ("=== PENDENTS: " + $stack.Count + " ===")
for ($s = $stack.Count - 1; $s -ge 0; $s--) {
    Write-Host ("  -> [" + $stack[$s].ch + "] obert a la linia " + $stack[$s].line)
}
if ($err -eq 0 -and $stack.Count -eq 0) { Write-Host "BALANCE OK" }
exit $err
