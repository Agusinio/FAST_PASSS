/**
 * ============================================================================
 * 12_Arxiu.jsx (ENTRADA/SORTIDA DE FITXERS I IMPORTACIÓ)
 * ============================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Arxiu = (function () {
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
                if (!jsonPaths) return "ERR: Payload vacío";
                var paths = JSON.parse(jsonPaths);
                var proj = app.project;
                if (!proj) throw new Error("No hay proyecto activo");
                proj.importFiles(paths, true, proj.rootItem, false);
                return "OK";
            } catch (e) { 
                return "ERR: JSON.parse falló. Payload recibido: " + jsonPaths.substring(0, 50) + "... | Error: " + e.message; 
            }
        },

        /**
         * lookFor: Verifica la presència de fitxers al projecte.
         */
        lookFor: function (jsonNames) {
            try {
                var names = JSON.parse(jsonNames);
                for (var i = 0; i < names.length; i++) {
                    if (!FASTPASS.Projecte.find(names[i])) return "false";
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
                if (!f.parent.exists) { f.parent.create(); }
                f.open('w');
                f.encoding = "UTF-8";
                f.write(content);
                f.close();
                return "OK";
            } catch(e) { 
                return "ERR en Arxiu.jsx: " + e.message; 
            }
        },

        /**
         * exists: Comprova si el fitxer existeix en el sistema d'arxius.
         */
        exists: function(path) {
            if (!path) return "false";
            var f = new File(path);
            return (f.exists && f instanceof File) ? "true" : "false";
        },

        /**
         * getUser: Obté el nom d'usuari de l'OS.
         */
        getUser: function() {
            return $.global.userName || $.getenv("USERNAME") || $.getenv("USER") || "UnknownUser";
        }
    };
})();