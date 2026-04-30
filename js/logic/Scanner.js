/**
 * ============================================================================
 * LOGIC: SCAN (Motor de cerca de materials) - v2.6.0 literal-premium
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

        _discardOld: function (files, guardaHours) {
            const now = Date.now();
            const cutoff = now - (guardaHours * 60 * 60 * 1000);
            return files.filter(f => {
                if (!f.mtime) return true;
                const fileTime = new Date(f.mtime).getTime();
                return isNaN(fileTime) ? true : (fileTime >= cutoff);
            });
        },

        selectedProject: function(fileList, progKey, blocKey) {
            if (!fileList || fileList.length === 0) return null;
            
            // El patrón de identidad: Pruebas_TNV_V1_ (con guión bajo final)
            // para evitar falsos positivos como V10 cuando buscamos V1
            const pattern = `Pruebas_${progKey}_${blocKey}_`.toLowerCase();
            
            const match = fileList.find(f => {
                const name = f.name.toLowerCase();
                // Verifiquem que comenci per la cadena i sigui un projecte de Premiere
                const matches = name.indexOf(pattern) === 0 && name.endsWith(".prproj");
                return matches;
            });
            
            return match ? match.name : null;
        },

        mediaAssets: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.verticalitzacio;
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return { mp4: null, srt: null };
    
                // 🕒 FILTRO ÚNICO: Solo lo que esté dentro de las X horas (ej: 22h)
                const freshFiles = this._discardOld(allFiles, ctx.config.guarda || 22);
                
                const prefix = `${ctx.progData.archivo}_${ctx.bloque}_`.toUpperCase();
    
                const validFiles = freshFiles.filter(f => {
                    const name = f.name.toUpperCase();
                    return name.indexOf(prefix) !== -1 && (name.endsWith(".MP4") || name.endsWith(".SRT"));
                });
    
                if (validFiles.length === 0) return { mp4: null, srt: null };
    
                // Ordenamos por el más reciente por si hay re-renders
                validFiles.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    
                const getAsset = (ext) => {
                    const f = validFiles.find(c => c.name.toUpperCase().endsWith(ext));
                    return f ? { name: f.name, path: pathNAS + f.name } : null;
                };
    
                return { mp4: getAsset(".MP4"), srt: getAsset(".SRT") };
            } catch (e) { return { mp4: null, srt: null }; }
        },

        wotts: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return { tema: "PENDENT", list: [] };
    
                const freshFiles = this._discardOld(allFiles, ctx.config.guarda || 22);
    
                const fProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott.toUpperCase() : "TNV";
                const fBloc = ctx.bloque ? `_${ctx.bloque}_`.toUpperCase() : "_V1_";
    
                let filtered = freshFiles.filter(f => {
                    const name = f.name.toUpperCase();
                    return name.includes(fProg) && name.includes(fBloc) && name.endsWith(".MOV");
                });
    
                // SCAN comentado para reducir ruido
                // utils.log(`🔍 [SCAN] Encontrados ${filtered.length} archivos .MOV después de filtrar por ${fProg} y ${fBloc}`, "DEBUG");
                // filtered.forEach((f, idx) => utils.log(`   ${idx}: ${f.name}`, "DEBUG"));
                if (filtered.length === 0) return { tema: "PENDENT", list: [] };
                filtered.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

                // 2. EXTRACCIÓ INTEL·LIGENT DEL TEMA
                // 1. Buscamos el archivo fuente (preferiblemente el que dice Tema-Titol)
                const nameSource = filtered.find(f => f.name.includes("Tema-Titol")) || filtered[0];
                let tema = "PENDENT"; 

                // 2. Dividimos por el doble subrayado __
                const parts = nameSource.name.split('__');

                // 3. Lista de palabras prohibidas (Realización)
                const reserved = ["INTR", "LÍNIA", "CHYRON", "GF", "PG", "TD", "TE", "P2", "P5", "P7", "LEAD", "BD", "BON DIA", "CHYRONS", "GUIO", "COL.LECCIO", "OFF", "CURT"];

                // 4. Recorremos los bloques después del prefijo técnico (empezamos en i=1)
                for (let i = 1; i < parts.length; i++) {
                    let currentBlock = parts[i];
                    
                    // De este bloque, el título es lo que hay antes del ID de 6 cifras
                    // Buscamos el patrón _336346_ o similar
                    let titleCandidate = "";
                    
                    const idMatch = currentBlock.match(/_[0-9]{5,}_/);
                    if (idMatch) {
                        // Cortamos el nombre DESDE el inicio HASTA la posición del ID
                        tema = currentBlock.substring(0, idMatch.index).trim();
                    }

                    const upperCandidate = titleCandidate.toUpperCase();
                    
                    // VALIDACIÓN: ¿Es una palabra reservada o es demasiado corto?
                    const isReserved = reserved.some(r => upperCandidate.indexOf(r) !== -1);
                    
                    if (!isReserved && titleCandidate.length > 2) {
                        tema = titleCandidate; // ¡Encontrado!
                        break; 
                    }
                }

                // 5. Fallback por si todo ha fallado
                if (tema === "PENDENT") {
                    const fallback = nameSource.name.split('_');
                    tema = fallback[5] ? fallback[5].replace(/\..+$/, "") : "TEMA";
                }

                utils.log(`🏷️ Tema detectat (Smart Filter): [${tema}]`, "INFO");

                return { 
                    tema: tema, 
                    list: filtered.map(f => ({
                        name: f.name, 
                        path: (pathNAS + f.name).replace(/\\/g, "/")
                    }))
                };
            } catch (e) {
                utils.log("💥 Error Scan.wotts: " + e.message, "ERROR");
                return { tema: "ERROR", list: [] };
            }
        },

        portadas: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return [];
    
                // 🕒 FILTRO ÚNICO: Ventana de tiempo estricta
                const freshFiles = this._discardOld(allFiles, ctx.config.guarda || 22);
                
                const fProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott.toUpperCase() : "TNV";
                const fBloc = ctx.bloque ? `_${ctx.bloque}_`.toUpperCase() : "_V1_";
    
                let filtered = freshFiles.filter(f => {
                    const name = f.name.toUpperCase();
                    return name.includes(fProg) && name.includes(fBloc) && 
                           name.includes("TEMA-TITOL") && name.endsWith(".PNG");
                });
    
                filtered.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
                return filtered.map(f => ({ name: f.name, path: pathNAS + f.name }));
            } catch (e) { return []; }
        }
    };

    window.Scan = FASTPASS_UI.Logic.Scan;
})();