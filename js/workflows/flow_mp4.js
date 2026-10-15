/**
 * ============================================================================
 * WORKFLOW: MP4 (Segmentació i Anàlisi de Densitat V1)
 * ============================================================================
 * Extret de flow_assembly.js durant la modularització v2.9.5 "LIPO-PRO".
 * Aquest mòdul gestiona l'anàlisi de densitat del clip V1,
 * debug d'ítems de bloc i captures de WorkArea crues.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const getAssemblyContext = () => window.FASTPASS_UI.Core.AssemblyContext;

    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    // Función para formatear segundos a timecode (HH:MM:SS:FF) asumiendo 25 fps
    const formatTC = (seconds) => {
        const fps = 25;
        // Una sola operación de punto flotante al inicio
        let totalFrames = Math.round(seconds * fps);

        // Extraemos unidades de derecha a izquierda (más eficiente)
        const ff = totalFrames % fps;
        const totalSeconds = (totalFrames / fps) | 0; // Bitwise OR para truncar (más rápido que Math.floor)

        const ss = totalSeconds % 60;
        const totalMinutes = (totalSeconds / 60) | 0;

        const mm = totalMinutes % 60;
        const hh = (totalMinutes / 60) | 0;

        // Retorno directo evitando funciones auxiliares para el padding
        return (hh < 10 ? '0' + hh : hh) + ":" +
            (mm < 10 ? '0' + mm : mm) + ":" +
            (ss < 10 ? '0' + ss : ss) + ":" +
            (ff < 10 ? '0' + ff : ff);
    };

    FASTPASS_UI.Workflows.MP4 = {

        /**
         * _calcDensityFootprint(clips)
         * Wrapper atòmic per a calcDensityFootprintV2.
         * Calcula zones de densitat, ruptures multi-senyal
         * i parells DP+DIR. Pur, sense efectes secundaris.
         *
         * @param {Array} clips - Clips V1 del timeline
         * @returns {Object} densityData { zones, breaks, dpDirPairs, totalDuration }
         */
        _calcDensityFootprint: function (clips) {
            return FASTPASS_UI.Logic.Assembly.calcDensityFootprintV2(clips);
        },

        /**
         * debugBlockItems: Imprime informació dels clips del timeline d'un bloc i dels items d'escaleta,
         * i col·loca marcadors al timeline.
         * @param {string} blockId - Identificador del bloc (per defecte "V1")
         */
        debugBlockItems: async function (blockId = "V1") {
            log(`🔍 [DEBUG] Iniciant debug per al bloc ${blockId}`);
            const reader = window.EscaletaReader;
            const cfg = FASTPASS_UI.Config.get();
            const trackIdx = cfg.tracks.video.mp4; // pista on està el clip del bloc

            // 1. Obtenir dades de l'escaleta actual (carregar JSON més recent)
            const programArchivo = "TN_VESPRE"; // TODO: obtenir del context
            const latest = await reader.findLatest(programArchivo, blockId);
            if (!latest) {
                log(`⚠️ No s'ha trobat JSON d'escaleta per a ${programArchivo}/${blockId}`);
                return;
            }
            const data = await reader.load(latest.path);
            if (!data) {
                log(`⚠️ No s'ha pogut carregar JSON`);
                return;
            }

            // 2. Obtenir bloc
            const block = reader.getBlock(data, blockId);
            if (!block) {
                log(`⚠️ Bloc ${blockId} no trobat`);
                return;
            }
            log(`📋 Bloc ${blockId}: in=${block.in}, out=${block.out}, ready=${block.ready}`);

            // 3. Obtenir items del bloc (taula en memòria)
            const items = reader.getBlockItems(data, blockId);
            log(`📋 Total items del bloc: ${items.length}`);
            items.forEach((item, idx) => {
                log(`   ${idx + 1}. Seq ${item.sequencia} | Num ${item.num} | "${item.titol}" | Durada ${item.durada} | Entrada ${item.horaEntradaPrevista} | Offset ${item.offset.toFixed(2)}s`);
            });

            // 4. Obtenir clips del timeline a la pista mp4
            const clips = await getClipsLogic().getTrackClips(trackIdx, "video");
            log(`🎬 Clips al timeline (pista ${trackIdx}): ${clips.length}`);
            clips.forEach((clip, idx) => {
                log(`   Clip ${idx}: start=${clip.start.toFixed(2)}s, end=${clip.end.toFixed(2)}s, duration=${(clip.end - clip.start).toFixed(2)}s, inPoint=${clip.inPoint.toFixed(2)}s, outPoint=${clip.outPoint.toFixed(2)}s`);
            });

            // 5. Si hi ha clip, assumim que el primer clip correspon al bloc (simplificat)
            const targetClip = clips.length > 0 ? clips[0] : null;
            if (targetClip) {
                log(`🎬 Clip seleccionat per a marcadors: start=${targetClip.start.toFixed(2)}s`);
                // 6. Col·locar marcadors per a cada item
                for (const item of items) {
                    const markerTime = targetClip.start + item.offset;
                    const comment = `${item.num ? item.num + ' - ' : ''}${item.titol}`.trim();
                    log(`   📍 Marcador a ${markerTime.toFixed(2)}s: ${comment}`);
                    await callJSX(`Markers.set(${markerTime}, '${comment.replace(/'/g, "\\'")}', 'Línia Escaleta')`);
                }
                log(`✅ ${items.length} marcadors col·locats.`);
            } else {
                log(`⚠️ No hi ha clip al timeline per col·locar marcadors.`);
            }
        },

        /**
         * FASE 2a: Crudo (inout) — Lee el WorkArea del timeline y lo guarda en fase 'crudo'.
         */
        runInOutCrudo: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [INOUT Crudo] Capturant WorkArea del timeline...");
            try {
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                // 🛡️ (2026-10-14) `Timeline.getWorkAreaIn/Out()` NO EXISTEIXEN al bridge: les
                // crides tornaven "[]" → parseFloat = NaN i la fase 'crudo' quedava amb NaN
                // (i el Cocinado hi tornava a ensopegar). Es llegeix el IN/OUT real.
                const waIn  = parseFloat(await callJSX("Timeline.getIn()"));
                const waOut = parseFloat(await callJSX("Timeline.getOut()"));
                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'crudo', {
                    workAreaIn: isFinite(waIn) ? waIn : 0,
                    workAreaOut: isFinite(waOut) ? waOut : 0,
                    capturedAt: new Date().toISOString()
                });
                getUtils().status("INOUT Crudo capturat", "exito");
            } catch (e) { getUtils().handleError(e, "runInOutCrudo"); }
        },

        /**
         * FASE 2b: Crudo (marks) — Marcadores en posición ideal (sin snapToCut).
         * Cada marcador se coloca en posIdeal = posIdeal acumulada.
         *
         * CORRECCIÓN v2.9.6: Ahora carga el manifest para obtener offsetSec y worldSecMediaStart.
         * Si existe offsetSec, se usa como posición base del primer marcador en lugar de forzar 0.
         * Esto evita la discrepancia cuando el clip está desplazado en el timeline.
         * NO se aplica applyGlobalOffsetSec porque offsetSec ya refleja la posición real del clip.
         */
        placeRawMarkers: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [MARKS Crudos] Col·locant marcadors en posició ideal...");
            try {
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                if (!reader) { log("⚠️ EscaletaReader no disponible."); return; }

                // Cargar escaleta (còpia local del directori del projecte; si no hi és,
                // es baixa del NAS i es copia al directori).
                const datePrefix = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                const latest = await reader.ensureLocalCopy(ctx, datePrefix);
                if (!latest) { log("⚠️ No es troba l'escaleta."); return; }
                const data = await reader.load(latest.path);
                if (!data) { log("⚠️ No s'ha pogut carregar l'escaleta."); return; }

                var lines = reader.getLinesForBlock(data, ctx.bloque);
                if (!lines || lines.length === 0) { log("⚠️ El bloc no té línies."); return; }

                // Ordenar por hora
                lines.sort(function(a, b) {
                    var ha = a.horaEntradaOnAir || a.horaEntradaPrevista || '00:00:00';
                    var hb = b.horaEntradaOnAir || b.horaEntradaPrevista || '00:00:00';
                    return reader.tcToSeconds(ha) - reader.tcToSeconds(hb);
                });

                // ── Determinar blockInSec: TC del primer frame del clip al timeline ──
                // Cercar el clip del cleanFeed que coincideix amb ctx.bloque
                var blockInSec = null;
                var clipsInfo = data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
                for (var ci = 0; ci < clipsInfo.length; ci++) {
                    if (clipsInfo[ci].id && clipsInfo[ci].id.toLowerCase() === ctx.bloque.toLowerCase()) {
                        blockInSec = clipsInfo[ci].in;
                        break;
                    }
                }

                // ── Carregar manifest per obtenir offsetSec ──
                var manifest = null;
                var offsetSec = 0;
                var worldSecMediaStart = 0;
                try {
                    manifest = await FASTPASS_UI.SessionManifest.load(ctx);
                    if (manifest && manifest.ref) {
                        offsetSec = manifest.ref.offsetSec || 0;
                        worldSecMediaStart = manifest.ref.worldSecMediaStart || 0;
                    }
                } catch (me) {
                    log("⚠️ No s'ha pogut carregar el manifest per a offsetSec: " + me.message);
                }

                // ── Determinar tlClipStartSec ──
                // Si tenim offsetSec del manifest, usar-lo com a base.
                // offsetSec ja té en compte la posició real del clip al timeline.
                var tlClipStartSec = offsetSec;
                if (tlClipStartSec === 0) {
                    // Fallback: intentar llegir del timeline
                    try {
                        const v1Clips = await getClipsLogic().getTrackClips(1, "video");
                        if (v1Clips && v1Clips.length > 0) {
                            tlClipStartSec = v1Clips[0].start;
                        }
                    } catch (ce) {
                        log("⚠️ No s'han pogut llegir clips V1: " + ce.message);
                    }
                }

                log(`📍 [MARKS Crudo] tlClipStartSec=${tlClipStartSec.toFixed(3)}s, offsetSec=${offsetSec.toFixed(3)}s, worldSecMediaStart=${worldSecMediaStart.toFixed(3)}s`);

                // Determinar l'àncora de referència per al càlcul de posicions
                // Prioritat: block.in del cleanFeed > primer OnAir de la llista > 0
                var anchorOnAirSec = blockInSec;

                if (anchorOnAirSec === null || anchorOnAirSec === undefined) {
                    // Intentar treure del primer ítem amb OnAir
                    for (var li = 0; li < lines.length; li++) {
                        var onAir = lines[li].horaEntradaOnAir;
                        if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') {
                            anchorOnAirSec = reader.tcToSeconds(onAir);
                            break;
                        }
                    }
                }

                if (anchorOnAirSec === null || anchorOnAirSec === undefined) {
                    // Últim fallback: 0
                    anchorOnAirSec = 0;
                } else {
                    log(`📍 [MARKS Crudo] Usant block.in del cleanFeed com a àncora: ${anchorOnAirSec.toFixed(3)}s`);
                }

                const markersData = [];
                for (var li2 = 0; li2 < lines.length; li2++) {
                    var line = lines[li2];
                    var onAir = line.horaEntradaOnAir;
                    var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';
                    var prevista = line.horaEntradaPrevista;
                    var hasPrevista = prevista && prevista !== '00:00:00';

                    // ── Càlcul de posició ideal ──
                    var refSec = null;
                    var categoria = 'desconegut';

                    if (hasOnAir) {
                        refSec = reader.tcToSeconds(onAir);
                        categoria = 'OnAir';
                    } else if (hasPrevista) {
                        refSec = reader.tcToSeconds(prevista);
                        categoria = 'Prevista';
                    } else {
                        continue; // Saltar ítems sense cap referència temporal
                    }

                    if (refSec === null || refSec === undefined) continue;

                    // Fórmula: posTimeline = tlClipStartSec + (refSec - anchorOnAirSec)
                    var posTimeline = tlClipStartSec + (refSec - anchorOnAirSec);
                    if (posTimeline < 0) posTimeline = 0;

                    // Determinar durada
                    var dStr = line.durada || line.duradaOnAir || '0:00';
                    var parts = dStr.split(':').map(Number);
                    var dSec = 0;
                    if (parts.length === 2) dSec = parts[0] * 60 + parts[1];
                    else if (parts.length === 3) dSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    else dSec = (typeof parts[0] === 'number') ? parts[0] : 0;

                    markersData.push({
                        num: line.num || '',
                        titol: (line.titol || '').substring(0, 60),
                        refSec: refSec,
                        additPosSec: posTimeline,
                        posColocada: posTimeline,
                        categoria: categoria,
                        duradaSec: dSec,
                        baseOffsetSec: tlClipStartSec
                    });
                }

                // Guardar fase crudo (marks) — merge con inoutCrudo anterior
                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'crudo', {
                    markers: markersData,
                    baseOffsetSec: tlClipStartSec,
                    anchorOnAirSec: anchorOnAirSec,
                    capturedAt: new Date().toISOString()
                });

                getUtils().status(markersData.length + " MARKS Crudos (tlClipStart=" + tlClipStartSec.toFixed(2) + "s, anchorOnAir=" + anchorOnAirSec.toFixed(2) + "s)", "exito");
            } catch (e) { getUtils().handleError(e, "placeRawMarkers"); }
        }
    };

    window.FASTPASS_UI.Workflows.MP4 = FASTPASS_UI.Workflows.MP4;
})();