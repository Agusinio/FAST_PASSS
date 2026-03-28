/**
 * ============================================================================
 * INSPECTOR: 1_SourceAssets (Discovery Extern: Disco/Red/Servers)
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Inspectors = FASTPASS_UI.Inspectors || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Inspectors.SourceAssets = {
        
        async scan(path, pattern) {
            const raw = await utils.callJSX(`IO.scanDirectory(${JSON.stringify(path)})`);
            let files = JSON.parse(raw || "[]");
            if (pattern && pattern !== "*.*") {
                const targetExt = pattern.replace("*.", "").toLowerCase();
                files = files.filter(f => f.name.split('.').pop().toLowerCase() === targetExt);
            }
            return files;
        },

        getLatestDayMap(fileList) {
            if (!fileList || fileList.length === 0) return [];
            let maxTs = 0;
            fileList.forEach(f => { if (f.modified > maxTs) maxTs = f.modified; });
            let dayBarrier = (new Date(maxTs)).setHours(0, 0, 0, 0);
            return fileList.filter(f => f.modified >= dayBarrier);
        },

        preparePathsForImport(fileList) {
            return fileList.map(f => {
                const p = (typeof f === 'string') ? f : (f.path || f);
                return p.replace(/\//g, '\\');
            });
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
