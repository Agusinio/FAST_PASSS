/*
 * =================================================================================
 * MODULE: PROJECT (v10 - DRY VERSION)
 * ARXIU: modules/3_Project.jsx
 * =================================================================================
 */

var FASTPASS = $.global.FASTPASS || {};
FASTPASS.Project = (function() {

    // --- GENERIC HELPERS (PRIVATE) ---

    function getTargetProject(path) {
        // Si tenemos una ancla global y es un proyecto, mandamos nosotros
        if ($.global.FASTPASS_WorkProject instanceof Project) {
            return $.global.FASTPASS_WorkProject;
        }
        // Si no, lo que diga Premiere
        return app.project;
    }

    // Un iterator genèric per a qualsevol col·lecció de Premiere
    function findInCollection(collection, name) {
        if (!collection) return null;
        for (var i = 0; i < collection.numItems; i++) {
            if (collection[i].name === name) return collection[i];
        }
        // Cas especial per a Sequences collection (que no usa numItems sino .numSequences)
        if (collection.numSequences) {
            for (var j = 0; j < collection.numSequences; j++) {
                if (collection[j].name === name) return collection[j];
            }
        }
        return null;
    }

    function searchRecursive(folder, name) {
        for (var i = 0; i < folder.children.numItems; i++) {
            var child = folder.children[i];
            if (child.name === name) return child;
            if (child.type === 2) { // 2 = Bin
                var found = searchRecursive(child, name);
                if (found) return found;
            }
        }
        return null;
    }

    return {
        
        // --- 1. GESTIÓN DE PROYECTO ---
        
        save: function() {
            try {
                var proj = getTargetProject();
                if (proj) {
                    proj.save();
                    return true;
                }
                return false;
            } catch(e) { return false; }
        },

        saveAs: function(pathString) {
            try {
                // 1. Limpiamos la ruta de posibles dobles barras accidentales (excepto al inicio)
                var cleanPath = pathString.replace(/\\/g, "/");
                if (pathString.indexOf("\\\\") === 0) cleanPath = "//" + cleanPath.substring(2).replace(/\/+/g, "/");
        
                // 2. Creamos un objeto File. Esto es vital para que Premiere acepte la ruta.
                var myFile = new File(cleanPath);
        
                // 3. Verificamos una última vez desde JSX si la carpeta existe
                if (!myFile.parent.exists) {
                    myFile.parent.create();
                }
        
                // 4. Intentamos el guardado usando .fsName (Ruta nativa del OS)
                var currentProj = getTargetProject();
                $.writeln("🧪 [JSX] Intentant saveAs a: " + myFile.fsName);
                var success = currentProj.saveAs(myFile.fsName);
                
                if (success) {
                    $.global.FASTPASS_WorkProject = currentProj;
                    return "OK";
                }
                
                return "ERR: Premiere ha rebutjat el saveAs a " + myFile.fsName;
            } catch(e) { 
                return "ERR: " + e.message; 
            }
        },

        openProject: function(path) {
            try {
                var f = new File(path);
                return f.exists ? app.openDocument(f.fsName) : false;
            } catch(e) { return false; }
        },

        // --- 2. ACCIONES SOBRE ITEMS (ATOMISMO) ---

        listItems: function(binName, projectPath) {
            try {
                var proj = getTargetProject(projectPath);
                var container = binName ? findInCollection(proj.rootItem.children, binName) : proj.rootItem;
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

        findItem: function(name, projectPath) {
            return searchRecursive(getTargetProject(projectPath).rootItem, name);
        },

        renameItem: function(name, newName, projectPath) {
            var it = this.findItem(name, projectPath);
            if (it) { it.name = newName; return true; }
            return false;
        },

        moveItem: function(itemName, binName, projectPath) {
            var proj = getTargetProject(projectPath);
            var it = this.findItem(itemName, projectPath);
            var bin = findInCollection(proj.rootItem.children, binName) || proj.rootItem;
            if (it && bin) { it.moveBin(bin); return true; }
            return false;
        },

        // --- 3. SECUENCIAS ---

        cloneSequence: function(sourceName) {
            try {
                var proj = getTargetProject();
                // Buscamos la secuencia usando tu helper existente
                var seq = findInCollection(proj.sequences, sourceName);
                
                if (seq) {
                    // 1. Clonamos
                    seq.clone();
                    // 2. Premiere siempre hace que el clon sea la secuencia ACTIVA.
                    // Devolvemos el nombre exacto que Premiere le ha puesto (sea "Copy", "Copy 01", etc.)
                    return proj.activeSequence.name; 
                }
                return "ERR: Source not found";
            } catch (e) {
                return "ERR: " + e.message;
            }
        },

        openSequence: function(name, projectPath) {
            var proj = getTargetProject(projectPath);
            var seq = findInCollection(proj.sequences, name);
            if (seq) { proj.openSequence(seq.sequenceID); return true; }
            return false;
        },

        listSequences: function(projectPath) {
            try {
                var proj = getTargetProject(projectPath);
                var results = [];
                for (var i = 0; i < proj.sequences.numSequences; i++) {
                    results.push({
                        name: proj.sequences[i].name,
                        id: proj.sequences[i].sequenceID
                    });
                }
                return JSON.stringify(results);
            } catch(e) { return "[]"; }
        },

        createBin: function(name, projectPath) {
            var proj = getTargetProject(projectPath);
            var existing = findInCollection(proj.rootItem.children, name);
            return existing || proj.rootItem.createBin(name);
        }, 

        /**
         * Busca una secuencia por su nombre en todo el proyecto.
         */
        findSequenceByName: function(name) {
            var proj = getTargetProject();
            if (!proj) return null;
            for (var i = 0; i < proj.sequences.numSequences; i++) {
                if (proj.sequences[i].name === name) {
                    return proj.sequences[i];
                }
            }
            // Si no la encuentra por nombre, devolvemos la activa como último recurso
            return proj.activeSequence;
        }, 

        findSequenceByTokens: function(tokenProg, tokenBloc) {
            $.writeln("🚀 [JSX]: Iniciant findSequenceByTokens...");
            $.writeln("🔍 [JSX]: Buscant Prog: [" + tokenProg + "] Bloc: [" + tokenBloc + "]");
        
            try {
                var proj = app.project;
                if (!proj) {
                    $.writeln("❌ [JSX]: Error - app.project és undefined");
                    return "ERR:NO_PROJECT";
                }
        
                var totalSeqs = proj.sequences.numSequences;
                $.writeln("📊 [JSX]: Total seqüències al projecte: " + totalSeqs);
        
                for (var i = 0; i < totalSeqs; i++) {
                    var s = proj.sequences[i];
                    if (!s) {
                        $.writeln("⚠️ [JSX]: Seqüència en índex " + i + " és null!");
                        continue;
                    }
        
                    var name = s.name;
                    $.writeln("👀 [JSX]: Comprovant: " + name);
        
                    // Verificació de tokens
                    var hasProg = (name.indexOf(tokenProg) !== -1);
                    var hasBloc = (name.indexOf(tokenBloc) !== -1);
        
                    if (hasProg && hasBloc) {
                        $.writeln("🎯 [JSX]: MATCH TROBAT! -> " + name);
                        return String(name);
                    }
                }
        
                $.writeln("empty [JSX]: No s'ha trobat cap match.");
                return "ERR:NOT_FOUND";
        
            } catch(e) {
                $.writeln("💥 [JSX CRITICAL ERROR]: " + e.message);
                return "ERR_JSX_EXCEPTION:" + e.message;
            }
        }
    };
})();

$.global.jsx_openProject = function(path, newSequenceName) {
    // 1. Intentem obrir el projecte
    var success = FASTPASS.Project.openProject(path); 
    
    if (success) {
        // 📍 MICRO-CIRURGIA: Renombrar la seqüència activa
        // Un cop obert, app.project ja és el projecte nou.
        if (app.project.activeSequence && newSequenceName) {
            app.project.activeSequence.name = newSequenceName;
        }
        
        $.global.FASTPASS_WorkProject = app.project; 
        return "OK";
    }
    return "ERR";
};

$.global.jsx_saveProjectAs = function(pathString) {
    $.writeln("📂 [JSX-BRIDGE] Intentant guardar com a: " + pathString);
    return FASTPASS.Project.saveAs(pathString);
};

$.global.jsx_createBin = function(name) {
    // Usem el teu àtom de creació de Bins
    return FASTPASS.Project.createBin(name);
};