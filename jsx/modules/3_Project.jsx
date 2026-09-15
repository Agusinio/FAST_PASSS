/**
 * =================================================================================
 * 3_Project.jsx
 * Gestió de projectes, Bins i seqüències (v12 - SUPER-LITERAL DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

// Asegurar que Project esté definido (clase nativa de Premiere)
if (typeof Project === 'undefined' && app.project) {
    var Project = app.project.constructor;
}

FASTPASS.Project = (function() {
    $.writeln("[3_Project] Inicializando módulo...");

    // --- HELPERS PRIVATS (LITERALS) ---

    function _focus() {
        if ($.global.FASTPASS_WorkProject instanceof Project) {
            return $.global.FASTPASS_WorkProject;
        }
        return app.project;
    }

    function _item(collection, name) {
        if (!collection) return null;
        for (var i = 0; i < collection.numItems; i++) {
            if (collection[i].name === name) return collection[i];
        }
        if (collection.numSequences) {
            for (var j = 0; j < collection.numSequences; j++) {
                if (collection[j].name === name) return collection[j];
            }
        }
        return null;
    }

    function _search(folder, name) {
        for (var i = 0; i < folder.children.numItems; i++) {
            var child = folder.children[i];
            if (child.name === name) return child;
            if (child.type === 2) { 
                var found = _search(child, name);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * _ticksToSeconds: Converteix ticks del DOM a segons usant la classe Time de
     * Premiere (així no depenem del factor fix 254016000000, que és fràgil).
     * @param {number} ticks
     * @returns {number} segons, 0 si no es pot convertir
     */
    function _ticksToSeconds(ticks) {
        try {
            var t = new Time();
            t.ticks = ticks;
            var s = t.seconds;
            if (typeof s === 'number' && !isNaN(s) && s > 0) return s;
        } catch (e) {}
        return 0;
    }

    /**
     * _timeToSeconds: Normalitza la durada d'un ítem del projecte a SEGONS.
     * Al DOM de Premiere, projectItem.duration NO sempre és un número:
     *   - numero (segons)               → es retorna tal qual
     *   - objecte Time amb .seconds     → es llegeix .seconds
     *   - objecte TickTime amb .ticks   → es converteix amb _ticksToSeconds
     * Els tests simulaven un número i a producció (2026-09-15) totes les
     * durades arribaven a 0 → cap Tema‑Titol gran detectat al bin CHY.
     * @param {*} v
     * @returns {number} segons (0 si no es pot determinar)
     */
    function _timeToSeconds(v) {
        if (v === null || v === undefined) return 0;
        if (typeof v === 'number') {
            if (isNaN(v) || v <= 0) return 0;
            return (v > 100000) ? _ticksToSeconds(v) : v;
        }
        if (typeof v === 'string') {
            var n = parseFloat(v);
            if (isNaN(n) || n <= 0) return 0;
            return (n > 100000) ? _ticksToSeconds(n) : n;
        }
        try {
            var s = v.seconds;
            if (typeof s === 'function') s = v.seconds();
            if (typeof s === 'number' && !isNaN(s) && s > 0) return s;
        } catch (e1) {}
        try {
            var k = v.ticks;
            if (typeof k === 'function') k = v.ticks();
            if (typeof k === 'number' && !isNaN(k) && k > 0) return _ticksToSeconds(k);
        } catch (e2) {}
        return 0;
    }

    /**
     * _safeStr: Conversió a string tolerant (mai llança) per a diagnòstics.
     */
    function _safeStr(v) {
        try { return String(v); } catch (e) { return '?'; }
    }

    /**
     * _fileSize: Mida en bytes del media d'un ítem (0 si no és accessible).
     * Serveix de xarxa de seguretat per estimar la durada quan el DOM no la dóna.
     * @param {object} it - projectItem de tipus footage
     * @returns {number}
     */
    function _fileSize(it) {
        try {
            var f = new File(it.getMediaPath());
            if (f.exists) return f.length;
        } catch (e) {}
        return 0;
    }

    return {
        
        // --- 1. GESTIÓ DE PROJECTE ---
        
        save: function() {
            try {
                var p = _focus();
                if (p) { p.save(); return "OK"; }
                return "ERR:NO_PROJ";
            } catch(e) { return "ERR:" + e.message; }
        },

        saveAs: function(pathString) {
            var log = [];
            log.push("--- INICI SAVE AS ---");
            
            try {
                // 1. Verificació de l'input
                if (!pathString) return "ERR: Camí buit";
                log.push("1. Rebut: " + pathString);
        
                // 2. Normalització de ruta per a Adobe
                var cleanPath = pathString.replace(/\\/g, "/");
                log.push("2. Ruta neta: " + cleanPath);
        
                var myFile = new File(cleanPath);
                log.push("3. File object creat. fsName: " + myFile.fsName);
        
                // 3. Verificació de la carpeta pare
                if (!myFile.parent.exists) {
                    log.push("4. La carpeta pare no existeix. Intentant crear: " + myFile.parent.fsName);
                    var created = myFile.parent.create();
                    log.push("   Resultat creació carpeta: " + created);
                } else {
                    log.push("4. Carpeta pare confirmada.");
                }
        
                // 4. Estat del projecte
                var p = app.project; 
                if (!p) {
                    log.push("❌ ERROR: app.project és undefined");
                    return "ERR: No hi ha projecte actiu al motor";
                }
                log.push("5. Projecte detectat: " + p.name);
                log.push("   Ruta actual: " + p.path);
        
                // 5. INTENT DE GUARDAT
                log.push("6. Llançant p.saveAs()...");
                var success = p.saveAs(myFile.fsName);
                
                // 6. Verificació Post-Acció
                if (success) {
                    log.push("✅ Premiere ha retornat SUCCESS");
                    $.global.FASTPASS_WorkProject = p;
                    return "OK";
                } else {
                    log.push("❌ Premiere ha retornat FALSE (Rejected)");
                    
                    // Verificació "Física" (a vegades Premiere diu false però ho fa)
                    if (myFile.exists) {
                        log.push("⚠️ El fitxer existeix al disc malgrat el false de Premiere. Donem per OK.");
                        $.global.FASTPASS_WorkProject = p;
                        return "OK";
                    }
                    
                    var errorReport = log.join(" | ");
                    return "ERR: Guardat rebutjat per Premiere. Logs: " + errorReport;
                }
        
            } catch(e) { 
                return "ERR_EXCEPTION: " + e.message + " | Stack: " + log.join(" -> ");
            }
        },
        
        open: function(pathString) {
            try {
                $.writeln("[3_Project.open] Ruta recibida: " + pathString);
                var cleanPath = pathString.replace(/\\/g, "/");
                $.writeln("[3_Project.open] Ruta limpia: " + cleanPath);
                var f = new File(cleanPath);
                
                $.writeln("[3_Project.open] Verificando existencia...");
                if (!f.exists) {
                    $.writeln("[3_Project.open] ERROR: El archivo no existe en " + cleanPath);
                    return "ERR:NOT_EXISTS_AT_" + cleanPath;
                }
                $.writeln("[3_Project.open] Archivo existe. fsName: " + f.fsName);
        
                // Intentamos abrir el documento
                $.writeln("[3_Project.open] Llamando app.openDocument...");
                var ok = app.openDocument(f.fsName);
                $.writeln("[3_Project.open] Resultado de openDocument: " + ok);
                
                // Premiere a veces devuelve true aunque el proyecto tarde unos ms en cargar
                if (ok) {
                    $.global.FASTPASS_WorkProject = app.project;
                    $.writeln("[3_Project.open] Proyecto abierto correctamente. WorkProject asignado.");
                    return "OK";
                }
                $.writeln("[3_Project.open] ERROR: openDocument devolvió false.");
                return "ERR:OPEN_FAILED";
            } catch(e) {
                $.writeln("[3_Project.open] EXCEPCIÓN: " + e.message);
                return "ERR:" + e.message;
            }
        },

        close: function() {
            try {
                $.writeln("[3_Project.close] Cerrando proyecto...");
                var p = _focus();
                if (p) {
                    // Guardar antes de cerrar solo si el proyecto tiene ruta
                    if (p.path && p.path !== "") {
                        try {
                            p.save();
                            $.writeln("[3_Project.close] Proyecto guardado.");
                        } catch (saveErr) {
                            $.writeln("[3_Project.close] Advertencia: No se pudo guardar: " + saveErr.message);
                        }
                    } else {
                        $.writeln("[3_Project.close] Proyecto sin ruta, no se guarda.");
                    }
                    // Cerrar documento
                    var ok = app.project.closeDocument();
                    $.writeln("[3_Project.close] Resultado de closeDocument: " + ok);
                    // Limpiar referencia global
                    $.global.FASTPASS_WorkProject = null;
                    if (ok) {
                        return "OK";
                    } else {
                        return "ERR:CLOSE_FAILED";
                    }
                } else {
                    $.writeln("[3_Project.close] No hay proyecto activo.");
                    return "ERR:NO_PROJECT";
                }
            } catch(e) {
                $.writeln("[3_Project.close] EXCEPCIÓN: " + e.message);
                return "ERR:" + e.message;
            }
        },

        path: function() {
            $.writeln("[3_Project.path] Llamada a path");
            try {
                var p = _focus();
                $.writeln("[3_Project.path] p: " + (p ? "defined" : "null"));
                if (p && p.path) {
                    $.writeln("[3_Project.path] p.path: " + p.path);
                    return p.path;
                }
                $.writeln("[3_Project.path] No hay proyecto o ruta");
                return "";
            } catch(e) {
                $.writeln("[3_Project.path] Error: " + e.message);
                return "";
            }
        },

        // --- 2. ITEMS & BINS ---

        items: function(binName) {
            try {
                var p = _focus();
                var container = binName ? _item(p.rootItem.children, binName) : p.rootItem;
                if (!container || !container.children) return "[]";

                var results = [];
                for (var i = 0; i < container.children.numItems; i++) {
                    var it = container.children[i];
                    var isFootage = (it.type === 1);
                    results.push({
                        name: it.name,
                        type: it.type,
                        mediaPath: isFootage ? it.getMediaPath() : "",
                        duration: isFootage ? _timeToSeconds(it.duration) : 0,
                        size: isFootage ? _fileSize(it) : 0,
                        durationRaw: isFootage ? _safeStr(it.duration) : ""
                    });
                }
                return JSON.stringify(results);
            } catch(e) { return "[]"; }
        },

        /**
         * itemDuration: Retorna la durada en segons d'un element de projecte (footage).
         * @param {string} itemName - Nom de l'element (amb o sense extensió)
         * @returns {number} Durada en segons, o 0 si no es troba.
         */
        itemDuration: function(itemName) {
            try {
                var p = _focus();
                if (!p) return 0;
                var name = decodeURIComponent(itemName).replace(/^\s+|\s+$/g, '');
                var item = _search(p.rootItem, name);
                if (!item) {
                    // Intentar sense extensió
                    var lastDot = name.lastIndexOf(".");
                    if (lastDot > 0) {
                        item = _search(p.rootItem, name.substring(0, lastDot));
                    }
                }
                if (!item) return 0;
                // El DOM pot retornar un número, un Time (.seconds) o un TickTime
                // (.ticks): ho resol _timeToSeconds (fix 2026-09-15).
                return _timeToSeconds(item.duration);
            } catch(e) {
                $.writeln("[3_Project.itemDuration] Error: " + e.message);
                return 0;
            }
        },

        find: function(nameEncoded) {
            var name = decodeURIComponent(nameEncoded).replace(/^\s+|\s+$/g, '');
            $.writeln("🔍 [JSX-DEBUG] find buscando: " + name);
            return _search(_focus().rootItem, name);
        },

        rename: function(nameEncoded, newNameEncoded) {
            $.writeln("🔍 [JSX-DEBUG] rename llamado: " + nameEncoded + " -> " + newNameEncoded);
            var p = _focus();
            var name = decodeURIComponent(nameEncoded).replace(/^\s+|\s+$/g, '');
            var newName = decodeURIComponent(newNameEncoded).replace(/^\s+|\s+$/g, '');
            $.writeln("   decode: '" + name + "' -> '" + newName + "'");
            
            // Buscar en secuencias primero
            var seq = _item(p.sequences, name);
            if (seq) {
                $.writeln("   ✅ Seqüència trobada, renombrant...");
                seq.name = newName;
                return "OK";
            }
            
            // Si no es secuencia, buscar en bins/items
            var it = this.find(nameEncoded); // find ya decodifica
            if (it) {
                $.writeln("   ✅ Item bin trobat, renombrant...");
                it.name = newName;
                return "OK";
            }
            $.writeln("   ❌ No s'ha trobat cap seqüència ni item amb el nom: " + name);
            return "ERR:NOT_FOUND";
        },

        move: function(itemNameEncoded, binNameEncoded) {
            $.writeln("🔍 [JSX-DEBUG] move llamado: " + itemNameEncoded + " -> " + binNameEncoded);
            var p = _focus();
            var it = this.find(itemNameEncoded); // find ya decodifica
            var binName = decodeURIComponent(binNameEncoded).replace(/^\s+|\s+$/g, '');
            var bin = _item(p.rootItem.children, binName) || p.rootItem;
            if (it && bin) { it.moveBin(bin); return "OK"; }
            return "ERR:MOVE_FAILED";
        },

        bin: function(nameEncoded) {
            var p = _focus();
            var name = decodeURIComponent(nameEncoded).replace(/^\s+|\s+$/g, '');
            var existing = _item(p.rootItem.children, name);
            if (existing) return existing;
            var newBin = p.rootItem.createBin(name);
            return newBin ? newBin : p.rootItem;
        },

        biggestIn: function(binName) {
            try {
                var bin = this.find(binName);
                if (!bin || bin.children.numItems === 0) return "null";

                var maxItem = null;
                var maxSize = 0;
                for (var i = 0; i < bin.children.numItems; i++) {
                    var item = bin.children[i];
                    if (item.type === 1) {
                        var f = new File(item.getMediaPath());
                        if (f.exists && f.length > maxSize) {
                            maxSize = f.length;
                            maxItem = item;
                        }
                    }
                }
                if (maxItem) return JSON.stringify({ name: maxItem.name, size: maxSize });
                return "null";
            } catch(e) { return "null"; }
        },

        findItemByID: function(id) {
            var p = app.project;
            for (var i = 0; i < p.rootItem.children.numItems; i++) {
                var item = p.rootItem.children[i];
                // Si el nombre del item contiene el ID numérico
                if (item.name.indexOf(id) !== -1) {
                    return item;
                }
            }
            return null;
        },
        
        moveByID: function(id, binName) {
            var p = _focus();
            var targetBin = this.bin(binName);
            var found = false;
        
            // Log inicial para saber qué recibe el motor
            $.writeln("🔍 [JSX-DEBUG] Buscant ID: '" + id + "' per moure a: " + binName);
            var binDisplayName = targetBin ? (targetBin.name || String(targetBin)) : "NULL";
            $.writeln("   targetBin: " + binDisplayName);
        
            if (!targetBin) {
                return "ERR:BIN_NOT_CREATED";
            }
        
            // Busquem a tots els fills del Root
            for (var i = 0; i < p.rootItem.children.numItems; i++) {
                var item = p.rootItem.children[i];
                
                // Log de cada item que inspeccionem (ajuda a veure si Premiere ha canviat el nom)
                // $.writeln("   - Analitzant item [" + i + "]: " + item.name);
        
                if (item.name.indexOf(id) !== -1) {
                    $.writeln("   ✅ COINCIDÈNCIA TROBADA! Movent '" + item.name + "'...");
                    try {
                        item.moveBin(targetBin);
                        $.writeln("   ✅ Movido '" + item.name + "' a '" + (targetBin.name || String(targetBin)) + "'");
                        found = true;
                        break;
                    } catch (e) {
                        return "ERR:EXCEPTION_DURING_MOVE: " + e.message;
                    }
                }
            }
        
            if (found) return "OK";
            
            $.writeln("   ❌ No s'ha trobat cap item que contingui l'ID: " + id);
            return "ERR:NOT_FOUND_IN_ROOT";
        },

        // --- 3. SEQCÜÈNCIES ---

        list: function() {
            try {
                var p = _focus();
                var results = [];
                for (var i = 0; i < p.sequences.numSequences; i++) {
                    results.push({
                        name: p.sequences[i].name,
                        id: p.sequences[i].sequenceID
                    });
                }
                return JSON.stringify(results);
            } catch(e) { return "[]"; }
        },

        cloneSeq: function(sourceNameEncoded) {
            try {
                var p = _focus();
                if (!p) return "ERR:NO_PROJECT";

                // 1. Decodificamos y limpiamos espacios
                var sourceName = decodeURIComponent(sourceNameEncoded).replace(/^\s+|\s+$/g, '');
                var foundSeq = null;
        
                // 2. Buscamos directamente en la colección de secuencias del proyecto
                // Esto es más eficiente que recorrer los bins y evita el error de getSequence()
                for (var i = 0; i < p.sequences.numSequences; i++) {
                    var s = p.sequences[i];
                    if (s && s.name.replace(/^\s+|\s+$/g, '') === sourceName) {
                        foundSeq = s;
                        break;
                    }
                }
        
                // 3. Ejecución del clonaje
                if (foundSeq) {
                    foundSeq.clone(); 
                    // Al clonar, Premiere activa automáticamente la nueva copia
                    return app.project.activeSequence.name;
                }
                
                return "ERR:SEQ_NOT_FOUND:" + sourceName;
            } catch (e) { 
                return "ERR:" + e.message; 
            }
        },

        openSeq: function(name) {
            var p = _focus();
            var seq = _item(p.sequences, name);
            if (seq) { p.openSequence(seq.sequenceID); return "OK"; }
            return "ERR:NOT_FOUND";
        },

        byName: function(name) {
            var p = _focus();
            var seq = _item(p.sequences, name);
            return seq || p.activeSequence;
        },

        byTokens: function(tokenProg, tokenBloc) {
            try {
                var p = _focus();
                for (var i = 0; i < p.sequences.numSequences; i++) {
                    var s = p.sequences[i];
                    if (s && s.name.indexOf(tokenProg) !== -1 && s.name.indexOf(tokenBloc) !== -1) {
                        return String(s.name);
                    }
                }
                return "ERR:NOT_FOUND";
            } catch(e) { return "ERR:" + e.message; }
        }
    };
})();

var Project = FASTPASS.Project;
