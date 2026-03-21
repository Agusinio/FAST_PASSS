/**
 * ============================================================================
 * LOGIC: SCANNER (Descubrimiento y Filtrado de Media)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Scanner = {
        
        /**
         * Escaneig genèric de fitxers en una ruta.
         */
        async scan(path, pattern) {
            const raw = await utils.callJSX(`FASTPASS.IO.getRawFiles(${JSON.stringify(path)})`);
            let files = JSON.parse(raw || "[]");
            const targetExt = pattern.replace("*.", "").toLowerCase();
            return files.filter(f => f.name.split('.').pop().toLowerCase() === targetExt);
        },

        /**
         * Filtra fitxers que pertanyen al dia de l'última modificació trobada.
         */
        filterFilesByLatestDay: function(fileList) {
            if (!fileList || fileList.length === 0) return [];
            let maxTimestamp = 0;
            fileList.forEach(f => { if (f.modified > maxTimestamp) maxTimestamp = f.modified; });
            let dayBarrier = (new Date(maxTimestamp)).setHours(0, 0, 0, 0);
            return fileList.filter(f => f.modified >= dayBarrier);
        },

        /**
         * DESCOBRIMENT: Troba tota la info d'un Tema basat en el bloc i programa.
         */
        findTemaData: async function(ctx) {
            const rawWotts = await this.scan(ctx.config.rutas.chyrons, '*.mov');
            const files = this.filterFilesByLatestDay(rawWotts);
            
            const parser = new FASTPASS_UI.Logic.BlockParser();
            const regWott = new RegExp("^Wott_" + ctx.progData.archivo_wott + "_" + ctx.bloque, "i");
            const filtered = files.filter(f => regWott.test(f.name));
            
            let temaDetectado = "PENDENT";
            const processed = filtered.map(f => {
                const info = parser.parseWottMetadata(f.name);
                const isMain = (/[A-Z]/.test(info.nombre) && !/dp|i/i.test(info.descriptor || ""));
                if (isMain && temaDetectado === "PENDENT") {
                    const matchTema = info.nombre.match(/^[A-ZÀ-ÿ\s,.-]+/); 
                    temaDetectado = matchTema ? matchTema[0].trim() : info.nombre;
                }
                return { file: f, info, isMain };
            });
            return { list: processed, tema: temaDetectado };
        },

        /**
         * DESCOBRIMENT: Troba MP4 i SRT corresponents al bloc.
         */
        findMediaAssets: async function(ctx) {
            const path = ctx.config.rutas.verticalitzacio;
            const mp4s = await this.scan(path, '*.mp4');
            const srts = await this.scan(path, '*.srt');
            
            const filteredMp4s = this.filterFilesByLatestDay(mp4s);
            const filteredSrts = this.filterFilesByLatestDay(srts);
            
            const reg = new RegExp("^" + ctx.progData.archivo + "_" + ctx.bloque, "i");
            
            return { 
                mp4: filteredMp4s.find(f => reg.test(f.name)) || null,
                srt: filteredSrts.find(f => reg.test(f.name)) || null
            };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();