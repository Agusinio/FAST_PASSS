param([string]$Path = ".\js\workflows\flow_assembly.js")
$txt = [System.IO.File]::ReadAllText((Resolve-Path $Path))

# Fix 1: Add _classifyItems call after prefixToItem
$old1 = "for (var ii = 0; ii < manifestItems.length; ii++) {`n                var mItem = manifestItems[ii];`n                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;`n            }`n`n            var _extractPrefix = function (comment) {"
$new1 = "for (var ii = 0; ii < manifestItems.length; ii++) {`n                var mItem = manifestItems[ii];`n                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;`n            }`n`n            var classData = this._classifyItems(lines);`n            var structuralItems = classData.structuralItems;`n`n            var _extractPrefix = function (comment) {"
if ($txt.Contains("var mItem = manifestItems[ii];")) {
    $txt = $txt.Replace($old1, $new1)
    Write-Host "Fix 1 OK: _classifyItems added"
}

# Fix 2: CAPA1e dir fallback
$old2 = "if (rp2.suffix !== 'dir') continue;`n                if (!(rp2.prefix in finalTimes)) continue;`n                var dirPos = finalTimes[rp2.prefix];"
$new2 = "if (rp2.suffix !== 'dir') continue;`n                var dirPos = (rp2.prefix in finalTimes) ? finalTimes[rp2.prefix] : rp2.time;`n                if (typeof dirPos !== 'number' || isNaN(dirPos)) continue;"
if ($txt.Contains("if (rp2.suffix !== 'dir')")) {
    $txt = $txt.Replace($old2, $new2)
    Write-Host "Fix 2 OK: dir fallback"
}

# Fix 3: Generic previsto snap (±5s)
$old3 = "if (!placed) {`n                    remaining.push({ mk: mk1, prefix: prefix, suffix: suffix, time: mkTime, item: item });`n                }`n            }`n`n            // ── CAPA 1d): dp snap"
$new3 = "else if (suffix === '' && duradaSec > 0) {`n                    var bestBreakPre = _findBestBreak(mkTime, mkTime - 5, mkTime + 5);`n                    if (bestBreakPre !== null) {`n                        finalTimes[prefix] = bestBreakPre;`n                        placed = true;`n                        log('   🔵 [F4·CAPA1·PREVISTO] ' + prefix + ': ' + mkTime.toFixed(2) + 's → break ' + bestBreakPre.toFixed(2) + 's (previsto generic)');`n                    }`n                }`n`n                if (!placed) {`n                    remaining.push({ mk: mk1, prefix: prefix, suffix: suffix, time: mkTime, item: item });`n                }`n            }`n`n            // ── CAPA 1d2): dp snap"
if ($txt.Contains("// ── CAPA 1d): dp snap")) {
    $txt = $txt.Replace($old3, $new3)
    Write-Host "Fix 3 OK: previsto generic snap"
}

[System.IO.File]::WriteAllText((Resolve-Path $Path), $txt)
Write-Host "Done."