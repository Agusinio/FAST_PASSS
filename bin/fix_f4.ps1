$path = (Resolve-Path ".\js\workflows\flow_assembly.js").Path
$txt = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

# Fix 1: Add _classifyItems call in snapFaroMarkers (only the one after prefixToItem)
# The pattern is unique: "if (mItem.num) prefixToItem" followed by closing braces then "_extractPrefix"
$old1 = @"
            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var _extractPrefix = function (comment) {
"@
$new1 = @"
            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var classData = this._classifyItems(lines);
            var structuralItems = classData.structuralItems;

            var _extractPrefix = function (comment) {
"@
if ($txt.Contains("var mItem = manifestItems[ii];")) {
    $txt = $txt.Replace($old1, $new1)
    Write-Host "Fix 1 OK"
} else { Write-Host "Fix 1: pattern not found" }

# Fix 2: dir fallback - relax the condition
$old2 = @"
                if (rp2.suffix !== 'dir') continue;
                if (!(rp2.prefix in finalTimes)) continue;
                var dirPos = finalTimes[rp2.prefix];
"@
$new2 = @"
                if (rp2.suffix !== 'dir') continue;
                var dirPos = (rp2.prefix in finalTimes) ? finalTimes[rp2.prefix] : rp2.time;
                if (typeof dirPos !== 'number' || isNaN(dirPos)) continue;
"@
if ($txt.Contains("if (rp2.suffix !== 'dir')")) {
    $txt = $txt.Replace($old2, $new2)
    Write-Host "Fix 2 OK"
} else { Write-Host "Fix 2: pattern not found" }

# Fix 3: Generic previsto snap - add before the final if (!placed)
$old3 = @"
                if (!placed) {
                    remaining.push({ mk: mk1, prefix: prefix, suffix: suffix, time: mkTime, item: item });
                }
            }

            // ── CAPA 1d): dp snap
"@
$new3 = @"
                else if (suffix === '' && duradaSec > 0) {
                    var bestBreakPre = _findBestBreak(mkTime, mkTime - 5, mkTime + 5);
                    if (bestBreakPre !== null) {
                        finalTimes[prefix] = bestBreakPre;
                        placed = true;
                        log('   🔵 [F4·CAPA1·PREVISTO] ' + prefix + ': ' + mkTime.toFixed(2) + 's → break ' + bestBreakPre.toFixed(2) + 's (previsto generic)');
                    }
                }

                if (!placed) {
                    remaining.push({ mk: mk1, prefix: prefix, suffix: suffix, time: mkTime, item: item });
                }
            }

            // ── CAPA 1d2): dp snap
"@
if ($txt.Contains("// ── CAPA 1d): dp snap")) {
    $txt = $txt.Replace($old3, $new3)
    Write-Host "Fix 3 OK (replaced dp snap header too)"
} else { Write-Host "Fix 3: pattern not found" }

[System.IO.File]::WriteAllText($path, $txt, [System.Text.Encoding]::UTF8)
Write-Host "Done."