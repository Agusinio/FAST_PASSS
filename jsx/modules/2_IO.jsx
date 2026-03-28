// ============================================================================
// 2_IO.jsx (ENTRADA/SORTIDA DE FITXERS I IMPORTACIÓ) - ATÓMICO
// ============================================================================

$.global.FASTPASS = $.global.FASTPASS || {};

FASTPASS.IO = (function () {
    return {
        // ATÓMICO: Solo lee disco y devuelve info cruda
        getRawFiles: function (folderPath) {
            var folder = new Folder(folderPath);
            if (!folder.exists) return "[]";
    
            var allFiles = folder.getFiles(); 
            var result = [];
            
            for (var i = 0; i < allFiles.length; i++) {
                var f = allFiles[i];
                if (f instanceof File) {
                    result.push({
                        name: f.name,
                        path: f.fsName,
                        modified: f.modified.getTime(),
                        size: f.length
                    });
                }
            }
            return JSON.stringify(result);
        },

        // ATÓMICO: Solo recibe rutas limpias e importa
        importFiles: function (jsonPaths, binName, targetProj) {
            try {
                var paths = JSON.parse(jsonPaths);
                
                // 🛡️ Blindatge total: busquem el projecte en aquest ordre
                var proj = (targetProj instanceof Project) ? targetProj : 
                           ($.global.FASTPASS_WorkProject instanceof Project) ? $.global.FASTPASS_WorkProject : 
                           app.project;
                
                if (paths.length === 0) return "OK_EMPTY";
                if (!proj) throw new Error("No s'ha trobat cap projecte actiu.");
        
                // Passem el 'proj' que hem validat a createBin
                var targetBin = (binName && binName !== "root") ? 
                                FASTPASS.Project.createBin(binName, proj) : 
                                proj.rootItem;
        
                proj.importFiles(paths, true, targetBin, false);
                
                if (targetBin.children.numItems < paths.length && binName !== "root") {
                    $.writeln("⚠️ [JSX] Alguns fitxers no s'han importat. Possible extensió no suportada.");
                }

            } catch (e) {
                return "ERR: " + e.message;
            }
        },

        verifyItems: function (jsonNames) {
            try {
                var names = JSON.parse(jsonNames);
                for (var i = 0; i < names.length; i++) {
                    if (!FASTPASS.Project.findItemInProject(names[i])) return "false";
                }
                return "true";
            } catch (e) { return "false"; }
        },

        deleteFile: function(path) {
            try {
                var f = new File(path);
                if (f.exists) return f.remove();
            } catch(e) { $.writeln("Error borrando: " + e.message); }
            return false;
        },

        readTextFile: function(path) {
            try {
                var f = new File(path);
                if (!f.exists) return "";
                f.open('r');
                var content = f.read();
                f.close();
                return content;
            } catch(e) { return ""; }
        },

        writeTextFile: function(path, content) {
            try {
                var f = new File(path);
                f.open('w');
                f.write(content);
                f.close();
                return "OK";
            } catch(e) { return "ERR: " + e.message; }
        },

        fileExists: function(path) {
            var f = new File(path);
            return f.exists;
        },

        getUserName: function() {
            // Retorna el nom de l'usuari actual de l'OS
            return $.global.userName || $.getenv("USERNAME") || $.getenv("USER") || "UnknownUser";
        }
    };
})();

// --- PUENTES (BRIDGES) GLOBALES ---

$.global.jsx_scanDirectory = function(path) {
    return FASTPASS.IO.getRawFiles(path);
};

$.global.jsx_importFiles = function(pathsArray, binName) {
    try {
        var jsonPaths = JSON.parse(JSON.stringify(pathsArray));
        return FASTPASS.IO.importFiles(JSON.stringify(jsonPaths), binName);
    } catch (e) {
        return "ERR: " + e.message;
    }
};

$.global.jsx_getBinContent = function(binName) {
    try {
        var proj = $.global.FASTPASS_WorkProject || app.project;
        // Busquem el Bin
        var bin = null;
        for (var i = 0; i < proj.rootItem.children.numItems; i++) {
            var item = proj.rootItem.children[i];
            if (item.name === binName && item.type === 2) { // 2 = Bin
                bin = item;
                break;
            }
        }
        if (!bin) return "[]";

        // Llistem els noms dels fitxers que ja hi ha
        var names = [];
        for (var j = 0; j < bin.children.numItems; j++) {
            names.push(bin.children[j].name);
        }
        return JSON.stringify(names);
    } catch(e) {
        return "ERR: " + e.message;
    }
};

$.global.jsx_deleteFile = function(path) {
    return FASTPASS.IO.deleteFile(path);
};

$.global.jsx_readTextFile = function(path) {
    return FASTPASS.IO.readTextFile(path);
};

$.global.jsx_writeTextFile = function(path, content) {
    return FASTPASS.IO.writeTextFile(path, content);
};

$.global.jsx_fileExists = function(path) {
    return FASTPASS.IO.fileExists(path) ? "true" : "false";
};

$.global.jsx_getUserName = function() {
    return FASTPASS.IO.getUserName();
};