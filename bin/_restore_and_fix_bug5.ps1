# _restore_and_fix_bug5.ps1
# Restaura el cuerpo perdido de calcPrecisionTrimBounds y aplica BUG #5 en Tier 1 OUT.
# Reemplaza el fragmento dañado entre la línea 727 (fin JSDoc OUT) y la línea 750 (Tier 2).

$file = "js/core/escaleta_reader.js"

$content = Get-Content -Raw -Encoding UTF8 $file

# Marcadores unicos para localizar las zonas de corte
$markerJSDocEnd = "* ── Per al FINAL (OUT): 2 TIERS + FALLBACK ──"
$markerTier2    = "// ── Tier 2: Seg"   # "Següent OnAir disponible..."

# Verificar que los marcadores existen
if ($content.IndexOf($markerJSDocEnd) -lt 0) {
    Write-Error "NO se encontro marcador JSDoc end"
    exit 1
}
if ($content.IndexOf($markerTier2) -lt 0) {
    Write-Error "NO se encontro marcador Tier2"
    exit 1
}

# Separar en 3 partes: antes de JSDoc end, zona danada, desde Tier2 en adelante
$idxJSDocEnd = $content.IndexOf($markerJSDocEnd) + $markerJSDocEnd.Length
$idxTier2    = $content.IndexOf($markerTier2)

$before = $content.Substring(0, $idxJSDocEnd)
$after  = $content.Substring($idxTier2)

