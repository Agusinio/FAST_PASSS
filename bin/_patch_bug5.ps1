$file = "js/core/escaleta_reader.js"
$txt = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# Find the unique comment line that starts Tier 1 OUT
# Search for unique substring "ltim item estructural del bloc"
$startMarker = [char]0x00DA + "ltim item estructural del bloc"
$start = $txt.IndexOf($startMarker)
if ($start -lt 0) {
    Write-Host "ERROR: start marker not found"
    exit 1
}
# Walk back to find the beginning of the // comment line
$start = $txt.LastIndexOf("`n", $start)
if ($start -lt 0) { $start = 0 } else { $start++ }

# Find end: "Tier 2: Seg" - unique enough
$endMarker = "Tier 2: Seg"
$end = $txt.IndexOf($endMarker, $start)
if ($end -lt 0) {
    Write-Host "ERROR: end marker not found"
    exit 1
}
# Walk back to beginning of that comment line
$end = $txt.LastIndexOf("`n", $end)
if ($end -lt 0) { $end = 0 } else { $end++ }

Write-Host ("Found block: start=" + $start + ", end=" + $end + ", length=" + ($end - $start))

# Build new block using string concat (NO template literals, easier to embed)
$newBlock = @'
            // Tier 1 OUT (max): sortida mes avancada de TOTS els items del bloc
            // Itera sobre tots els blockLines perque un IPD amb duradaOnAir>0
            // pot correr en paral-lel al darrer item estructural i tenir una hora
            // de sortida mes tardana (ex: IPD 30" sobre diferit).
            let maxSortidaSec = -1;
            let maxSortidaItem = null;
            for (let i = 0; i < blockLines.length; i++) {
                const item = blockLines[i];
                if (!item.horaEntradaOnAir && !this.isItemEstructural(item)) continue;
                const s = this.getItemSortidaSec(item, allLines, data);
                if (s !== null && s > maxSortidaSec) {
                    maxSortidaSec = s;
                    maxSortidaItem = item;
                }
            }
            if (maxSortidaItem) {
                worldBlockEndSec = maxSortidaSec;
                OutTier = 1;
                const refEntrada = maxSortidaItem.horaEntradaOnAir || maxSortidaItem.horaEntradaPrevista || '??';
                const refDurada  = maxSortidaItem.duradaOnAir || maxSortidaItem.durada || '?';
                log('   OK Tier1-OUT (max): "' + maxSortidaItem.num + '" sortida=' + refEntrada + '+' + refDurada + ' -> ' + worldBlockEndSec.toFixed(2) + 's');
            }

'@

$txt = $txt.Substring(0, $start) + $newBlock + $txt.Substring($end)
[System.IO.File]::WriteAllText($file, $txt, [System.Text.Encoding]::UTF8)
Write-Host "SUCCESS: Tier1-OUT replaced"
