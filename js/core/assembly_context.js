/**
 * ============================================================================
 * CORE: ASSEMBLY CONTEXT (Context Compartit per MP4, Markers, Chyrons, Graphics)
 * ============================================================================
 * Extret de flow_assembly.js durant la modularització v2.9.5 "LIPO-PRO".
 * Proporciona _loadAssemblyContext() i helpers a tots els workflows que
 * necessiten accés al manifest, clips V1, línies d'escaleta i referències.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Core = FASTPASS_UI.Core || {};

    FASTPASS_UI.Core.AssemblyContext = {

        // ── Estat intern: caché de diagnòstic de clips ──
        _clipsLogged: false,

        /**
         * loadAssemblyContext()
         * Carrega el manifest, reader, bloc actiu, línies d'escaleta,
         * clips V1 i referències. Primer pas obligatori per a qualsevol
         * flux que treballi amb el timeline.
         *
         * @returns {{ ctx, manifest, reader, targetBlock, lines,
         *            lineIndexByNum, clips, refFromManifest, refInPoint,
         *            firstUngroupedItem }}
         *          | null si falla la validació
         */
        loadAssemblyContext: async function () {
            var getUtils = function () { return window.FASTPASS_UI.Utils; };
            var getClipsLogic = function () { return window.FASTPASS_UI.Logic.Clips; };
            var log = function (m, lvl) { return getUtils().log(m, lvl || "DEBUG"); };

            if (!(await getUtils().validateActiveSequence())) return null;
            log("📍 [AssemblyContext] Carregant context...");

            // ── LOG DIAGNÒSTIC: Llista de clips en V1 (només el primer cop) ──
            if (!this._clipsLogged) {
                this._clipsLogged = true;
                try {
                    const v1Clips = await getClipsLogic().getTrackClips(1, "video");
                    log(`🎬 [DIAGNÒSTIC] Clips en V1: ${v1Clips.length} clips`);
                    v1Clips.forEach(function(c, i) {
                        log(`   V1[${i}] name="${c.name}" start=${c.start.toFixed(3)} end=${c.end.toFixed(3)} dur=${(c.end - c.start).toFixed(3)}`);
                    });
                } catch (clipErr) {
                    log(`⚠️ [DIAGNÒSTIC] No s'han pogut llegir els clips V1: ${clipErr.message}`);
                }
            }

            const ctx = FASTPASS_UI.State;
            if (!ctx.progData) {
                const config = FASTPASS_UI.Config.get();
                const progSelect = document.getElementById('programa');
                const blocSelect = document.getElementById('bloc');
                if (progSelect && progSelect.value && config.mapeoProgramas) {
                    ctx.progData = config.mapeoProgramas[progSelect.value];
                    ctx.bloque = blocSelect ? blocSelect.value : 'V1';
                    log("⚠️ [RECUPERAT] progData recuperat des del select.");
                } else {
                    log("⚠️ No es pot determinar el programa. Abortant.");
                    return null;
                }
            }

            if (!ctx.config) { ctx.config = FASTPASS_UI.Config.get(); }
            if (!ctx.dateDir) {
                log("⚠️ [AssemblyContext] dateDir no disponible a State. Usant data del sistema com a fallback.");
                ctx.dateDir = getUtils().getFormattedDate().replace(/["\s]/g, "").trim();
            }

            const manifestPath = FASTPASS_UI.SessionManifest.getPath(ctx);
            log(`🔍 [AssemblyContext] Cercant manifest a: ${manifestPath}`);
            const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
            if (!manifest || !manifest.escaletaItems || manifest.escaletaItems.length === 0) {
                log("⚠️ No es troben items d'escaleta al manifest. Executa primer «Muntar».", "ERROR");
                return null;
            }

            // ── Assegurar que el log file estigui configurat per a aquest projecte ──
            if (manifest.program && manifest.program.projectFile && manifest.program.projectFolder) {
                if (!getUtils()._debugLogPath) {
                    getUtils()._setLogPath(manifest.program.projectFolder, manifest.program.projectFile);
                }
            }

            const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
            const targetBlock = ctx.bloque.toLowerCase();

            let lines = manifest.escaletaItems.filter(l => {
                if (l.flotant === true) return false;
                const ag = l.agrupacio;
                return ag && ag.toString().toLowerCase() === targetBlock;
            });

            lines.sort((a, b) => {
                const horaA = a.horaEntradaOnAir || a.horaEntradaPrevista;
                const horaB = b.horaEntradaOnAir || b.horaEntradaPrevista;
                return reader.tcToSeconds(horaA) - reader.tcToSeconds(horaB);
            });

            const lineIndexByNum = {};
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].num) lineIndexByNum[lines[i].num] = i;
            }

            log(`📋 Estructura des del manifest: ${lines.length} items per al bloc ${ctx.bloque}`);
            if (lines.length === 0) {
                log("⚠️ El bloc no té línies d'escaleta definides.", "WARN");
                return null;
            }

            const refFromManifest = manifest.ref;
            if (!refFromManifest || refFromManifest.mp4ExpandedInPoint === undefined || refFromManifest.mp4ExpandedInPoint === null) {
                log("⚠️ No es troba ref al manifest. Executa primer «Muntar».", "ERROR");
                return null;
            }
            const refInPoint = refFromManifest.mp4ExpandedInPoint;
            log(`📐 Ref del manifest: inPoint=${refInPoint.toFixed(2)}s (tier=${refFromManifest.InTier})`);

            const clips = await getClipsLogic().getTrackClips(1, "video");

            // Detectar primer ítem no agrupat (agrupacio:null) dins del rang del bloc
            var firstUngroupedItem = this._detectFirstUngroupedItem(manifest, reader, lines, targetBlock);
            if (firstUngroupedItem) {
                log(`🔴 [Ungrouped] Detectat primer ítem no agrupat: ${firstUngroupedItem.num || '?'} - ${(firstUngroupedItem.titol || '').substring(0, 60)}`);
            }

            return { ctx, manifest, reader, targetBlock, lines, lineIndexByNum, clips, refFromManifest, refInPoint, firstUngroupedItem };
        },

        /**
         * _detectFirstUngroupedItem(manifest, reader, lines, targetBlock)
         * Escaneja manifest.escaletaItems per trobar el primer ítem amb
         * agrupacio:null que caigui cronològicament dins del rang del bloc.
         *
         * Cas d'ús: blocs amb items intercalats no agrupats (ex: 02DP, 02Dir, 02
         * entre 555 i 03 del V2). Aquests items no es capturen amb el filtre
         * agrupacio===targetBlock però pertanyen al rang temporal del bloc.
         *
         * @param {Object} manifest - Manifest de sessió
         * @param {Object} reader - EscaletaReader
         * @param {Array} lines - Línies del bloc (filtrades per agrupacio)
         * @param {string} targetBlock - ID del bloc (ex: "v2")
         * @returns {Object|null} - Primer ítem no agrupat o null
         */
        _detectFirstUngroupedItem: function (manifest, reader, lines, targetBlock) {
            if (!lines || lines.length === 0) return null;
            if (!manifest || !manifest.escaletaItems || manifest.escaletaItems.length === 0) return null;

            // Rang temporal del bloc
            var blockStartSec = (manifest.ref && manifest.ref.worldBlockStartSec != null)
                ? manifest.ref.worldBlockStartSec
                : null;
            var blockEndSec = (manifest.ref && manifest.ref.worldBlockEndSec != null)
                ? manifest.ref.worldBlockEndSec
                : null;
            if (blockStartSec === null || blockEndSec === null) {
                var blockStartStr = lines[0].horaEntradaOnAir || lines[0].horaEntradaPrevista;
                var blockEndStr = lines[lines.length - 1].horaEntradaOnAir || lines[lines.length - 1].horaEntradaPrevista;
                if (!blockStartStr || !blockEndStr) return null;
                blockStartSec = reader.tcToSeconds(blockStartStr);
                blockEndSec = reader.tcToSeconds(blockEndStr);
                if (blockStartSec === null || blockEndSec === null) return null;
            }

            // Escanejar tots els items del manifest, recollir tots els no agrupats
            var allItems = manifest.escaletaItems;
            var ungroupedCandidates = [];
            for (var i = 0; i < allItems.length; i++) {
                var item = allItems[i];
                if (item.flotant === true) continue;
                var ag = item.agrupacio;
                if (ag !== null && ag !== undefined) continue;

                var itemTimeStr = item.horaEntradaOnAir || item.horaEntradaPrevista;
                if (!itemTimeStr) continue;
                var itemTimeSec = reader.tcToSeconds(itemTimeStr);
                if (itemTimeSec === null) continue;

                if (itemTimeSec >= blockStartSec && itemTimeSec <= blockEndSec) {
                    ungroupedCandidates.push({ item: item, timeSec: itemTimeSec });
                }
            }

            if (ungroupedCandidates.length === 0) return null;

            // D12: Excloure l'últim item no agrupat del bloc (és el final, l'usuari ja l'ha trimeat)
            // Només retornar items intercalats (ex: un 02DP entre 01 i 02)
            if (ungroupedCandidates.length === 1) return null;  // Només hi ha el final

            // Ordenar per temps i retornar el primer que NO sigui l'últim
            ungroupedCandidates.sort(function(a, b) { return a.timeSec - b.timeSec; });
            var lastCandidate = ungroupedCandidates[ungroupedCandidates.length - 1];
            for (var u = 0; u < ungroupedCandidates.length; u++) {
                if (ungroupedCandidates[u].item !== lastCandidate.item) {
                    return ungroupedCandidates[u].item;  // Primer no-final
                }
            }
            return null;  // Tots són el final
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();