/**
 * ============================================================================
 * LOGIC: Scanner (Motor de cerca de materials) - v2.4.2
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const log = (...args) => FASTPASS_UI.Utils.log(...args);

    FASTPASS_UI.Logic.Scanner = {
        
        /**
         * Escaneja el NAS buscant els rètols (.wott / .mov) del programa i bloc seleccionats.
         * @param {Object} ctx - Context de l'aplicació (programa, bloc, dateDir, etc.)
         * @returns {Object} { tema: string, list: Array }
         */
        findTemaData: async function(ctx) {
            const utils = window.FASTPASS_UI.Utils;
            const readFn = this.readNASFolder || utils.readFolder;
        
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                const allFiles = await readFn(pathNAS);
                
                if (!allFiles || allFiles.length === 0) return { tema: "PENDENT", list: [] };
        
                // 📍 MICRO-CIRUGÍA 1: Llegir la propietat correcta del Config.js
                const fProg = (ctx.progData && ctx.progData.archivo_wott) ? ctx.progData.archivo_wott.toUpperCase() : "TNC";
                const fBloc = ctx.bloque ? `_${ctx.bloque}_`.toUpperCase() : "_V1_";

                utils.log(`🎯 Scanner: Filtrant per [${fProg}] i [${fBloc}]`, "DEBUG");
        
                // 📍 FILTRADO SIMPLE (El que te funcionaba)
                let filtered = allFiles.filter(f => {
                    const name = (f.name || f).toUpperCase();
                    return name.indexOf(fProg) !== -1 && name.indexOf(fBloc) !== -1 && name.indexOf(".MOV") !== -1;
                });
        
                if (filtered.length === 0) return { tema: "PENDENT", list: [] };
        
                // 📍 MICRO-CIRUGÍA 2: Ordenar antes de sacar el tema
                filtered.sort((a, b) => (a.name || a).localeCompare(b.name || b));
        
                const finalList = filtered.map(f => {
                    const name = f.name || f;
                    // Limpieza básica de barras para evitar las "3 barras"
                    let p = (pathNAS + name).replace(/\\+/g, '\\').replace(/\\/g, '/');
                    if (p.indexOf("//") !== 0) p = "//" + p.replace(/^\/+/, "");
                    return { name: name, path: p };
                });
        
                let tema = "TEMA";
                const first = filtered[0].name || filtered[0];
                const parts = first.split('_');
                if (parts.length >= 6) tema = parts[5].replace(/\..+$/, "");
        
                return { tema: tema, list: finalList };
        
            } catch (e) {
                return { tema: "ERROR", list: [] };
            }
        },

        /**
         * Lògica de filtratge per finestra de temps (Guarda)
         * @param {Array} files - Llista de fitxers del NAS (amb mtime)
         * @param {number} guardaHours - Hores enrere des d'ara (ex: 22)
         */
        _filterByGuarda: function(files, guardaHours) {
            const now = Date.now();
            const cutoff = now - (guardaHours * 60 * 60 * 1000);
        
            return files.filter(f => {
                // Si f.mtime es 0 o undefined (falló el stat), lo dejamos pasar por seguridad
                if (!f.mtime) return true;
        
                const fileTime = new Date(f.mtime).getTime();
                
                // Si la fecha es válida, aplicamos el filtro de 22h
                if (!isNaN(fileTime)) {
                    return fileTime >= cutoff;
                }
                
                return true; // En caso de duda, para dentro
            });
        },

        findMediaAssets: async function(ctx) {
            const utils = window.FASTPASS_UI.Utils;
            const readFn = this.readNASFolder || utils.readFolder;
        
            try {
                const pathNAS = ctx.config.rutas.verticalitzacio;
                // 📍 LOG DE RUTA
                utils.log(`📂 [SCAN MEDIA] Mirant a: ${pathNAS}`, "DEBUG");
        
                const allFiles = await readFn(pathNAS);
                if (!allFiles || allFiles.length === 0) {
                    utils.log("❌ [SCAN MEDIA] La carpeta de vídeo està buida o no és accessible.", "ERROR");
                    return { mp4: null, srt: null };
                }
        
                const guardaHours = ctx.config.guarda || 22;
                const freshFiles = this._filterByGuarda(allFiles, guardaHours);
                
                // 📍 LOG DE FILTRO
                const prefix = `${ctx.progData.archivo}_${ctx.bloque}`.toUpperCase();
                utils.log(`🔍 [SCAN MEDIA] Buscant prefix [${prefix}] en ${allFiles.length} fitxers totals.`, "DEBUG");
                utils.log(`🕒 [SCAN MEDIA] Després de la guarda (22h) queden: ${freshFiles.length} fitxers.`, "DEBUG");
        
                const candidates = freshFiles.filter(f => {
                    const name = (f.name || f).toUpperCase();
                    return name.indexOf(prefix) !== -1 && (name.endsWith(".MP4") || name.endsWith(".SRT"));
                });
        
                if (candidates.length === 0) return { mp4: null, srt: null };
        
                candidates.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        
                return {
                    mp4: candidates.find(f => f.name.toUpperCase().endsWith(".MP4")) ? { name: candidates.find(f => f.name.toUpperCase().endsWith(".MP4")).name, path: pathNAS + candidates.find(f => f.name.toUpperCase().endsWith(".MP4")).name } : null,
                    srt: candidates.find(f => f.name.toUpperCase().endsWith(".SRT")) ? { name: candidates.find(f => f.name.toUpperCase().endsWith(".SRT")).name, path: pathNAS + candidates.find(f => f.name.toUpperCase().endsWith(".SRT")).name } : null
                };
            } catch (e) { return { mp4: null, srt: null }; }
        },

        findTemaData: async function(ctx) {
            const utils = window.FASTPASS_UI.Utils;
            const readFn = this.readNASFolder || utils.readFolder;
        
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                utils.log(`📂 [SCAN WOTTS] Mirant a: ${pathNAS}`, "DEBUG");
        
                const allFiles = await readFn(pathNAS);
                if (!allFiles || allFiles.length === 0) return { tema: "PENDENT", list: [] };
        
                const freshFiles = this._filterByGuarda(allFiles, ctx.config.guarda || 22);
        
                const fProg = (ctx.progData && ctx.progData.archivo_wott) ? ctx.progData.archivo_wott.toUpperCase() : "TNC";
                const fBloc = ctx.bloque ? `_${ctx.bloque}_`.toUpperCase() : "_V1_";
                
                utils.log(`🔍 [SCAN WOTTS] Buscant [${fProg}] + [${fBloc}] en ${allFiles.length} fitxers.`, "DEBUG");
        
                let filtered = freshFiles.filter(f => {
                    const name = (f.name || f).toUpperCase();
                    return name.includes(fProg) && name.includes(fBloc) && name.endsWith(".MOV");
                });
        
                utils.log(`✅ [SCAN WOTTS] Trobats: ${filtered.length} rètols vàlids.`, "DEBUG");
        
                if (filtered.length === 0) return { tema: "PENDENT", list: [] };
        
                // Ordenem per data (més nou primer) per a la llista d'importació
                filtered.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        
                const finalList = filtered.map(f => ({ name: f.name, path: pathNAS + f.name }));
        
                // 📍 MICRO-CIRURGIA: EXTRACCIÓ DEL TEMA
                // 1. Busquem el rètol que contingui "Tema-Titol", que sol tenir el slug més net.
                // 2. Si no el trobem, agafem el primer de la llista.
                const nameSource = filtered.find(f => f.name.includes("Tema-Titol")) || filtered[0];
                let tema = "TEMA";
                
                const parts = nameSource.name.split('_');
                
                // Estructura esperada: Wott_TNC_V1_01_00.01_TEMA_ID.mov
                // El tema sol estar a la posició 5.
                if (parts.length >= 6) {
                    tema = parts[5].replace(/\..+$/, "").trim();
                    
                    // Si el tema detectat és només un número (ID) i n'hi ha més parts, mirem la següent
                    if (!isNaN(tema) && parts.length >= 7) {
                        tema = parts[6].replace(/\..+$/, "").trim();
                    }
                }
        
                utils.log(`🏷️ Tema extret per al projecte: [${tema}] (Font: ${nameSource.name})`, "INFO");
        
                return { tema: tema, list: finalList };
                
            } catch (e) { 
                console.error("💥 Error findTemaData:", e);
                return { tema: "ERROR", list: [] }; 
            }
        }
    };
})();