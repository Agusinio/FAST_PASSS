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

            // ── RESOLDRE LA CARPETA REAL DEL PROJECTE OBERT (2026-09-07) ──────
            // El manifest viu a la mateixa carpeta que el .prproj que tenim OBERT a
            // Premiere. State.dateDir pot apuntar a HOY mentre editem un projecte
            // d'AHIR (mode correcció amb Ctrl+clic). Per això es deriva la carpeta
            // des de Project.path() (font de veritat) i es re-alinea ctx.dateDir.
            try {
                const activePathRaw = await getUtils().callJSX("FASTPASS.Project.path()");
                if (activePathRaw && String(activePathRaw).toLowerCase().indexOf('.prproj') !== -1) {
                    const normPath = String(activePathRaw).replace(/\\/g, '/');
                    const partsPath = normPath.split('/');
                    let realDateDir = null;
                    for (let pi = 0; pi < partsPath.length; pi++) {
                        if (/^\d{4}_\d{2}_\d{2}$/.test(partsPath[pi])) { realDateDir = partsPath[pi]; break; }
                    }
                    const baseNorm = String(ctx.config.rutas.destinoBase).replace(/\\/g, '/').replace(/\/+$/, '');
                    const dirNorm = String(ctx.progData.directorio).replace(/\\/g, '/');
                    if (realDateDir && normPath.indexOf(baseNorm) === 0 && normPath.indexOf(baseNorm + '/' + dirNorm) === 0) {
                        if (ctx.dateDir !== realDateDir) {
                            log(`📍 [AssemblyContext] Projecte obert de ${realDateDir} (State.dateDir era ${ctx.dateDir}). Alineant context.`, 'INFO');
                            ctx.dateDir = realDateDir;
                        }
                    }
                }
            } catch (ePath) {
                log(`⚠️ [AssemblyContext] No s'ha pogut resoldre la carpeta del projecte obert: ${ePath.message}`);
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
            var ungroupedItems = this._detectUngroupedItems(manifest, reader, lines, targetBlock);
            var firstUngroupedItem = (ungroupedItems && ungroupedItems.length) ? ungroupedItems[0] : null;
            if (ungroupedItems && ungroupedItems.length) {
                log('[Ungrouped] ' + ungroupedItems.length + ' item(s) no agrupat(s) dins del bloc: ' +
                    ungroupedItems.map(function (x) { return x.num || '?'; }).join(', ') + ' (es marcaran en VERMELL)');
            }
            if (firstUngroupedItem) {
                log(`🔴 [Ungrouped] Detectat primer ítem no agrupat: ${firstUngroupedItem.num || '?'} - ${(firstUngroupedItem.titol || '').substring(0, 60)}`);
            }

            return { ctx, manifest, reader, targetBlock, lines, lineIndexByNum, clips, refFromManifest, refInPoint, firstUngroupedItem, ungroupedItems };
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
        /**
         * _detectUngroupedItems(manifest, reader, lines, targetBlock)
         * Com _detectFirstUngroupedItem, però retorna TOTS els ítems no agrupats
         * (agrupacio:null) dins del rang del bloc. Cas d'ús 2026-09-17: blocs en
         * calent amb ítems que NO són del projecte (sense V1) — cal veure'ls tots
         * per delimitar el bloc (es marquen en VERMELL, color 1).
         * @returns {Array<Object>} ítems no agrupats (pot ser buit)
         */
        _detectUngroupedItems: function (manifest, reader, lines, targetBlock) {
            var out = [];
            try {
                if (!lines || lines.length === 0) return out;
                if (!manifest || !manifest.escaletaItems || manifest.escaletaItems.length === 0) return out;

                var blockStartSec = (manifest.ref && manifest.ref.worldBlockStartSec != null)
                    ? manifest.ref.worldBlockStartSec : null;
                var blockEndSec = (manifest.ref && manifest.ref.worldBlockEndSec != null)
                    ? manifest.ref.worldBlockEndSec : null;
                if (blockStartSec === null || blockEndSec === null) {
                    var bS = lines[0].horaEntradaOnAir || lines[0].horaEntradaPrevista;
                    var bE = lines[lines.length - 1].horaEntradaOnAir || lines[lines.length - 1].horaEntradaPrevista;
                    if (!bS || !bE) return out;
                    blockStartSec = reader.tcToSeconds(bS);
                    blockEndSec = reader.tcToSeconds(bE);
                    if (blockStartSec === null || blockEndSec === null) return out;
                }

                var allItems = manifest.escaletaItems;
                var cands = [];
                for (var i = 0; i < allItems.length; i++) {
                    var item = allItems[i];
                    if (!item || item.flotant === true) continue;
                    var ag = item.agrupacio;
                    // (2026-09-17) NOMÉS els ítems SENSE agrupació (agrupacio:null) compten
                    // com a "no del projecte" i es marquen en VERMELL. Els ítems d'ALTRES
                    // blocs (agrupacio=v2, v3...) NO es marquen: ens centrem en el bloc
                    // actual (correcció de criteri demanada per l'usuari).
                    if (ag !== null && ag !== undefined) continue;
                    var tStr = item.horaEntradaOnAir || item.horaEntradaPrevista;
                    if (!tStr) continue;
                    var tSec = reader.tcToSeconds(tStr);
                    if (tSec === null) continue;
                    if (tSec >= blockStartSec && tSec <= blockEndSec) cands.push({ item: item, timeSec: tSec });
                }
                if (cands.length === 0) return out;
                cands.sort(function (a, b) { return a.timeSec - b.timeSec; });

                // Excloure l'últim si NO té OnAir (és el final trimeat per l'usuari)
                var last = cands[cands.length - 1].item;
                var lastOnAir = last && last.horaEntradaOnAir && last.horaEntradaOnAir !== '00:00:00' && String(last.horaEntradaOnAir).trim() !== '';
                for (var c = 0; c < cands.length; c++) {
                    var it = cands[c].item;
                    if (it === last && !lastOnAir) continue;
                    if (window.FASTPASS_UI && window.FASTPASS_UI.Workflows && window.FASTPASS_UI.Workflows.Markers &&
                        window.FASTPASS_UI.Workflows.Markers._isGraphicByNum && window.FASTPASS_UI.Workflows.Markers._isGraphicByNum(it.num)) continue;
                    out.push(it);
                }
            } catch (e) {
                try { window.FASTPASS_UI.Utils.log('⚠️ [Ungrouped] Error detectant ítems no agrupats: ' + e.message, 'DEBUG'); } catch (e2) { }
            }
            return out;
        },

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
            // Però si l'últim té OnAir real, NO és el final trimeat → és un faro, l'inclourem.
            if (ungroupedCandidates.length === 1) return null;  // Només hi ha el final

            // Ordenar per temps
            ungroupedCandidates.sort(function(a, b) { return a.timeSec - b.timeSec; });
            var lastCandidate = ungroupedCandidates[ungroupedCandidates.length - 1];

            // Si l'últim candidat té OnAir real, NO és el final trimeat → retornar-lo
            var lastItem = lastCandidate.item;
            var lastHasOnAir = lastItem && lastItem.horaEntradaOnAir
                && lastItem.horaEntradaOnAir !== '00:00:00'
                && lastItem.horaEntradaOnAir.trim() !== '';

            // Buscar el primer que NO sigui gràfic i que tingui OnAir (faro) o sigui final trimeat
            for (var u = 0; u < ungroupedCandidates.length; u++) {
                var cand = ungroupedCandidates[u];
                var candItem = cand.item;
                // Saltar gràfics
                if (candItem && window.FASTPASS_UI.Workflows.Markers._isGraphicByNum(candItem.num)) {
                    continue;
                }
                // Si té OnAir real, és un faro → retornar-lo
                var candHasOnAir = candItem && candItem.horaEntradaOnAir
                    && candItem.horaEntradaOnAir !== '00:00:00'
                    && candItem.horaEntradaOnAir.trim() !== '';
                if (candHasOnAir) {
                    return candItem;
                }
                // Si és el final trimeat (no OnAir) i NO és l'últim → retornar-lo
                if (cand.item !== lastItem) {
                    return cand.item;
                }
            }
            return null;  // Tots són el final
        },

        /**
         * captureTimelineSnapshot()
         * Captura una instantània IMMUTABLE del timeline actual:
         * context, classificació d'ítems, àncores temporals i densitat.
         * 
         * S2 (Optimització Estructural): Cada operativa (Markers, MP4,
         * Chyrons, Graphics) pot cridar aquesta funció UNA vegada al
         * inici del seu flux i treballar amb la seva pròpia còpia
         * congelada, sense risc que una altra operativa modifiqui
         * l'estat compartit.
         *
         * @returns {Object|null} Snapshot congelat o null si falla
         */
        captureTimelineSnapshot: async function () {
            const log = function (m, lvl) { return window.FASTPASS_UI.Utils.log(m, lvl || "DEBUG"); };

            // 1. Carregar context base
            const ctxData = await this.loadAssemblyContext();
            if (!ctxData) {
                log("⚠️ [Snapshot] loadAssemblyContext ha fallat.", "WARN");
                return null;
            }

            // 2. Classificar ítems
            const classData = window.FASTPASS_UI.Workflows.Markers._classifyItems(ctxData.lines);
            if (!classData) {
                log("⚠️ [Snapshot] _classifyItems ha fallat.", "WARN");
                return null;
            }

            // 3. Calcular àncores temporals
            const anchors = window.FASTPASS_UI.Workflows.Markers._calcTemporalAnchors(
                ctxData.manifest, ctxData.reader, classData.structuralItems, ctxData.clips
            );
            if (!anchors) {
                log("⚠️ [Snapshot] _calcTemporalAnchors ha fallat.", "WARN");
                return null;
            }

            // 4. Calcular petjada de densitat
            const densityData = window.FASTPASS_UI.Workflows.MP4._calcDensityFootprint(ctxData.clips);

            // 5. Congelar i emmagatzemar
            var snapshot = {
                context: ctxData,
                classification: classData,
                anchors: anchors,
                density: densityData,
                capturedAt: new Date().toISOString()
            };
            this._snapshot = Object.freeze(snapshot);

            log("📍 [Snapshot] Instantània capturada: " + ctxData.lines.length + " línies, " + classData.structuralItems.length + " estructurals, " + classData.graphicItems.length + " gràfics.");
            return this._snapshot;
        },

        /**
         * getSnapshot()
         * Retorna la instantània actual sense recalcular.
         * @returns {Object|null} Snapshot congelat o null si no se n'ha capturat cap
         */
        getSnapshot: function () {
            return this._snapshot || null;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();