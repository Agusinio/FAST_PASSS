/**
 * =================================================================================
 * 3_Project.jsx
 * Gestió de projectes, Bins i seqüències (v12 - SUPER-LITERAL DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Project = (function() {

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
                var cleanPath = pathString.replace(/\\/g, "/");
                var f = new File(cleanPath);
                
                if (!f.exists) return "ERR:NOT_EXISTS_AT_" + cleanPath;
        
                // Intentamos abrir el documento
                var ok = app.openDocument(f.fsName);
                
                // Premiere a veces devuelve true aunque el proyecto tarde unos ms en cargar
                if (ok) {
                    $.global.FASTPASS_WorkProject = app.project;
                    return "OK";
                }
                return "ERR:OPEN_FAILED";
            } catch(e) { 
                return "ERR:" + e.message; 
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
                    results.push({
                        name: it.name,
                        type: it.type,
                        mediaPath: (it.type === 1) ? it.getMediaPath() : ""
                    });
                }
                return JSON.stringify(results);
            } catch(e) { return "[]"; }
        },

        find: function(nameEncoded) {
            var name = decodeURIComponent(nameEncoded).replace(/^\s+|\s+$/g, '');
            return _search(_focus().rootItem, name);
        },

        rename: function(nameEncoded, newNameEncoded) {
            var it = this.find(nameEncoded); // find ya decodifica
            if (it) { 
                it.name = decodeURIComponent(newNameEncoded).replace(/^\s+|\s+$/g, ''); 
                return "OK"; 
            }
            return "ERR:NOT_FOUND";
        },

        move: function(itemNameEncoded, binNameEncoded) {
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
            if (existing) return existing.name;
            var newBin = p.rootItem.createBin(name);
            return newBin ? newBin.name : "root";
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
            var p = app.project;
            var targetBin = this.bin(binName);
            var found = false;
        
            // Log inicial para saber qué recibe el motor
            $.writeln("🔍 [JSX-DEBUG] Buscant ID: '" + id + "' per moure a: " + binName);
        
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