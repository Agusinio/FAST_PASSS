/**
 * ============================================================================
 * 2_IO.jsx (ENTRADA/SORTIDA DE FITXERS I IMPORTACIÓ) - v2.5.8 literal
 * ============================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.IO = (function () {
    return {
        
        /**
         * scanDirectory: Llista el contingut d'una carpeta del sistema.
         */
        scanDirectory: function (folderPath) {
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

        /**
         * importFiles: Importa fitxers (JSON array de rutes) a un Bin específic.
         */
        importFiles: function (jsonPaths, binName) {
            try {
                var paths = JSON.parse(jsonPaths);
                var proj = ($.global.FASTPASS_WorkProject instanceof Project) ? $.global.FASTPASS_WorkProject : app.project;
                
                if (paths.length === 0) return "OK_EMPTY";
                if (!proj) throw new Error("No s'ha trobat cap projecte actiu.");
        
                var targetBin = (binName && binName !== "root") ? 
                                FASTPASS.Project.bin(binName) : 
                                proj.rootItem;
        
                proj.importFiles(paths, true, targetBin, false);
                return "OK";
            } catch (e) { return "ERR: " + e.message; }
        },

        /**
         * lookFor: Verifica la presència de fitxers al projecte.
         */
        lookFor: function (jsonNames) {
            try {
                var names = JSON.parse(jsonNames);
                for (var i = 0; i < names.length; i++) {
                    if (!FASTPASS.Project.find(names[i])) return "false";
                }
                return "true";
            } catch (e) { return "false"; }
        },

        /**
         * remove: Esborra un fitxer físic del disc.
         */
        remove: function(path) {
            try {
                var f = new File(path);
                if (f.exists) return f.remove() ? "OK" : "ERR_REMOVE";
            } catch(e) { return "ERR: " + e.message; }
            return "NOT_EXISTS";
        },

        /**
         * readTxt: Llegeix contingut de text d'un fitxer.
         */
        readTxt: function(path) {
            try {
                var f = new File(path);
                if (!f.exists) return "";
                f.open('r');
                var content = f.read();
                f.close();
                return content;
            } catch(e) { return ""; }
        },

        /**
         * writeTxt: Escriu contingut de text en un fitxer.
         */
        writeTxt: function(path, content) {
            try {
                var f = new File(path);
                if (!f.parent.exists) f.parent.create();
                f.open('w');
                f.write(content);
                f.close();
                return "OK";
            } catch(e) { return "ERR: " + e.message; }
        },

        /**
         * exists: Comprova si el fitxer existeix en el sistema d'arxius.
         */
        exists: function(path) {
            return (new File(path)).exists;
        },

        /**
         * getUser: Obté el nom d'usuari de l'OS.
         */
        getUser: function() {
            return $.global.userName || $.getenv("USERNAME") || $.getenv("USER") || "UnknownUser";
        }
    };
})();