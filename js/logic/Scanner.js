/**
 * ============================================================================
 * LOGIC: SCAN (Motor de cerca de materials) - v2.5.1 literal-premium
 * ============================================================================
 */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        log: (m, type) => (FASTPASS_UI.Utils) ? FASTPASS_UI.Utils.log(m, type || "DEBUG") : console.log(m),
        readFolder: (p) => (FASTPASS_UI.Utils) ? FASTPASS_UI.Utils.readFolder(p) : []
    };

    FASTPASS_UI.Logic.Scan = {

        /**
         * _discardOld: Purga fitxers que superen la finestra de guarda (22h).
         */
        _discardOld: function (files, guardaHours) {
            const now = Date.now();
            const cutoff = now - (guardaHours * 60 * 60 * 1000);

            return files.filter(f => {
                if (!f.mtime) return true;
                const fileTime = new Date(f.mtime).getTime();
                return isNaN(fileTime) ? true : (fileTime >= cutoff);
            });
        },

        /**
         * mediaAssets: Busca MP4 i SRT corresponents al bloc actual.
         */
        mediaAssets: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.verticalitzacio;
                utils.log(`📂 [SCAN MEDIA] Mirant a: ${pathNAS}`);

                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) {
                    utils.log("❌ [SCAN MEDIA] Carpeta buida o inaccessible.", "ERROR");
                    return { mp4: null, srt: null };
                }

                // 📐 DESCARTEM EL QUE ÈS VELL (LITERAL)
                const freshFiles = this._discardOld(allFiles, ctx.config.guarda || 22);
                const prefix = `${ctx.progData.archivo}_${ctx.bloque}`.toUpperCase();

                utils.log(`🔍 [SCAN MEDIA] Buscant [${prefix}] en ${freshFiles.length} fitxers filtrats.`);

                const candidates = freshFiles.filter(f => {
                    const name = (f.name || f).toUpperCase();
                    return name.indexOf(prefix) !== -1 && (name.endsWith(".MP4") || name.endsWith(".SRT"));
                });

                if (candidates.length === 0) return { mp4: null, srt: null };

                candidates.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

                const getAsset = (ext) => {
                    const f = candidates.find(c => c.name.toUpperCase().endsWith(ext));
                    return f ? { name: f.name, path: pathNAS + f.name } : null;
                };

                return { mp4: getAsset(".MP4"), srt: getAsset(".SRT") };
            } catch (e) { return { mp4: null, srt: null }; }
        },

        /**
         * wotts: Escaneja format .WOTT per trobar rètols i el Tema del projecte.
         */
        wotts: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                utils.log(`📂 [SCAN WOTTS] Mirant a: ${pathNAS}`);

                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return { tema: "PENDENT", list: [] };

                // 📐 DESCARTEM EL QUE ÈS VELL (LITERAL)
                const freshFiles = this._discardOld(allFiles, ctx.config.guarda || 22);

                const fProg = (ctx.progData && ctx.progData.archivo_wott) ? ctx.progData.archivo_wott.toUpperCase() : "TNC";
                const fBloc = ctx.bloque ? `_${ctx.bloque}_`.toUpperCase() : "_V1_";

                utils.log(`🔍 [SCAN WOTTS] Buscant [${fProg}] + [${fBloc}] en ${freshFiles.length} fitxers filtrats.`);

                let filtered = freshFiles.filter(f => {
                    const name = (f.name || f).toUpperCase();
                    return name.includes(fProg) && name.includes(fBloc) && name.endsWith(".MOV");
                });

                if (filtered.length === 0) return { tema: "PENDENT", list: [] };

                filtered.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

                // 📍 EXTRACCIÓ DEL TEMA (SLUG)
                const nameSource = filtered.find(f => f.name.includes("Tema-Titol")) || filtered[0];
                let tema = "TEMA";
                const parts = nameSource.name.split('_');

                if (parts.length >= 6) {
                    tema = parts[5].replace(/\..+$/, "").trim();
                    if (!isNaN(tema) && parts.length >= 7) {
                        tema = parts[6].replace(/\..+$/, "").trim();
                    }
                }

                utils.log(`🏷️ Tema detectat: [${tema}] (Font: ${nameSource.name})`, "INFO");

                return { 
                    tema: tema, 
                    list: filtered.map(f => ({ name: f.name, path: pathNAS + f.name })) 
                };

            } catch (e) {
                console.error("💥 Error Scan.wotts:", e);
                return { tema: "ERROR", list: [] };
            }
        },

        /**
         * portada: Busca el darrer PNG de portada corresponent al bloc (estil Wotts).
         */
        portada: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                utils.log(`📂 [SCAN PORTADA] Mirant a: ${pathNAS}`);

                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return null;

                const freshFiles = this._discardOld(allFiles, 22);
                const fProg = (ctx.progData && ctx.progData.archivo_wott) ? ctx.progData.archivo_wott.toUpperCase() : "TNC";
                const fBloc = ctx.bloque ? `_${ctx.bloque}_`.toUpperCase() : "_V1_";

                let filtered = freshFiles.filter(f => {
                    const name = (f.name || f).toUpperCase();
                    return name.includes(fProg) && name.includes(fBloc) && name.endsWith(".PNG");
                });

                if (filtered.length === 0) return null;

                // Ordenar per mtime descendent (més recent primer)
                filtered.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

                utils.log(`🖼️ Portada detectada: [${filtered[0].name}]`, "INFO");
                return { name: filtered[0].name, path: pathNAS + filtered[0].name };

            } catch (e) {
                console.error("💥 Error Scan.portada:", e);
                return null;
            }
        }
    };

    // Alias literal global window.Scan
    window.Scan = FASTPASS_UI.Logic.Scan;

    window.FASTPASS_UI = FASTPASS_UI;
})();