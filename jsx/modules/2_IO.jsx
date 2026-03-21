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
                var proj = targetProj || FASTPASS_WorkProject || app.project;
                
                if (paths.length === 0) return "OK_EMPTY";
    
                var targetBin = (binName && binName !== "root") ? 
                                FASTPASS.Project.createBin(binName, proj) : 
                                proj.rootItem;
    
                proj.importFiles(paths, true, targetBin, false);
                return "OK";
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
        }
    };
})();

// --- PUENTES (BRIDGES) GLOBALES ---

// Corregido: Ahora llama a getRawFiles
$.global.jsx_scanDirectory = function(path) {
    return FASTPASS.IO.getRawFiles(path);
};

// Corregido: Ahora llama a importFilesAtómico y usa la lógica de anclaje
$.global.jsx_importFiles = function(jsonPaths, binName) {
    var proj = FASTPASS_WorkProject || app.project;
    return FASTPASS.IO.importFiles(jsonPaths, binName, proj);
};

$.global.jsx_deleteFile = function(path) {
    return FASTPASS.IO.deleteFile(path);
};