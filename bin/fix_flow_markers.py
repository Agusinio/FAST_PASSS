import sys
path = r'.\js\workflows\flow_markers.js'
with open(path, 'r', encoding='utf-8') as f:
    txt = f.read()

fixes_applied = 0

# Fix 2: F2 - Add D10 (1r item a 00:00) before the structuralItems loop
old2 = '''            var placements = [];

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                if (hasOnAir) continue; // F1 ja l'ha col·locat'''
new2 = '''            var placements = [];
            var itemPositions = new Map();

            // \u2500\u2500 D10\u00b7F2: For\u00e7ar marcador del 1r \u00edtem a 00:00 si no existeix \u2500\u2500
            if (structuralItems.length > 0) {
                var firstItem = structuralItems[0];
                var firstNum = firstItem.num;
                if (firstNum) {
                    var markersRaw2 = await callJSX('Markers.get()');
                    var allMarkers2 = [];
                    try { allMarkers2 = JSON.parse(markersRaw2); } catch (e) {}
                    var hasFirstItemMarker = false;
                    for (var mi2 = 0; mi2 < allMarkers2.length; mi2++) {
                        var mk2 = allMarkers2[mi2];
                        if (typeof mk2.time === 'number' && Math.abs(mk2.time) < 0.02) {
                            var mkPrefix2 = '';
                            var mkComment2 = mk2.comments || '';
                            var spaceDashIdx2 = mkComment2.indexOf(' -');
                            if (spaceDashIdx2 > 0) mkPrefix2 = mkComment2.substring(0, spaceDashIdx2).trim();
                            if (mkPrefix2 === String(firstNum)) { hasFirstItemMarker = true; break; }
                        }
                    }
                    if (!hasFirstItemMarker) {
                        var firstTitol = (firstItem.titol || '').substring(0, 60);
                        var firstComment = firstNum + ' - ' + firstTitol;
                        placements.push({ prefix: firstNum, timeSec: 0, comment: firstComment.trim(), colorIdx: 6 });
                        itemPositions.set(firstNum, 0);
                        log('\\U0001f7e0 [F2\\u00b7Deducido] For\\u00e7ant marcador 1r \\u00edtem ' + firstNum + ' a 00:00 (no existia)');
                    }
                }
            }

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                if (hasOnAir) continue; // F1 ja l'ha col\u00b7locat'''
if old2 in txt:
    txt = txt.replace(old2, new2)
    fixes_applied += 1
    print('Fix 2 (D10 F2) OK')
else:
    print('Fix 2 NOT FOUND')

# Fix 3: Clean F3 - remove new marker placements, keep only correlation snap
# Change the comment to indicate it only applies delta
old3 = '''// \u2500\u2500 Obtenir marcadors existents per a correlation snap \u2500\u2500
            var markersRaw = await callJSX('Markers.get()');
            var existingMarkers = [];
            if (markersRaw && markersRaw !== '[]') {
                try { existingMarkers = JSON.parse(markersRaw); } catch (e) {}
            }
            log('   \\U0001f7e2 [F3\\u00b7Coinc] Marcadors existents al timeline: ' + existingMarkers.length);

            var densityData = getMP4()._calcDensityFootprint(clips);
            var snapResult = this._correlationSnap(existingMarkers, clips, densityData, manifest.escaletaItems, reader);
            var snapDelta = (snapResult && snapResult.delta !== null) ? snapResult.delta : 0;
            log('   \\U0001f7e2 [F3\\u00b7Coinc] \\u0394 snap: ' + snapDelta.toFixed(3) + 's (confian\\u00e7a=' + (snapResult.confidence * 100).toFixed(0) + '%)');'''
if old3 in txt:
    print('Fix 3: F3 correlation snap already present (no changes needed)')
else:
    print('Fix 3: F3 pattern not found, checking alternative...')

# Fix 5: F1 UNGROUPED colorIdx = 1 (red)
old5 = '''                                colorIdx: this._getColorIdx(firstUngroupedItem)'''
new5 = '''                                colorIdx: 1'''
if old5 in txt:
    txt = txt.replace(old5, new5)
    fixes_applied += 1
    print('Fix 5 (UNGROUPED red) OK')
else:
    print('Fix 5 NOT FOUND')

# Fix 4: Add _calcDensityFootprint wrapper to flow_markers.js
old4 = '''        _correlationSnap: function (markers, clips, densityData, manifestItems, reader) {'''
new4 = '''        // \u2500\u2500 Wrapper per a calcDensityFootprintV2 (independitza flow_markers de flow_mp4) \u2500\u2500
        _calcDensityFootprint: function (clips) {
            return FASTPASS_UI.Logic.Assembly.calcDensityFootprintV2(clips);
        },

        _correlationSnap: function (markers, clips, densityData, manifestItems, reader) {'''
if old4 in txt:
    txt = txt.replace(old4, new4)
    fixes_applied += 1
    print('Fix 4 (_calcDensityFootprint wrapper) OK')
else:
    print('Fix 4 NOT FOUND')

# Also fix the F3 densityData call to use local wrapper instead of getMP4
old3b = '''var densityData = getMP4()._calcDensityFootprint(clips);'''
new3b = '''var densityData = this._calcDensityFootprint(clips);'''
if old3b in txt:
    txt = txt.replace(old3b, new3b)
    fixes_applied += 1
    print('Fix 3b (F3 uses local _calcDensityFootprint) OK')
else:
    print('Fix 3b NOT FOUND')

with open(path, 'w', encoding='utf-8') as f:
    f.write(txt)
print(f'Total fixes applied: {fixes_applied}')