# --- BLOQUE RECONSTRUIDO: cierre JSDoc + cuerpo funcion + IN tiers + OUT Tier 1 (BUG #5 fix) ---
$replacement = @'

         */

        calcPrecisionTrimBounds: function (data, blockId, mediaStart, mediaStop, config) {
            const blockLines = this.getLinesForBlock(data, blockId);
            const allLines = data.escaleta && data.escaleta.liniesEscaleta ? data.escaleta.liniesEscaleta : [];
            const handles = config && config.handles != null ? config.handles : 60;
            const inHandlesSec  = handles;
            const outHandlesSec = handles;

            const worldSecMediaStart = this.tcToSeconds(mediaStart);
            const worldSecMediaStop  = this.tcToSeconds(mediaStop);

            if (!blockLines || blockLines.length === 0) {
                log('No es pot determinar el bloc ' + blockId + ': sense linies d''escaleta', 'ERROR');
                return null;
            }

            const blockStartIdx = allLines.indexOf(blockLines[0]);
            const blockEndIdx   = allLines.indexOf(blockLines[blockLines.length - 1]);

            // ================================================================
            // IN: worldBlockStartSec
            // ================================================================
            let worldBlockStartSec = null;
            let InTier = 0;
            let worldBlockAnchorSec = null;

            // ── Tier 0 (IN): Video previ amb OnAir + caretes intermedies ──
            // Construeix llista de tots els items amb video+OnAir, ordenats per temps
            const allOnAirVideos = [];
            for (let i = 0; i < allLines.length; i++) {
                const l = allLines[i];
                if (l.flotant === true) continue;
                if (l.teVideo === true && l.horaEntradaOnAir) {
                    const startSec = this.tcToSeconds(l.horaEntradaOnAir);
                    const durSec = this.parseDurada(l.duradaOnAir || l.durada);
                    allOnAirVideos.push({ item: l, idx: i, startSec, endSec: startSec + durSec });
                }
            }
            allOnAirVideos.sort((a, b) => a.startSec - b.startSec);

            // Buscar el video mes proper que acabe abans del primer item del bloc
            const firstBlockItem = blockLines[0];
            const blockRefSec = firstBlockItem && firstBlockItem.horaEntradaPrevista
                ? this.tcToSeconds(firstBlockItem.horaEntradaPrevista)
                : null;

            let prevVideoData = null;
            if (blockRefSec !== null) {
                for (const vid of allOnAirVideos) {
                    if (vid.endSec < blockRefSec) {
                        if (!prevVideoData || vid.endSec > prevVideoData.endSec) {
                            prevVideoData = vid;
                        }
                    }
                }
            }

            if (prevVideoData) {
                const gap = blockRefSec - prevVideoData.endSec;
                const hasNonVideoIntro = this.hasNonVideoItemsBefore(data, blockId).before;
                const maxGap = hasNonVideoIntro ? 120 : 15;

                if (gap <= maxGap) {
                    worldBlockStartSec = prevVideoData.endSec;
                    InTier = 10;
                    log('   Tier0-IN: item anterior "' + prevVideoData.item.num + '" acaba a ' + worldBlockStartSec.toFixed(2) + 's');

                    // Buscar caretas entre el video previ i el bloc
                    const caretas = this._findCaretasBetween(allLines, prevVideoData.idx, blockStartIdx, data);
                    if (caretas.totalDur > 0) {
                        worldBlockStartSec += caretas.totalDur;
                        log('   Tier0-IN: +' + caretas.totalDur + 's per caretes (' + caretas.names.join(', ') + ') -> ' + worldBlockStartSec.toFixed(2) + 's');
                    }
                } else {
                    log('   Tier0-IN: gap=' + gap.toFixed(0) + 's > maxGap=' + maxGap + 's. Usant Tier1.');
                }
            }

            // ── Tier 1 (IN): Primer item estructural del bloc ──
            const structuralItemsInBlock = blockLines.filter(l => this.isItemEstructural(l));

            if (InTier === 0 && structuralItemsInBlock.length > 0) {
                const firstItem = structuralItemsInBlock[0];
                const entradaSec = this.getItemEntradaSec(firstItem, allLines, data);
                if (entradaSec !== null) {
                    worldBlockStartSec = entradaSec;
                    InTier = 1;
                    worldBlockAnchorSec = entradaSec;
                    log('   Tier1-IN: "' + firstItem.num + '" entrada -> ' + worldBlockStartSec.toFixed(2) + 's');
                } else if (structuralItemsInBlock.length > 0) {
                    const lastResort = structuralItemsInBlock[structuralItemsInBlock.length - 1];
                    const resortSec = this.getItemEntradaSec(lastResort, allLines, data);
                    if (resortSec !== null) {
                        worldBlockStartSec = resortSec;
                        InTier = 1;
                        worldBlockAnchorSec = resortSec;
                        log('   Tier1-IN (last resort): "' + lastResort.num + '" entrada -> ' + worldBlockStartSec.toFixed(2) + 's');
                    }
                }
            }

            // ── Fallback (IN): block.in ──
            if (InTier === 0) {
                const block = this.getBlock(data, blockId);
                if (block && block.in) {
                    worldBlockStartSec = this.tcToSeconds(block.in);
                    InTier = -1;
                    log('   Fallback-IN: usant block.in="' + block.in + '" -> ' + worldBlockStartSec.toFixed(2) + 's');
                } else {
                    log('No es pot determinar l''inici del bloc ' + blockId, 'ERROR');
                    return null;
                }
            }

            // ================================================================
            // OUT: worldBlockEndSec
            // ================================================================
            let worldBlockEndSec = null;
            let OutTier = 0;

            // Tier 1 OUT (max): sortida mes avancada de TOTS els items del bloc
            // Itera sobre tots els blockLines perque un IPD amb duradaOnAir>0
            // pot correr en paral·lel al darrer item estructural i tenir una hora
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
                log('   Tier1-OUT (max): "' + maxSortidaItem.num + '" sortida=' + refEntrada + '+' + refDurada + ' -> ' + worldBlockEndSec.toFixed(2) + 's');
            }

'@

# Ensamblar archivo reconstruido
$restored = $before + $replacement + $after

# Guardar
Set-Content -Path $file -Value $restored -Encoding UTF8 -NoNewline

Write-Host "Archivo restaurado correctamente. Total: $($restored.Split("`n").Count) lineas."
