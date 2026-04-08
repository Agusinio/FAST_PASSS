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
        
        async scan(path, extension) {
            // 1. Herramienta básica: Pedir lista cruda al JSX
            const raw = await utils.callJSX(`IO.scanDirectory(${JSON.stringify(path)})`);
            const files = JSON.parse(raw || "[]");
            
            // 2. Filtro genérico por extensión (si se pide)
            if (extension && extension !== "*.*") {
                const ext = extension.replace("*.", "").toLowerCase();
                return files.filter(f => f.name.split('.').pop().toLowerCase() === ext);
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
