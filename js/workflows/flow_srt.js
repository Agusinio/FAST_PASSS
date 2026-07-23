/**
 * ============================================================================
 * WORKFLOW: SRT (SUBTÍTOLS) - v3.1.0
 * Mecanisme de subtítols via .srt → _MOD.srt → reimportació
 *   - PREPARAR: Crea caption track amb el .srt original
 *   - IN: Elimina entrades anteriors al CTI, mou primera al frame 10
 *   - OUT: Elimina entrades posteriors al CTI
 *   - AJUSTAR: Escala proporcionalment totes les entrades
 *   - EXPORT: Diagnòstic / exploració
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);
    const P = () => window.FASTPASS_UI.Logic.SrtParser;

    /**
     * Helper: Escriu _MOD.srt, l'importa al projecte i el reinsereix
     * amb createCaptionTrack.
     */
    async function writeImportAndReinsert(entries, originalSrtPath, projectFolder) {
        // 1. Convertir entries a string SRT
        var srtContent = P().entriesToSrt(entries);
        if (!srtContent) {
            getUtils().status("Error: no entries to write", "error");
            return false;
        }

        // 2. Crear path per _MOD.srt (nom simplificat per evitar errors de path llargs)
        var modName = "fastpass_srt_MOD.srt";
        var modPath = "C:\\temp\\" + modName;

        // 3. Escriure _MOD.srt a C:\temp (local) via JSX amb variable global
        // (IO.writeTxt directe falla per escapes complexos; cep.fs.writeFile escriu incorrecte)
        var writeOk = false;
        try {
            window.__srt_write_content = srtContent;
            var writeResult = await callJSX("(function(){try{var f=new File('" + modPath.replace(/\\/g, '\\\\') + "');f.open('w');f.encoding='UTF-8';f.write(window.__srt_write_content);f.close();return'OK'}catch(e){return'ERR:'+e.message}})()");
            log("📝 SRT: write via global result: " + writeResult);
            if (writeResult === "OK") writeOk = true;
        } catch(e) {
            log("⚠️ SRT: global write error: " + e.message);
        }

        // Fallback: IO.writeTxt directe
        if (!writeOk) {
            try {
                var escaped4jsx = srtContent
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, "\\'")
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '');
                var writeResult2 = await callJSX("IO.writeTxt('" + modPath.replace(/\\/g, '\\\\') + "','" + escaped4jsx + "')");
                log("📝 SRT: writeTxt result: " + writeResult2);
                if (writeResult2 === "OK") writeOk = true;
            } catch(e) {
                log("⚠️ SRT: writeTxt fallback error: " + e.message);
            }
        }

        if (!writeOk) {
            getUtils().status("Error escrivint _MOD.srt", "error");
            return false;
        }

        // 3.5 Verificar el fitxer escrit
        var verifyContent = await callJSX("IO.readTxt('" + modPath.replace(/\\/g, '\\\\') + "')");
        log("📝 SRT: Verificant fitxer escrit - primers 200 chars:\n" + (verifyContent ? verifyContent.substring(0, 200) : "null"));
        log("📝 SRT: Longitud del fitxer: " + (verifyContent ? verifyContent.length : 0) + " chars");

        // 4. Copiar el fitxer al directori del projecte (NAS) i importar des d'allà
        var projectFolder = await callJSX("Context.folder()");
        var nasModPath = (projectFolder || "C:\\temp") + "\\" + modName;
        var nasModPathEscaped = nasModPath.replace(/\\/g, '\\\\');
        
        // Importar usant JSX inline per evitar problemes de parseig JSON
        var normalizedPath = modPath.replace(/\\/g, '/');
        var importResult2 = await callJSX("(function(){try{app.project.importFiles(['" + normalizedPath + "'],true,app.project.rootItem,false);return'OK'}catch(e){return'ERR:'+e.message}})()");
        log("📝 SRT: import result: " + importResult2);
        
        if (!importResult2 || importResult2.indexOf('OK') === -1) {
            // Fallback: usar IO.importFiles amb path normalitzat
            var importResult3 = await callJSX("IO.importFiles('[\"" + normalizedPath + "\"]','')");
            log("📝 SRT: import retry: " + importResult3);
            importResult2 = importResult3.indexOf('OK') >= 0 ? 'OK' : importResult3;
        }
        
        if (!importResult2 || importResult2.indexOf('OK') === -1) {
            getUtils().status("Error important _MOD.srt", "error");
            return false;
        }

        // 5. Buscar i reinserir
        var escapedModName = encodeURIComponent(modName);
        var findResult = await callJSX("FASTPASS.Project.find(decodeURIComponent('" + escapedModName + "'))");
        log("📝 SRT: find _MOD.srt result: " + (findResult ? findResult.substring(0, 100) : "null"));

        if (!findResult || findResult === 'null' || findResult.indexOf('null') >= 0) {
            getUtils().status("No es troba _MOD.srt al projecte", "error");
            return false;
        }

        // 6. Crear caption track
        var captionResult = await callJSX("(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('" + encodeURIComponent(modName) + "'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()");
        log("📝 SRT: createCaptionTrack result: " + captionResult);

        if (captionResult === "OK") {
            // 7. Esborrar pistes de subtítols anteriors via Sequence API (clearCaptionTrack)
            try {
                var removeResult = await callJSX("(function(){try{var s=app.project.activeSequence;if(!s)return'NO_SEQ';if(typeof s.clearCaptionTrack==='function'){var idx=0;while(s.subtitleTracks&&s.subtitleTracks.numTracks>1){s.clearCaptionTrack(0);idx++}return'OK_CLEARED_'+idx}return'NO_CLEAR_API'}catch(e){return'ERR:'+e.message}})()");
                log("📝 SRT: Neteja: " + removeResult);
            } catch(e) {
                log("⚠️ SRT: Error neteja: " + e.message);
                // Fallback: netejar la pista anterior eliminant el projectItem
                try {
                    await callJSX("(function(){try{var s=app.project.activeSequence;if(!s)return;var n=s.subtitleTracks? s.subtitleTracks.numTracks:0;for(var i=0;i<n-1;i++){try{s.subtitleTracks[i].clips.removeAll()}catch(e){}}}catch(e){}})()");
                } catch(e2) {}
            }
            // Guardar a state
            var state = FASTPASS_UI.State;
            state.srt = state.srt || {};
            state.srt.modName = modName;
            state.srt.modPath = modPath;
            return true;
        } else {
            getUtils().status("Error createCaptionTrack: " + captionResult, "error");
            return false;
        }
    }

    /**
     * Helper: Flux comú per IN/OUT (llegir, processar, escriure, importar, reinserir)
     */
    async function processSrt(operation, ctiSec) {
        const state = FASTPASS_UI.State;
        if (!state.srt || !state.srt.mediaPath) {
            getUtils().status("Primer has de fer PREPARAR", "warn");
            log("⚠️ SRT: State.srt.mediaPath no trobat.");
            return;
        }

        const originalSrtPath = state.srt.mediaPath;
        const projectFolder = await callJSX("Context.folder()");
        const tempFolderStr = (projectFolder && projectFolder !== "" && projectFolder.indexOf('ERR') !== 0) ? projectFolder : "C:\\temp";

        log("📝 SRT: " + operation + " - CTI=" + ctiSec.toFixed(3) + "s, srt=" + originalSrtPath);

        // 1. Llegir .srt original
        var entries = await P().extractEntriesFromSrtFile(originalSrtPath);
        if (!entries || entries.length === 0) {
            getUtils().status("Error llegint o parsejant .srt", "error");
            log("⚠️ SRT: No entries from " + originalSrtPath);
            return;
        }
        log("📝 SRT: " + entries.length + " entrades parsejades.");

        var resultEntries = null;

        if (operation === "IN") {
            // 2. Trobar target
            var targetIdx = P().findTargetByTime(entries, ctiSec);
            if (targetIdx < 0) {
                // Si no trobem per time, intentem per proporció
                targetIdx = Math.floor((ctiSec / entries[entries.length - 1].endSec) * entries.length);
                if (targetIdx >= entries.length) targetIdx = entries.length - 1;
                log("📝 SRT: IN target per proporció: " + targetIdx);
            } else {
                log("📝 SRT: IN target per time: " + targetIdx);
            }

            // 3. Aplicar trim
            resultEntries = P().applyTrimIn(entries, targetIdx, 0.4);
            log("📝 SRT: IN result: " + resultEntries.length + " entrades.");

        } else if (operation === "OUT") {
            var targetIdx = P().findTargetByTime(entries, ctiSec);
            if (targetIdx < 0) {
                targetIdx = Math.floor((ctiSec / entries[entries.length - 1].endSec) * entries.length);
                if (targetIdx >= entries.length) targetIdx = entries.length - 1;
                log("📝 SRT: OUT target per proporció: " + targetIdx);
            } else {
                log("📝 SRT: OUT target per time: " + targetIdx);
            }

            resultEntries = P().applyTrimOut(entries, targetIdx);
            log("📝 SRT: OUT result: " + resultEntries.length + " entrades.");

        } else if (operation === "AJUSTAR") {
            resultEntries = P().applyTimeAdjust(entries, ctiSec, 0.04);
            log("📝 SRT: AJUSTAR result: " + resultEntries.length + " entrades, ratio=" + (ctiSec - entries[0].startSec) / (entries[entries.length - 1].endSec - entries[0].startSec));
        }

        if (!resultEntries || resultEntries.length === 0) {
            getUtils().status("Error: cap entrada resultant", "error");
            return;
        }

        // 4. Escriure, importar, reinserir
        var success = await writeImportAndReinsert(resultEntries, originalSrtPath, tempFolderStr);
        if (success) {
            getUtils().status(operation + " completat amb èxit (" + resultEntries.length + " entrades)", "exito");
            log("✅ SRT: " + operation + " OK");
        } else {
            getUtils().status(operation + " ha fallat", "error");
            log("❌ SRT: " + operation + " FAILED");
        }
    }

    FASTPASS_UI.Workflows.Srt = {

        /**
         * runPreparar: Busca el fitxer .srt entre els items del projecte
         * i l'insereix a una caption track.
         */
        runPreparar: async function () {
            console.log("🔴🔴 SRT: runPreparar EXECUTAT 🔴🔴🔴");
            try {
                // 1. Buscar el fitxer .srt entre els items del projecte (root)
                const itemsRaw = await callJSX("FASTPASS.Project.items('')");
                log("📝 SRT: Items rebuts: " + (itemsRaw ? itemsRaw.substring(0, 200) : "null"));

                let items = [];
                try { items = JSON.parse(itemsRaw || "[]"); } catch(e) {
                    log("⚠️ SRT: Error parsejant items: " + e.message);
                    getUtils().status("Error llegint items del projecte", "error");
                    return;
                }

                const srtItem = items.find(i => {
                    if (!i || !i.name) return false;
                    return i.name.toUpperCase().endsWith('.SRT');
                });

                if (!srtItem) {
                    getUtils().status("No s'ha trobat fitxer .srt al projecte", "error");
                    log("⚠️ SRT: Cap fitxer .SRT trobat.");
                    return;
                }

                log("📝 SRT: SRT trobat al projecte: " + srtItem.name);

                // 2. Assignar al State (path + name)
                const state = FASTPASS_UI.State;
                state.srt = state.srt || {};
                state.srt.name = srtItem.name;
                state.srt.path = srtItem.mediaPath || "";

                // Obtenir el path real del SRT
                const srtPathRaw = await callJSX(`(function(){try{var p=app.project.rootItem;for(var i=0;i<p.children.numItems;i++){var c=p.children[i];if(c.name&&c.name.toUpperCase().indexOf('.SRT')>=0&&(c.type===1||c.type===2)){return c.name+'|'+c.getMediaPath()}}return''}catch(e){return'ERR:'+e.message}})()`);
                log("📝 SRT: SRT path from JSX: " + srtPathRaw);
                if (srtPathRaw && srtPathRaw.indexOf('|') > 0) {
                    var parts = srtPathRaw.split('|');
                    state.srt.mediaPath = parts[1];
                    log("📝 SRT: mediaPath desat: " + state.srt.mediaPath);
                }

                // 3. Crear caption track amb el SRT via API nativa Adobe
                const escapedSrtName = encodeURIComponent(srtItem.name);
                log("📝 SRT: Creant caption track via createCaptionTrack natiu...");
                const result = await callJSX(`(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('${escapedSrtName}'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()`);
                log("📝 SRT: Resultat: " + result);

                if (result === "OK") {
                    getUtils().status("SRT col·locat a caption track", "exito");
                    // Habilitar botons IN/AJUSTAR
                    const btnIn = document.getElementById('btnSrtIn');
                    const btnTimeAdjust = document.getElementById('btnTimeAdjust');
                    if (btnIn) btnIn.disabled = false;
                    if (btnTimeAdjust) btnTimeAdjust.disabled = false;
                    log("✅ SRT: Operació completada amb èxit.");
                } else {
                    getUtils().status("Error al col·locar SRT: " + result, "error");
                    log("❌ SRT: Error: " + result);
                }

            } catch (e) {
                log("💥 SRT: Excepció a runPreparar: " + e.message + " | stack: " + (e.stack || "N/A"));
                getUtils().handleError(e, "SrtPreparar");
            }
        },

        /**
         * runSrtIn: Elimina entrades ANTERIORS al CTI. Mou primera al frame 10.
         */
        runSrtIn: async function () {
            log("📝 SRT: runSrtIn - INICI");
            try {
                var cti = parseFloat(await callJSX("Timeline.get()") || "0");
                await processSrt("IN", cti);
            } catch (e) {
                log("💥 SRT: Excepció a runSrtIn: " + e.message + " | stack: " + (e.stack || "N/A"));
                getUtils().handleError(e, "SrtIn");
            }
        },

        /**
         * runSrtOut: Elimina entrades POSTERIORS al CTI.
         */
        runSrtOut: async function () {
            log("📝 SRT: runSrtOut - INICI");
            try {
                var cti = parseFloat(await callJSX("Timeline.get()") || "0");
                await processSrt("OUT", cti);
            } catch (e) {
                log("💥 SRT: Excepció a runSrtOut: " + e.message + " | stack: " + (e.stack || "N/A"));
                getUtils().handleError(e, "SrtOut");
            }
        },

        /**
         * runTimeAdjust: Escala proporcionalment TOTES les entrades per quadrar amb el CTI.
         */
        runTimeAdjust: async function () {
            log("⏳ SRT: runTimeAdjust - INICI");
            try {
                var cti = parseFloat(await callJSX("Timeline.get()") || "0");
                await processSrt("AJUSTAR", cti);
            } catch (e) {
                log("💥 SRT: Excepció a runTimeAdjust: " + e.message + " | stack: " + (e.stack || "N/A"));
                getUtils().handleError(e, "SrtTimeAdjust");
            }
        },

        /**
         * exploreSubtitleTracks: Diagnòstic per explorar subtitleTracks.
         * Mantinguda per compatibilitat amb el botó EXPORT.
         */
        exploreSubtitleTracks: async function () {
            log("📝 SRT_EXPLORE: Iniciant exploració...");
            try {
                const apiResult = await callJSX(`(function(){
                    try {
                        var seq = app.project.activeSequence;
                        if (!seq) return "ERR_NO_SEQ";
                        var lines = [];
                        lines.push("--- SUBTITLE TRACKS ---");
                        lines.push("typeof seq.subtitleTracks=" + (typeof seq.subtitleTracks));
                        lines.push("seq.subtitleTracks=" + (seq.subtitleTracks ? "EXISTS" : "UNDEFINED/NULL"));
                        if (seq.subtitleTracks) {
                            try { lines.push("NUM_SUBTRACKS=" + seq.subtitleTracks.numTracks); } catch(e) { lines.push("NUM_SUBTRACKS_ERR=" + e.message); }
                        }
                        var seqProps = [];
                        for (var q in seq) {
                            var ql = q.toLowerCase();
                            if (ql.indexOf('sub') >= 0 || ql.indexOf('cap') >= 0) {
                                try { seqProps.push(q + ":" + typeof seq[q]); } catch(e) {}
                            }
                        }
                        lines.push("SEQ_SUB_CAP=" + seqProps.join(" | "));
                        return lines.join("\\n");
                    } catch(e) { return "ERR: " + e.message + " | line: " + e.line; }
                })()`);
                log("📝 SRT_EXPLORE: " + apiResult);
                getUtils().status("API: subtitleTracks no accessible", "warn");
            } catch (e) {
                log("💥 SRT_EXPLORE: Excepció: " + e.message);
                getUtils().handleError(e, "SrtExplore");
            }
        }
    };

    window.FASTPASS_UI.Workflows.Srt = FASTPASS_UI.Workflows.Srt;
})();