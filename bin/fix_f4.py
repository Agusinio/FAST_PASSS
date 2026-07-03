import sys
path = r'.\js\workflows\flow_assembly.js'
with open(path, 'r', encoding='utf-8') as f:
    txt = f.read()

# Fix 1: Add _classifyItems after prefixToItem (in snapFaroMarkers)
old1 = '''            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var _extractPrefix = function (comment) {'''
new1 = '''            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var classData = this._classifyItems(lines);
            var structuralItems = classData.structuralItems;

            var _extractPrefix = function (comment) {'''
if old1 in txt:
    txt = txt.replace(old1, new1)
    print('Fix 1 OK: _classifyItems added')
else:
    print('Fix 1 NOT FOUND')

# Fix 2: dir fallback - use original position if not in finalTimes
old2 = '''                if (rp2.suffix !== 'dir') continue;
                if (!(rp2.prefix in finalTimes)) continue;
                var dirPos = finalTimes[rp2.prefix];'''
new2 = '''                if (rp2.suffix !== 'dir') continue;
                var dirPos = (rp2.prefix in finalTimes) ? finalTimes[rp2.prefix] : rp2.time;
                if (typeof dirPos !== 'number' || isNaN(dirPos)) continue;'''
if old2 in txt:
    txt = txt.replace(old2, new2)
    print('Fix 2 OK: dir fallback')
else:
    print('Fix 2 NOT FOUND')

# Fix 3: Generic previsto snap to nearest break (+-5s)
old3 = '''                if (!placed) {
                    remaining.push({ mk: mk1, prefix: prefix, suffix: suffix, time: mkTime, item: item });
                }
            }

            // \u2500\u2500 CAPA 1d): dp snap'''
new3 = '''                else if (suffix === '' && duradaSec > 0) {
                    var bestBreakPre = _findBestBreak(mkTime, mkTime - 5, mkTime + 5);
                    if (bestBreakPre !== null) {
                        finalTimes[prefix] = bestBreakPre;
                        placed = true;
                        log('   \U0001f535 [F4\u00b7CAPA1\u00b7PREVISTO] ' + prefix + ': ' + mkTime.toFixed(2) + 's \u2192 break ' + bestBreakPre.toFixed(2) + 's (previsto generic)');
                    }
                }

                if (!placed) {
                    remaining.push({ mk: mk1, prefix: prefix, suffix: suffix, time: mkTime, item: item });
                }
            }

            // \u2500\u2500 CAPA 1d2): dp snap'''
if old3 in txt:
    txt = txt.replace(old3, new3)
    print('Fix 3 OK: previsto generic snap')
else:
    print('Fix 3 NOT FOUND')

with open(path, 'w', encoding='utf-8') as f:
    f.write(txt)
print('File saved.')