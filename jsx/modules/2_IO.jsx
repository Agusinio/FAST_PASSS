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
                        // Data de CREACIÓ real. Mai fer servir modified com a created:
                        // el mtime del NAS pot estar desplaçat per processos nocturns.
                        created: f.created ? f.created.getTime() : 0,
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
         * copyFile: Copia un fitxer (binari o text) d'origen a destí.
         * Útil per copiar l'escaleta del NAS al directori del projecte.
         * @param {string} srcPath - Ruta d'origen (UNC o local)
         * @param {string} destPath - Ruta de destí completa (amb nom de fitxer)
         * @returns {string} "OK" o "ERR:..."
         */
        copyFile: function(srcPath, destPath) {
            try {
                var src = new File(srcPath);
                if (!src.exists) return "ERR_SRC_NOT_FOUND:" + srcPath;
                var dest = new File(destPath);
                if (!dest.parent.exists) {
                    var created = dest.parent.create();
                    if (!created) return "ERR_CREATE_DEST_FOLDER";
                }
                var ok = src.copy(destPath);
                return ok ? "OK" : "ERR_COPY_FAILED";
            } catch(e) { return "ERR: " + e.message; }
        },

        /**
         * createFolder: Crea una carpeta (i subcarpetes) si no existeix.
         * @param {string} folderPath - Ruta completa de la carpeta
         * @returns {string} "OK" o "ERR:..."
         */
        createFolder: function(folderPath) {
            try {
                var f = new Folder(folderPath);
                if (f.exists) return "OK";
                var created = f.create();
                return created ? "OK" : "ERR_CREATE_FOLDER";
            } catch(e) { return "ERR: " + e.message; }
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
                // ⚠️ BUGFIX (2026-09-16): cal `Folder.temp.fsName` (ruta nativa
                // C:\Users\...\Temp). `Folder.temp` com a string dóna la forma URI
                // ("~/AppData/Local/Temp"), que cmd.exe NO expande → qualsevol fitxer
                // creat o redirigit des del .bat acabava en una ruta inexistent.
                var tempFile = new File(Folder.temp.fsName + "\\fp_exec_" + new Date().getTime() + ".bat");
                
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
        },

        /**
         * curl: Executa una comanda curl per a l'API de digition.
         * Utilitza executeShell internament (sistema de fitxers temporal).
         * @param {string} url - URL completa amb paràmetres
         * @param {string} authHeader - Capçalera d'autorització
         * @returns {string} Contingut JSON de la resposta, o "ERR:missatge"
         */
        curl: function (url, authHeader) {
            try {
                var stamp = new Date().getTime();
                // ⚠️ BUGFIX (2026-09-16): `Folder.temp.fsName` (ruta nativa). Amb
                // `Folder.temp` com a string s'obtenia "~/AppData/Local/Temp", i cmd.exe
                // NO expandeix el '~' → el curl no podia escriure el fitxer de sortida i
                // el botó FOTO fallava SEMPRE amb ERR:CURL_EMPTY (verificat als .bat
                // del Temp del sistema: "> \"~/AppData/Local/Temp/fp_curl_....json\"").
                var tempDir = Folder.temp.fsName;
                var outFile = tempDir + "\\fp_curl_" + stamp + ".json";
                var errFile = tempDir + "\\fp_curl_" + stamp + ".err";

                // ── VIA 1 (preferida): system.callSystem ─────────────────────────
                // Executa curl directament (sense .bat, sense redireccions i ESPERANT
                // el procés). Evita tots els paranys de cmd.exe: finestra de CMD, '~'
                // no expandit, '%' expandit, i el bucle d'espera que bloquejava el motor
                // mono-fil. La URL ha d'anar SENSE '%' (escaleta_fetch no escapa els ':').
                var sysObj = null;
                try { if (typeof system !== "undefined" && system) sysObj = system; } catch (eS1) { sysObj = null; }
                if (!sysObj) { try { if ($.system) sysObj = $.system; } catch (eS2) { sysObj = null; } }
                try {
                    if (sysObj && sysObj.callSystem) {
                        var curlExeAbs = (new File("C:\\Windows\\System32\\curl.exe")).exists
                            ? "C:\\Windows\\System32\\curl.exe" : "curl";
                        // ⚠️ BUGFIX (2026-09-17): en aquest equip `system.callSystem` tornava
                        // SEMPRE buit (outText == "") i es queia al .bat, que obre una finestra
                        // de CMD a cada intent. A mes, el handshake TLS amb digition triga ~26 s
                        // i el --max-time 20 feia que curl s'hi quedés curt (ERR:CURL_EMPTY amb
                        // el JSON diana DESCARGAT al Temp uns segons despres). Ara: sortida
                        // REDIRIGIDA a fitxer (no stdout), timeouts mes llargs (15/60) i es
                        // llegeix el fitxer. Mateixa funcio, mateix contracte.
                        var sysCmd = curlExeAbs + ' -s --connect-timeout 15 --max-time 60 -X POST "' + url +
                            '" -H "accept: application/json" -H "' + authHeader + '" > "' + outFile + '" 2> "' + errFile + '"';
                        var t0Sys = new Date().getTime();
                        try { sysObj.callSystem(sysCmd); } catch (eSysRun) { }
                        var msSys = new Date().getTime() - t0Sys;
                        var outObjSys = new File(outFile);
                        if (outObjSys.exists && outObjSys.length > 2) {
                            var outTxtSys = "";
                            try { outObjSys.open('r'); outTxtSys = outObjSys.read(); outObjSys.close(); } catch (eRdSys) { outTxtSys = ""; }
                            if (outTxtSys && String(outTxtSys).length > 2) {
                                $.writeln("[FASTPASS.IO.curl] OK via callSystem+fitxer (" + msSys + " ms, " + String(outTxtSys).length + " chars)");
                                return String(outTxtSys);
                            }
                        }
                        $.writeln("[FASTPASS.IO.curl] callSystem sense sortida (" + msSys + " ms) -> es prova el .bat");
                    } else {
                        $.writeln("[FASTPASS.IO.curl] system.callSystem NO disponible -> es prova el .bat");
                    }
                } catch (eSys) {
                    $.writeln("[FASTPASS.IO.curl] callSystem ha fallat (" + eSys.message + ") -> es prova el .bat");
                }

                // ⚠️ BUGFIX (2026-09-16): el .bat s'executa amb cmd.exe, que EXPANDEIX els
                // '%' (p. ex. '%3A' es llegeix com l'argument 3 → buit): la URL
                // 'hora=14%3A00%3A00' arribava a l'API com a '14A00A00' → resposta
                // "Format d'hora incorrecte" → el botó FOTO fallava SEMPRE.
                // Al batch, un '%' literal s'ha d'escriure '%%'.
                var batUrl = String(url).replace(/%/g, '%%');
                var batAuth = String(authHeader).replace(/%/g, '%%');
                // --connect-timeout/--max-time: si l'API de digition no respon (xarxa
                // interna, VPN, certificat) curl ha de tallar SOL. Sense límit, el motor
                // JSX queda bloquejat i el botó FOTO es queda en "⏳ FOTO..." per sempre.
                // Valors continguts: el motor ExtendScript és MONO-FIL i una crida massa
                // llarga bloqueja la resta del panell (p. ex. la llista de conductors).
                // (> Vegeu les línies del .bat més avall, on s'executa curl.)

                // Crear .bat temporal
                var tempFile = new File(tempDir + "\\fp_curl_" + stamp + ".bat");
                tempFile.open('w');
                tempFile.writeln("@echo off");
                // Diagnòstic: si el .bat s'executa, això queda a l'errFile.
                tempFile.writeln('echo START %DATE% %TIME%> "' + errFile + '"');
                // Ruta ABSOLUTA de curl: el PATH del procés de Premiere pot no resoldre'l
                // (símptoma real 2026-09-16: ERR:CURL_EMPTY amb err buit = cmd no trobava
                // l'executable). Si no hi és, es prova el curl del PATH com a fallback.
                tempFile.writeln('set "CURLEXE=C:\\Windows\\System32\\curl.exe"');
                tempFile.writeln('if not exist "%CURLEXE%" set "CURLEXE=curl"');
                tempFile.writeln('"%CURLEXE%" -sv --connect-timeout 15 --max-time 60 -X POST "' + batUrl + '" -H "accept: application/json" -H "' + batAuth + '" > "' + outFile + '" 2>> "' + errFile + '"');
                tempFile.writeln('echo EXIT=%ERRORLEVEL%>> "' + errFile + '"');
                tempFile.writeln("exit");
                tempFile.close();

                var success = tempFile.execute();
                if (!success) return "ERR:CURL_EXECUTE_FAILED";

                // Esperar que el fitxer de sortida tingui contingut (max 24 segons,
                // alineat amb el --max-time 20 de curl + marge d'arrencada del .bat).
                // Límit baix a propòsit: el motor ExtendScript és mono-fil i un bloqueig
                // llarg afecta tota la resta del panell.
                // Esperar que el fitxer de sortida tingui contingut (max 70 segons,
                // alineat amb el --max-time 60 de curl). El handshake TLS amb digition
                // pot trigar ~26 s en aquesta xarxa (2026-09-17).
                var maxWait = 70000;
                var waited = 0;
                var outFileObj = new File(outFile);
                var outLen = (outFileObj.exists) ? outFileObj.length : 0;
                while (waited < maxWait && outLen <= 2) {
                    // ⚠️ BUGFIX (2026-09-17): amb un unic objecte File el bucle no veia el
                    // fitxer: el JSON de 206 KB hi era 3 s despres d'arrencar el .bat i
                    // s'esperaven els 70 s igualment (ERR:CURL_EMPTY amb la diana al disc).
                    // Ara: objecte File NOU a cada volta i, si el .bat ja ha escrit el seu
                    // EXIT= a l'.err, s'atura la espera (el proces ja ha acabat).
                    var probeOut = new File(outFile);
                    outLen = (probeOut.exists) ? probeOut.length : 0;
                    if (outLen > 2) break;
                    var probeErr = new File(errFile);
                    if (probeErr.exists && probeErr.length > 0) {
                        var errTxtProbe = "";
                        try { probeErr.open('r'); errTxtProbe = probeErr.read(); probeErr.close(); } catch (eProbe) { errTxtProbe = ""; }
                        if (errTxtProbe && String(errTxtProbe).indexOf('EXIT=') !== -1) break;
                    }
                    $.sleep(500);
                    waited += 500;
                    outFileObj = new File(outFile);
                    outLen = (outFileObj.exists) ? outFileObj.length : 0;
                }

                if (outLen <= 2) {
                    // Sense resposta: retornem el stderr de curl per poder diagnosticar.
                    // NOTA (2026-09-16): NO s'esborren .bat/.err — queden a la carpeta
                    // temporal (fp_curl_<stamp>.*) per poder investigar què ha passat.
                    var errTxt = "";
                    try {
                        var errFileObj = new File(errFile);
                        if (errFileObj.exists) { errFileObj.open('r'); errTxt = errFileObj.read(); errFileObj.close(); }
                    } catch (eErr) { }
                    return "ERR:CURL_EMPTY" + (errTxt ? (": " + String(errTxt).replace(/[\r\n]+/g, " ").substring(0, 200)) : "") +
                        " (fitxers: " + tempDir + "\\fp_curl_" + stamp + ".*)";
                }

                // Llegir el resultat
                var result = "";
                outFileObj = new File(outFile);   // nou objecte: el del bucle pot estar obsolet
                outFileObj.open('r');
                result = outFileObj.read();
                outFileObj.close();

                // Netejar fitxers temporals
                try { tempFile.remove(); } catch (e4) {}
                try { outFileObj.remove(); } catch (e5) {}
                try { new File(errFile).remove(); } catch (e6) {}

                return result;
            } catch (e) {
                return "ERR:" + e.message;
            }
        }
    };
})();
