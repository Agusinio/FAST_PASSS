// parser.js (Versión Legacy Universal - Optimizado para NewWorld)

var globalScope = (typeof window !== 'undefined') ? window : $.global;
var FASTPASS_UI = globalScope.FASTPASS_UI || {};
FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

// Alias seguro para evitar Syntax Errors
var callJSX = (FASTPASS_UI.Utils && FASTPASS_UI.Utils.callJSX) ? FASTPASS_UI.Utils.callJSX : function(){};

var safeLog = function(msg) {
    if (typeof $ !== 'undefined' && $.writeln) {
        $.writeln(msg); 
    }
    if (typeof console !== 'undefined' && console.log) {
        console.log(msg); 
    }
};

FASTPASS_UI.Logic.BlockParser = function() {
    this.structure = [];
    this.bloqueMaster = { id: null, titulo: "" };
};

FASTPASS_UI.Logic.BlockParser.prototype = {

    parseFromFiles: function(fileList, program, block) {
        this.structure = [];
        var lookup = {};

        for (var i = 0; i < fileList.length; i++) {
            var f = fileList[i];
            var meta = this.parseWottMetadata(f.name);
            if (!meta) continue;

            const blockId = meta.rawLinea; 

            if (!lookup[blockId]) {
                lookup[blockId] = { 
                    id: blockId, 
                    numBase: meta.linea, 
                    suffix: meta.descriptor,
                    theme: "PENDENT", 
                    chyrons: [],
                    type: "UNKNOWN" // Se clasificará luego por duración
                };
            }

            var possibleTheme = this.extractThemeFromWott(f.name);
            if (possibleTheme) lookup[blockId].theme = possibleTheme;

            lookup[blockId].chyrons.push({
                name: f.name,
                path: f.path,
                tc: meta.tc,
                rol: meta.rol
            });
        }

        for (var key in lookup) {
            lookup[key].chyrons.sort(function(a,b){ return a.tc.localeCompare(b.tc); });
            this.structure.push(lookup[key]);
        }

        // --- ORDENACIÓ AVANÇADA (Lead -> i -> Base) ---
        this.structure.sort(function(a, b) {
            var n1 = parseInt(a.numBase);
            var n2 = parseInt(b.numBase);
            if (n1 !== n2) return n1 - n2;

            var getWeight = function(s) {
                s = s.toLowerCase();
                if (s === "lead") return 0;
                if (s === "i") return 1;
                if (s === "") return 2;
                return 3; 
            };
            
            var w1 = getWeight(a.suffix);
            var w2 = getWeight(b.suffix);
            if (w1 !== w2) return w1 - w2;

            return a.id.localeCompare(b.id);
        });
        
        return this.structure;
    },
    
    // --- 1. LÒGICA ORIGINAL (MANTINGUDA PER A VÍDEO MP4) ---
    parse: function(filename, programCode, blockCode) {
        safeLog("🔍 [PARSER] Analitzant Vídeo: " + filename);
        
        this.structure = [];
        this.bloqueMaster = { id: null, titulo: "" };
        
        var cleanName = filename.replace(/\.mp4$/i, "");
        var chunks = cleanName.split("__"); // Separador doble per a vídeos
        var lineasTemp = {};

        for (var i = 0; i < chunks.length; i++) {
            var rawPiece = chunks[i].replace(/^\s+|\s+$/g, ""); 
            if (!rawPiece) continue;

            // Mantinc el teu RegExp original per trobar la línia (ex: v2_19_)
            var blockPattern = new RegExp(blockCode + "_([0-9]+[a-z]*)_", "i");
            var match = rawPiece.match(blockPattern);
            
            var idLineaRaw = "S/N";
            var tituloTema = rawPiece;

            if (match) {
                idLineaRaw = match[1];
                tituloTema = rawPiece.split(match[0])[1] || "";
            }

            var numBase = idLineaRaw.replace(/[a-z]/g, "");
            var esIntro = idLineaRaw.indexOf('i') !== -1;
            var esTD = idLineaRaw.indexOf('td') !== -1;
            var tieneEspacios = tituloTema.substring(0, 5).indexOf(" ") !== -1;

            if (!this.bloqueMaster.id && /^[0-9]+$/.test(idLineaRaw)) {
                this.bloqueMaster.id = numBase;
                this.bloqueMaster.titulo = tituloTema.replace(/^\s+/, "");
            }

            if (!lineasTemp[numBase]) {
                lineasTemp[numBase] = { id: numBase, elementos: [], chyrons: [] };
            }

            lineasTemp[numBase].elementos.push({
                idRaw: idLineaRaw,
                titulo: tituloTema,
                tipo: (esTD || tieneEspacios) ? "SUPERPUESTO" : (esIntro ? "INTRO" : "BASE"),
                prioridad: (esTD || tieneEspacios) ? 1 : (esIntro ? 2 : 3),
                rawChunk: rawPiece
            });
        }

        for (var key in lineasTemp) {
            if (lineasTemp.hasOwnProperty(key)) {
                var linea = lineasTemp[key];
                linea.elementos.sort(function(a, b) { return a.prioridad - b.prioridad; });
                this.structure.push(linea);
            }
        }
        
        this.structure.sort(function(a, b) { return parseInt(a.id) - parseInt(b.id); });
        return this.structure;
    },

    // --- 2. NOVA LÒGICA (VINCULACIÓ DE WOTTS I TIME CODE) ---
    
    /**
     * parseWottMetadata: Extrau metadades i gestiona el cas especial de TRADUCCIÓ.
     */
    parseWottMetadata: function(wottName) {
        var parts = wottName.split("_");
        if (parts.length < 5) return null;
    
        var rawLinea = parts[3]; // '04i', '04lead', etc.
        var matchLine = rawLinea.match(/(\d+)(.*)/); // Fem el match de dígits + qualsevol cosa
        var numLinea = matchLine ? matchLine[1] : rawLinea;
        var descriptor = matchLine ? matchLine[2] : "";
    
        // 📍 QUIRÚRGIC: Descodifiquem el nom aquí per evitar el problema del %20
        var nombreRaw = parts[5] || "";
        try { nombreRaw = decodeURIComponent(nombreRaw).replace(/_/g, " "); } catch(e) {}
    
        var res = {
            rawLinea: rawLinea,
            linea: numLinea,
            descriptor: descriptor,
            tc: parts[4],
            nombre: nombreRaw, 
            rol: (parts[7] || "ROTUL").split(".")[0], 
            isTraduccion: false
        };
    
        // Cas especial TRADUCCIÓ
        if (wottName.indexOf("_TRADUCCIÓ") !== -1) {
            res.isTraduccion = true;
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
     * extractThemeFromWott: Identifica si un Wott pot ser el Títol del Projecte.
     */
    extractThemeFromWott: function(wottName) {
        var metadata = this.parseWottMetadata(wottName);
        if (!metadata) return null;

        var tema = metadata.nombre.split(".")[0];
        try { tema = decodeURIComponent(tema); } catch(e) {}
        tema = tema.replace(/_/g, " ").trim();

        // REQUISITS PER SER TÍTOL "BO":
        // 1. No pot tenir 3 espais en blanc al principi (línies especials)
        var tieneEspaciosEspeciales = metadata.nombre.indexOf("   ") === 0;
        
        // 2. No pot tenir descriptor auxiliar (dp = donapas, i = intro)
        var esAuxiliar = (metadata.descriptor === "dp" || metadata.descriptor === "i");
        
        // 3. HA D'ESTAR EN MAJÚSCULES
        var esMayusculas = (tema === tema.toUpperCase() && tema !== tema.toLowerCase());

        if (esMayusculas && !esAuxiliar && !tieneEspaciosEspeciales) {
            return tema;
        }

        return null; // Si no compleix, el sistema seguirà buscant o posarà PENDENT
    },

    /**
     * Assigna i ordena els Chyrons dins de cada línia de la seqüència.
     * Lògica: Bloque (implícit) -> Línea (id) -> Timecode (tc).
     */
    assignChyrons: function(candidates) {
        // 1. Recorrem la estructura (que ja ve ordenada per ID de línia des de parse())
        for (var i = 0; i < this.structure.length; i++) {
            var linea = this.structure[i];
            
            for (var j = 0; j < candidates.length; j++) {
                var file = candidates[j];
                
                // Nou format Wott: [0]Wott_[1]PROG_[2]BLOC_[3]LINEA_[4]TC_[5]TEMA...
                var parts = file.name.split("_");
                var wottLineaID = parts[3] || ""; 
                var wottTC      = parts[4] || "00.00"; // Segons captura, format 01.00
                var wottRol     = parts[7] || "ROTUL";

                // 2. VINCULACIÓ: Per ID de línia o per coincidència de text (tema)
                // Comprovem contra el títol del primer element de la línia (el principal)
                var tituloReferencia = (linea.elementos.length > 0) ? linea.elementos[0].titulo : "";

                if (wottLineaID === linea.id || this.matchByTheme(file.name, tituloReferencia)) {
                    linea.chyrons.push({
                        name: file.name,
                        path: file.path,
                        tc: wottTC,          // Crucial per a l'ordre cronològic
                        lineaID: wottLineaID,
                        tipo: wottRol        // Ex: Nomcarrec, Llocdata...
                    });
                }
            }

            // 3. ORDENACIÓ INTERNA: Ordenem els chyrons per TimeCode dins de la mateixa línia
            linea.chyrons.sort(function(a, b) {
                // localeCompare funciona perfectament amb el format "00.46" o "01.00"
                return a.tc.localeCompare(b.tc);
            });

            // 4. NETEJA: Eliminem possibles duplicats si s'ha escanejat la carpeta vàries vegades
            this.uniqueChyrons(linea);
        }
    },

    /**
     * Lògica d'Heurística per classificar blocs segons durada.
     * Intro (>10s + Conductor), Video (<10s), Lead (Amb TemaTitol).
     */
    classifyBlock: function(block, duration) {
        var hasConductor = false;
        var isGraphicIntro = false;

        for(var i=0; i<block.chyrons.length; i++) {
            var c = block.chyrons[i];
            if(c.rol === "CONDUCTOR") hasConductor = true;
            // Si el nom de l'arxiu/títol comença amb 3 espais -> Gràfic d'Intro
            if(c.name && c.name.indexOf("   ") === 0) isGraphicIntro = true;
        }

        if (isGraphicIntro) return "GRAPHIC_INTRO";

        if (duration > 10) {
            if (block.suffix === "lead") return "LEAD";
            if (hasConductor || block.suffix === "i") return "INTRO";
            return "VIDEO_LONG";
        } else {
            if (block.suffix === "lead") return "LEAD"; // Ara unificat
            return "VIDEO";
        }
    },

    matchByTheme: function(wottName, videoTheme) {
        var cleanVideo = this.getMatchSignature(videoTheme);
        var cleanWott = this.getMatchSignature(wottName);
        if (cleanVideo.length < 4) return false;
        return cleanWott.indexOf(cleanVideo.substring(0, 10)) !== -1;
    },

    getMatchSignature: function(str) {
        if (!str) return "";
        var s = str.toUpperCase();
        s = s.replace(/[ÁÀÄ]/g, "A").replace(/[ÉÈË]/g, "E").replace(/[ÍÌÏ]/g, "I").replace(/[ÓÒÖ]/g, "O").replace(/[ÚÙÜ]/g, "U");
        return s.replace(/[^A-Z0-9]/g, "");
    },

    uniqueChyrons: function(linea) {
        var cleaned = [];
        var lookup = {};
        for (var i = 0; i < linea.chyrons.length; i++) {
            var item = linea.chyrons[i];
            if (!lookup[item.name]) {
                lookup[item.name] = true;
                cleaned.push(item);
            }
        }
        linea.chyrons = cleaned;
    }
};

globalScope.FASTPASS_UI = FASTPASS_UI;