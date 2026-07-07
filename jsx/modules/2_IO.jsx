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
                    var sz = f.length;
                    // Si length es 0 (fallo común con .mov en red UNC), usar eof
                    if (!sz || sz === 0) {
                        try {
                            var opened = f.open("r");
                            if (opened) {
                                sz = f.eof;
                                f.close();
                            }
                        } catch (e) {
                            sz = 0;
                        }
                    }
                    result.push({
                        name: f.name,
                        path: f.fsName,
                        modified: f.modified.getTime(),
                        created: f.created ? f.created.getTime() : f.modified.getTime(),
                        size: sz
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
                // 📍 LOG DE INSPECCIÓN (Se ve en la consola de ExtendScript o el log de la extensión)
                // Si jsonPaths no es un string válido, aquí lo sabremos
                if (!jsonPaths) return "ERR: Payload vacío";
        
                var paths = JSON.parse(jsonPaths);
                
                // El resto del código de importación...
                var proj = app.project;
                if (!proj) throw new Error("No hay proyecto activo");
        
                // IMPORTANTE: Premiere Pro necesita que los archivos existan
                // Verificamos si el primer archivo existe para debuggear
                if (paths.length > 0 && !(new File(paths[0])).exists) {
                     // Si el archivo no existe, el parse fue bien pero la ruta está mal
                     // No bloqueamos, pero lo dejamos como aviso
                }
        
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
                // 📍 BLINDAJE 3: Convertimos a objeto File inmediatamente
                var f = new File(path);
                
                if (!f.parent.exists) {
                    f.parent.create();
                }
                
                f.open('w');
                f.encoding = "UTF-8"; // Aseguramos codificación
                f.write(content);
                f.close();
                
                return "OK";
            } catch(e) { 
                return "ERR en IO.jsx: " + e.message; 
            }
        },

        /**
         * exists: Comprova si el fitxer existeix en el sistema d'arxius.
         */
        exists: function(path) {
            if (!path) return "false";
            var f = new File(path);
            // En ExtendScript, un objeto File puede apuntar a una carpeta.
            // Verificamos que sea un archivo real y no una carpeta.
            return (f.exists && f instanceof File) ? "true" : "false";
        },

        /**
         * getUser: Obté el nom d'usuari de l'OS.
         */
        getUser: function() {
            return $.global.userName || $.getenv("USERNAME") || $.getenv("USER") || "UnknownUser";
        },

        /**
         * executeShell: Executa una comanda de sistema mitjançant un .bat temporal.
         * Dissenyat per a entorns Windows on Node.js està restringit.
         */
        executeShell: function (command) {
            try {
                // 1. Crear el fitxer .bat a la carpeta temporal del sistema
                var tempFile = new File(Folder.temp + "/fp_exec_" + new Date().getTime() + ".bat");
                
                tempFile.open('w');
                tempFile.writeln("@echo off");
                tempFile.writeln("echo [FASTPASS] Executant tasca de sistema...");
                tempFile.writeln(command);
                tempFile.writeln("exit");
                tempFile.close();
                
                // 2. Executar (obre una finestra de CMD)
                var success = tempFile.execute();
                
                return success ? "OK_EXECUTING" : "ERR_EXECUTE_FAILED";
            } catch (e) {
                return "ERR: " + e.message;
            }
        }
    };
})();