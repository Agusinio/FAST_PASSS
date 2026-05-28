/**
 * ============================================================================
 * 23_Analisi.js (Motor d'Anàlisi de Metadades i Guió)
 * ============================================================================
 */

(function() {
    var globalScope = (typeof window !== 'undefined') ? window : $.global;
    var FASTPASS_UI = globalScope.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const Eines = {
        log: (m) => (FASTPASS_UI.Eines && FASTPASS_UI.Eines.log) ? FASTPASS_UI.Eines.log(m, "DEBUG") : console.log(m)
    };

    FASTPASS_UI.Logic.Parse = {
        structure: [],
        bloqueMaster: { id: null, titulo: "" },

        /**
         * files: Genera l'estructura a partir d'una llista de fitxers Wott.
         */
        files: function(fileList, program, block) {
            this.structure = [];
            var lookup = {};

            for (var i = 0; i < fileList.length; i++) {
                var f = fileList[i];
                var meta = this.meta(f.name);
                if (!meta) continue;

                var blockId = meta.rawLinea; 
                if (!lookup[blockId]) {
                    lookup[blockId] = { 
                        id: blockId, 
                        numBase: meta.linea, 
                        suffix: meta.descriptor,
                        theme: "PENDENT", 
                        chyrons: [],
                        type: "UNKNOWN"
                    };
                }

                var possibleTheme = this.theme(f.name);
                if (possibleTheme) lookup[blockId].theme = possibleTheme;

                lookup[blockId].chyrons.push({
                    name: f.name,
                    path: f.path,
                    tc: meta.tc,
                    rol: meta.rol
                });
            }

            for (var key in lookup) {
                lookup[key].chyrons.sort((a, b) => a.tc.localeCompare(b.tc));
                this.structure.push(lookup[key]);
            }

            // --- ORDENACIÓ LITERAL (Lead -> i -> Base) ---
            this.structure.sort((a, b) => {
                var n1 = parseInt(a.numBase);
                var n2 = parseInt(b.numBase);
                if (n1 !== n2) return n1 - n2;

                var weight = (s) => {
                    s = s.toLowerCase();
                    if (s === "lead") return 0;
                    if (s === "i") return 1;
                    if (s === "") return 2;
                    return 3;
                };
                
                var w1 = weight(a.suffix);
                var w2 = weight(b.suffix);
                if (w1 !== w2) return w1 - w2;
                return a.id.localeCompare(b.id);
            });
            
            return this.structure;
        },

        /**
         * video: Analitza el nom d'un vídeo MP4 (Lògica original).
         */
        video: function(filename, blockCode) {
            this.structure = [];
            this.bloqueMaster = { id: null, titulo: "" };
            
            var cleanName = filename.replace(/\.mp4$/i, "");
            var chunks = cleanName.split("__");
            var lineasTemp = {};

            for (var i = 0; i < chunks.length; i++) {
                var rawPiece = chunks[i].trim(); 
                if (!rawPiece) continue;

                var blockPattern = new RegExp(blockCode + "_([0-9]+[a-z]*)_", "i");
                var match = rawPiece.match(blockPattern);
                
                var idLineaRaw = match ? match[1] : "S/N";
                var tituloTema = match ? rawPiece.split(match[0])[1] || "" : rawPiece;

                var numBase = idLineaRaw.replace(/[a-z]/g, "");
                var esIntro = idLineaRaw.indexOf('i') !== -1;
                var esTD = idLineaRaw.indexOf('td') !== -1;
                var tieneEspacios = tituloTema.substring(0, 5).indexOf(" ") !== -1;

                if (!this.bloqueMaster.id && /^[0-9]+$/.test(idLineaRaw)) {
                    this.bloqueMaster.id = numBase;
                    this.bloqueMaster.titulo = tituloTema.trim();
                }

                if (!lineasTemp[numBase]) {
                    lineasTemp[numBase] = { id: numBase, elementos: [], chyrons: [] };
                }

                lineasTemp[numBase].elementos.push({
                    idRaw: idLineaRaw,
                    titulo: tituloTema,
                    tipo: (esTD || tieneEspacios) ? "SUPERPUESTO" : (esIntro ? "INTRO" : "BASE"),
                    prioridad: (esTD || tieneEspacios) ? 1 : (esIntro ? 2 : 3)
                });
            }

            for (var key in lineasTemp) {
                var linea = lineasTemp[key];
                linea.elementos.sort((a, b) => a.prioridad - b.prioridad);
                this.structure.push(linea);
            }
            
            this.structure.sort((a, b) => parseInt(a.id) - parseInt(b.id));
            return this.structure;
        },

        /**
         * meta: Extrau metadades d'un format Wott.
         */
        meta: function(wottName) {
            var parts = wottName.split("_");
            if (parts.length < 5) return null;
        
            var rawLinea = parts[3];
            var matchLine = rawLinea.match(/(\d+)(.*)/);
            var numLinea = matchLine ? matchLine[1] : rawLinea;
            var descriptor = matchLine ? matchLine[2] : "";
        
            var nombreRaw = parts[5] || "";
            try { nombreRaw = decodeURIComponent(nombreRaw).replace(/_/g, " "); } catch(e) {}
        
            var res = {
                rawLinea: rawLinea,
                linea: numLinea,
                descriptor: descriptor,
                tc: parts[4],
                nombre: nombreRaw, 
                rol: (parts[7] || "ROTUL").split(".")[0]
            };
        
            if (wottName.indexOf("_TRADUCCIÓ") !== -1) {
                res.rol = "TRADUCCIÓ";
                var matchTradu = wottName.match(/\[(\d+-\d+)\]\s*([^.]+)/);
                if (matchTradu) {
                    res.datoExtra = matchTradu[1];
                    res.nombre = matchTradu[2];
                }
            }
            return res;
        },

        /**
         * theme: Identifica si un Wott pot ser el Títol del Projecte.
         */
        theme: function(wottName) {
            var metadata = this.meta(wottName);
            if (!metadata) return null;

            var tema = metadata.nombre.split(".")[0];
            try { tema = decodeURIComponent(tema); } catch(e) {}
            tema = tema.replace(/_/g, " ").trim();

            var tieneEspaciosEspeciales = metadata.nombre.indexOf("   ") === 0;
            var esAuxiliar = (metadata.descriptor === "dp" || metadata.descriptor === "i");
            var esMayusculas = (tema === tema.toUpperCase() && tema !== tema.toLowerCase());

            return (esMayusculas && !esAuxiliar && !tieneEspaciosEspeciales) ? tema : null;
        },

        /**
         * classify: Heurística per classificar blocs segons durada.
         */
        classify: function(block, duration) {
            var hasConductor = false;
            var isGraphicIntro = false;

            for(var i=0; i<block.chyrons.length; i++) {
                var c = block.chyrons[i];
                if(c.rol === "CONDUCTOR") hasConductor = true;
                if(c.name && c.name.indexOf("   ") === 0) isGraphicIntro = true;
            }

            if (isGraphicIntro) return "GRAPHIC_INTRO";

            if (duration > 10) {
                if (block.suffix === "lead") return "LEAD";
                if (hasConductor || block.suffix === "i") return "INTRO";
                return "VIDEO_LONG";
            } else {
                return (block.suffix === "lead") ? "LEAD" : "VIDEO";
            }
        },

        /**
         * assign: Vincula Chyrons a l'estructura existent.
         */
        assign: function(candidates) {
            for (var i = 0; i < this.structure.length; i++) {
                var linea = this.structure[i];
                for (var j = 0; j < candidates.length; j++) {
                    var file = candidates[j];
                    var parts = file.name.split("_");
                    var wottLineaID = parts[3] || ""; 
                    if (wottLineaID === linea.id) {
                        linea.chyrons.push({
                            name: file.name,
                            path: file.path,
                            tc: parts[4],
                            lineaID: wottLineaID,
                            rol: (parts[7] || "ROTUL").split(".")[0]
                        });
                    }
                }
                linea.chyrons.sort((a, b) => a.tc.localeCompare(b.tc));
            }
        }
    };

    // Alias global literal window.Parse.files()
    window.Parse = FASTPASS_UI.Logic.Parse;

    globalScope.FASTPASS_UI = FASTPASS_UI;
})();
