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
    // FALLBACK de subtítols: cerca relajada a la carpeta de verticalització.
    const getScanner = () => window.FASTPASS_UI.Logic.Scan;

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
        // (2026-10-02) readTxt → ANSI: reparar perquè el log de verificació mostri el text real.
        var verifyContent = getUtils()._fromMojibake(await callJSX("IO.readTxt('" + modPath.replace(/\\/g, '\\\\') + "')"), 'flow_srt');
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

        // 5. Esborrar items .srt anteriors del projecte
        await callJSX("(function(){try{var root=app.project.rootItem;for(var i=root.children.numItems-1;i>=0;i--){var c=root.children[i];if(c&&c.name&&c.name.toUpperCase().indexOf('.SRT')>=0){try{c.delete()}catch(e){}}}}catch(e){}})()");

        // 6. Reimportar _MOD.srt
        var importAgainResult = await callJSX("(function(){try{app.project.importFiles(['" + normalizedPath.replace(/\\/g, '/') + "'],true,app.project.rootItem,false);return'OK'}catch(e){return'ERR:'+e.message}})()");

        // 7. Buscar i reinserir
        var escapedModName = encodeURIComponent(modName);
        var findResult = await callJSX("FASTPASS.Project.find(decodeURIComponent('" + escapedModName + "'))");
        if (!findResult || findResult === 'null' || findResult.indexOf('null') >= 0) {
            getUtils().status("No es troba _MOD.srt al projecte", "error");
            return false;
        }

        // 8. Netejar caption tracks antics via PrProjCleaner (JS pur → PowerShell)
        try {
            var cleaner = window.FASTPASS_UI.Logic.PrProjCleaner;
            if (cleaner) {
                var cleanResult = await cleaner.removeOldCaptionTracks();
                log("📝 SRT: Neteja tracks: " + cleanResult.message + " (removed=" + cleanResult.removedTracks + ")");
            }
        } catch(e) {
            log("⚠️ SRT: Error netejant tracks: " + e.message);
        }

        // 9. Crear caption track
        var captionResult = await callJSX("(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('" + encodeURIComponent(modName) + "'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()");
        log("📝 SRT: createCaptionTrack result: " + captionResult);

        if (captionResult === "OK") {
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
            console.log("🔴🔴 SRT: runPreparar EXECUTAT (DESACTIVAT - usau l'editor SRT) 🔴🔴🔴");
            // DESACTIVAT: la càrrega de .srt al timeline es fa via l'editor SRT (botó CARREGAR + EXPORTAR)
            getUtils().status("Usa CARREGAR i EXPORTAR al panell SRT", "warn");
            return;
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
         * _srtCtx: Construeix el context {config, progData, bloque, dateDir} des dels
         * selectors del panell i de l'estat (mateixes fonts que MainButton/SrtEditor).
         * @returns {Object|null}
         */
        _srtCtx: function () {
            const config = FASTPASS_UI.Config.get();
            const idProg = (document.getElementById('programa') || {}).value;
            const progData = config.mapeoProgramas && config.mapeoProgramas[idProg];
            if (!progData) return null;
            const bloque = (document.getElementById('bloc') || {}).value;
            const dateDir = (FASTPASS_UI.State && FASTPASS_UI.State.dateDir) ||
                getUtils().getFormattedDate().replace(/["\s]/g, "").trim();
            return { config: config, progData: progData, programa: idProg, bloque: bloque, dateDir: dateDir };
        },

        /**
         * runSrtFallback: Càrrega de subtítols de RECANVI quan el mecanisme principal
         * (blocs de 15 min) no troba res.
         * Busca el .SRT a la carpeta de verticalització (la MATEIXA on viuen els MP4 del
         * bloc) amb relaxació progressiva de filtres (Scan.srtFallback) i el carrega a
         * l'editor de subtítols amb SrtEditor.loadSrt (que llegeix el fitxer, munta la
         * taula d'entrades, la waveform i els marcadors). NO importa res al projecte.
         * @returns {boolean} true si s'ha carregat algun SRT
         */
        runSrtFallback: async function () {
            log("🆘 SRT_FALLBACK: cercant .SRT a la carpeta de verticalització...");
            try {
                const ctx = this._srtCtx();
                if (!ctx) { getUtils().status("Selecciona un programa", "warn"); return false; }
                if (!window.SrtEditor || !window.SrtEditor.loadSrt) {
                    getUtils().status("Error: SrtEditor no disponible", "error");
                    return false;
                }
                const cand = await getScanner().srtFallback(ctx);
                if (!cand) {
                    // (2026-09-22) El fallback NO surt mai del dia de treball: si no hi ha cap
                    // .SRT d'aquesta data, no es carrega res (abans podia carregar el d'AHIR).
                    const fecha = String(ctx.dateDir || '').replace(/_/g, '-');
                    getUtils().status("SRT: no hi ha cap .SRT del dia " + (fecha || '?') + " — no es carrega res", "warn");
                    log("⚠️ SRT_FALLBACK: cap .SRT de la data " + (ctx.dateDir || "?") + " a " + (ctx.config.rutas.verticalitzacio || "?"));
                    return false;
                }
                log("🆘 SRT_FALLBACK: N" + cand.level + " (" + cand.reason + ", " + cand.candidates +
                    " candidat(s)) → " + cand.path);
                const ok = await window.SrtEditor.loadSrt(cand.path);
                if (ok) {
                    getUtils().status("SRT carregat (fallback N" + cand.level + "): " + cand.name, "exito");
                    log("✅ SRT_FALLBACK: carregat a l'editor: " + cand.name);
                    return true;
                }
                getUtils().status("Fallback: no s'ha pogut carregar " + cand.name, "error");
                return false;
            } catch (e) {
                log("💥 SRT_FALLBACK: " + e.message);
                getUtils().handleError(e, "SrtFallback");
                return false;
            }
        },

        /**
         * runSrtReset (2026-09-22): Botó ♻️ (RESET / neteja subtítols).
         *   1. Restaura l'estat inicial del SRT que ja hi havia carregat: taula sense
         *      edicions, sense marcadors (esborrats de memòria **i del disc**, #138) i
         *      esborra els clips de subtítols de la seqüència
         *      (comportament de sempre: `SrtEditor.resetToOriginal`).
         *   2. **TORNA A BUSCAR els .SRT DEL TEMA** del bloc i el carrega: mateix mecanisme
         *      que el SCAN principal (`Scan.mediaAssets` amb el tema detectat → carpeta de
         *      verticalització, prefix `{archivo}_{bloque}_` + data de treball) i, si no en
         *      troba, el fallback del MATEIX DIA (`Scan.srtFallback`). Així el reset també
         *      "refresca" quin subtítol toca, no només la taula.
         * Mai surt del dia de treball (2026-09-22: prohibit carregar SRT d'un altre dia).
         */
        runSrtReset: async function () {
            const ed = window.SrtEditor;
            if (!ed || !ed.resetToOriginal) { getUtils().status("Error: SrtEditor no disponible", "error"); return; }
            log("♻️ SRT_RESET: reiniciant subtítols i tornant a buscar els .SRT del tema...");

            // 1) Estat inicial (taula, marcadors i clips de subtítols de la seqüència)
            try { await ed.resetToOriginal(); } catch (eR) { log("⚠️ SRT_RESET: " + eR.message, "WARN"); }

            // 2) Tornar a buscar el .SRT del tema del bloc
            try {
                const ctx = this._srtCtx();
                if (!ctx) { getUtils().status("Selecciona un programa", "warn"); return; }
                const tema = (FASTPASS_UI.State && FASTPASS_UI.State.detectedTheme) || '';
                log("🔎 SRT_RESET: buscant .SRT del tema" + (tema ? ' ("' + tema + '")' : '') +
                    " · bloc " + (ctx.bloque || '?') + " · data " + (ctx.dateDir || '?'));

                const media = await getScanner().mediaAssets(ctx, tema);
                let cand = (media && media.srt) ? media.srt : null;
                let via = 'mediaAssets';
                if (!cand) {
                    cand = await getScanner().srtFallback(ctx);
                    via = 'fallback (dia de treball)';
                }
                if (!cand) {
                    const fecha = String(ctx.dateDir || '').replace(/_/g, '-');
                    getUtils().status("SRT reset · cap .SRT del tema amb data " + (fecha || '?') + " — no es carrega res", "warn");
                    log("⚠️ SRT_RESET: cap .SRT del tema/bloc per a la data " + (ctx.dateDir || '?'));
                    return;
                }
                if (!ed.loadSrt) { getUtils().status("Error: SrtEditor.loadSrt no disponible", "error"); return; }

                log("♻️ SRT_RESET: " + via + " → " + cand.path);
                // (2026-10-02 · BUG #138) Els marcadors s'han d'esborrar TAMBÉ al disc del
                // .srt que es torna a carregar. `loadSrt` els restaura del fitxer persistit
                // al projecte i, com que el RESET sol carregar un .srt DIFERENT del que hi
                // havia obert (p. ex. l'emergència de 15 min → el .srt del tema), les
                // marques velles tornaven a aparèixer i semblava que el RESET no les
                // esborrés. El fitxer queda buit i la restauració se salta en aquesta càrrega.
                if (ed._wipeMarkersFile) ed._wipeMarkersFile(cand.path);
                const ok = await ed.loadSrt(cand.path, { skipMarkerRestore: true });
                if (ok) {
                    getUtils().status("SRT resetejat i recarregat: " + cand.name, "exito");
                    log("✅ SRT_RESET: carregat a l'editor: " + cand.name);
                } else {
                    getUtils().status("SRT reset · no s'ha pogut carregar " + cand.name, "error");
                }
            } catch (e) {
                log("💥 SRT_RESET: " + e.message);
                getUtils().handleError(e, "SrtReset");
            }
        },

        /**
         * runSrtLoad: Punt d'entrada del botó ⬇️ (CARREGAR).
         *   1. Mecanisme PRINCIPAL: blocs de 15 min (SrtEditor.loadEmergencySrt).
         *   2. Si no ha carregat res → FALLBACK (carpeta de verticalització).
         * @param {boolean} [forceFallback] - true (Ctrl+clic) → va directe al fallback.
         */
        runSrtLoad: async function (forceFallback) {
            const ed = window.SrtEditor;
            if (!ed || !ed.loadSrt) { getUtils().status("Error: SrtEditor no disponible", "error"); return; }
            if (!forceFallback) {
                // El carregador d'emergència no retorna si ha reeixit → es compara el
                // fitxer carregat ABANS i DESPRÉS (_srtPath el fixa loadSrt).
                const before = String(ed._srtPath || '');
                log("📥 SRT_LOAD: mecanisme principal (blocs de 15 min)...");
                try { await ed.loadEmergencySrt(); } catch (eE) { log("⚠️ SRT_LOAD: emergència: " + eE.message); }
                const after = String(ed._srtPath || '');
                if (after && after !== before) {
                    log("✅ SRT_LOAD: carregat amb els blocs de 15 min: " + after);
                    return;
                }
                log("⚠️ SRT_LOAD: els blocs de 15 min no han carregat res → FALLBACK.");
            } else {
                log("📥 SRT_LOAD: Ctrl+clic → FALLBACK directe.");
            }
            await this.runSrtFallback();
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