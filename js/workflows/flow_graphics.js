/**
 * ============================================================================
 * WORKFLOW: GRAPHICS (Infraestructura de Gràfics — CTI, In/Out, Debug)
 * ============================================================================
 * Extret de flow_assembly.js durant la modularització v2.9.5 "LIPO-PRO".
 * Aquest mòdul gestiona operacions de timeline basades en CTI,
 * captura de marcadors d'usuari i validació de WorkArea.
 * Creixerà amb la col·locació de gràfics (GF, TE, P5, P7, TD...).
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Graphics = {

        /**
         * Solució C: Actualitza el punt d'entrada del bloc al cabezal actual (CTI).
         */
        updateBlocInFromCTI: async function() {
            try {
                const cti = parseFloat(await callJSX("Timeline.get()"));
                log(`📍 In Seqüència → ${cti.toFixed(2)}s`);
                await callJSX(`Timeline.inPoint(${cti})`);
                getUtils().status("In fixat", "exito");
            } catch (e) { getUtils().handleError(e, "updateBlocIn"); }
        },

        /**
         * Solució C: Actualitza el punt de sortida del bloc al cabezal actual (CTI).
         */
        updateBlocOutFromCTI: async function() {
            try {
                const cti = parseFloat(await callJSX("Timeline.get()"));
                log(`📍 Fixant BLOC_OUT a ${cti.toFixed(2)}s`);
                
                // 1. Actualitzar Out Point de seqüència
                await callJSX(`Timeline.outPoint(${cti})`);
                
                // 2. Actualitzar marcador BLOC_OUT
                await callJSX(`Markers.set(${cti}, 'BLOC_OUT', 'color=3')`);
                getUtils().status("Out Bloc fixat", "exito");
            } catch (e) { getUtils().handleError(e, "updateBlocOut"); }
        },

        /**
         * Helper: snap al corte más cercano dentro de 2s de tolerancia.
         */
        _snapSimple: function(pos, clipCuts) {
            var best = pos;
            var minD = Infinity;
            for (var i = 0; i < clipCuts.length; i++) {
                var d = Math.abs(clipCuts[i] - pos);
                if (d < minD && d <= 2.0) { minD = d; best = clipCuts[i]; }
            }
            return best;
        },

        /**
         * FASE 3a: Cocinado (inout) — WorkArea snapeado a corte real + sceneDetect.
         * Coloca marcadores de validación a ±1s (color naranja).
         */
        runInOutCocinado: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [INOUT Cocinado] Calculant WorkArea snapejat...");
            try {
                const clips  = await getClipsLogic().getTrackClips(1, 'video');
                if (clips.length === 0) { log("⚠️ No hi ha clips a V1."); return; }
                const clipCuts = clips.map(function(c) { return c.start; });

                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const waCrudo = analysis.crudo || {};

                const waInCrudo  = (waCrudo.workAreaIn !== undefined && waCrudo.workAreaIn !== null) ? waCrudo.workAreaIn : 0;
                const waOutCrudo = (waCrudo.workAreaOut !== undefined && waCrudo.workAreaOut !== null) ? waCrudo.workAreaOut : (clips[clips.length - 1] ? clips[clips.length - 1].end : 0);

                // Snap a corte más cercano
                const snapIn  = this._snapSimple(waInCrudo, clipCuts);
                const snapOut = this._snapSimple(waOutCrudo, clipCuts);

                // Aplicar WorkArea en Premiere
                await callJSX("Timeline.setWorkArea(" + snapIn + ", " + snapOut + ")");

                // Colocar marcadores de validación a ±1s (color naranja = 3)
                const validIn  = snapIn + 1.0;
                const validOut = snapOut - 1.0;
                await callJSX("Markers.set(" + validIn + ", 'VALID_IN', 'color=3')");
                await callJSX("Markers.set(" + validOut + ", 'VALID_OUT', 'color=3')");

                // Guardar sceneDetect + inout dins fase 'cocinado' (merge automàtic)
                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
                    clipCuts: clipCuts,
                    totalClips: clips.length,
                    workAreaIn: snapIn,
                    workAreaOut: snapOut,
                    snapDeltaIn:  snapIn - waInCrudo,
                    snapDeltaOut: snapOut - waOutCrudo,
                    validInMarker: validIn,
                    validOutMarker: validOut,
                    capturedAt: new Date().toISOString()
                });

                getUtils().status("INOUT Cocinado OK", "exito");
            } catch (e) { getUtils().handleError(e, "runInOutCocinado"); }
        },

        /**
         * FASE 3b: Cocinado (marks) — col·loca les 3 fases de marcadors + captura deltaCrudo.
         */
        placeCookedMarkers: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [MARKS Cocinado] Col·locant marcadors amb snap a cortes...");
            try {
                // Col·locar les 3 fases de marcadors estructurals
                await FASTPASS_UI.Workflows.Markers.placeOnAirMarkers();
                await FASTPASS_UI.Workflows.Markers.placeDeducedOnAirMarkers();
                await FASTPASS_UI.Workflows.Markers.placeScheduledMarkers();

                // Ahora leer los marcadores del timeline para guardarlos como marksCocinado
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const marksCrudo = analysis.crudo || { markers: [] };

                // Leer marcadores del timeline
                const markersRaw = await callJSX("Markers.get()");
                var timelineMarkers = [];
                if (markersRaw && markersRaw !== "[]") {
                    try { timelineMarkers = JSON.parse(markersRaw); } catch (e) {}
                }

                // Mapear por num extraído del comentario
                var crudoMap = {};
                for (var i = 0; i < marksCrudo.markers.length; i++) {
                    var m = marksCrudo.markers[i];
                    crudoMap[m.num] = m;
                }

                var cookedMarkers = [];
                for (var j = 0; j < timelineMarkers.length; j++) {
                    var tm = timelineMarkers[j];
                    var comment = tm.comments || tm.comment || '';
                    // Saltar marcadores de validación
                    if (comment === 'VALID_IN' || comment === 'VALID_OUT') continue;
                    // Extraer num del comentario
                    var numMatch = comment.match(/^(\d+)/);
                    var num = numMatch ? numMatch[1] : '';
                    var titol = comment.replace(/^\d+\s*-\s*/, '').trim();

                    var crudoRef = crudoMap[num] || null;

                    cookedMarkers.push({
                        num: num,
                        titol: titol,
                        posCocinado: tm.time,
                        deltaVsCrudo: crudoRef ? (tm.time - crudoRef.additPosSec) : 0
                    });
                }

                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
                    markers: cookedMarkers,
                    capturedAt: new Date().toISOString()
                });

                getUtils().status(cookedMarkers.length + " MARKS Cocinats", "exito");
            } catch (e) { getUtils().handleError(e, "placeCookedMarkers"); }
        },

        /**
         * FASE 4a: Usuario (inout) — Captura les posicions reals de VALID_IN/VALID_OUT.
         */
        capturaUsuarioInOut: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [CAPTURA INOUT] Llegint VALID_IN/VALID_OUT del timeline...");
            try {
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const inoutCocinado = analysis.cocinado || {};

                const markersRaw = await callJSX("Markers.get()");
                var markers = [];
                if (markersRaw && markersRaw !== "[]") {
                    try { markers = JSON.parse(markersRaw); } catch (e) {}
                }

                var validInPos = null;
                var validOutPos = null;
                for (var i = 0; i < markers.length; i++) {
                    var m = markers[i];
                    var comment = (m.comments || m.comment || '').trim();
                    if (comment === 'VALID_IN') validInPos = m.time;
                    if (comment === 'VALID_OUT') validOutPos = m.time;
                }

                if (validInPos === null || validOutPos === null) {
                    log("⚠️ No s'han trobat els marcadors VALID_IN/VALID_OUT al timeline.");
                    getUtils().status("No hi ha marcadors de validació", "error");
                    return;
                }

                var deltaIn  = inoutCocinado.validInMarker !== undefined ? (validInPos - inoutCocinado.validInMarker) : 0;
                var deltaOut = inoutCocinado.validOutMarker !== undefined ? (validOutPos - inoutCocinado.validOutMarker) : 0;

                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'usuario', {
                    validInMarker: validInPos,
                    validOutMarker: validOutPos,
                    deltaVsCocinado_in: deltaIn,
                    deltaVsCocinado_out: deltaOut,
                    capturedAt: new Date().toISOString()
                });

                getUtils().status("IN/OUT Usuari capturat", "exito");
            } catch (e) { getUtils().handleError(e, "capturaUsuarioInOut"); }
        },

        /**
         * FASE 4b: Usuario (marks) — Lee todos los marcadores del timeline.
         */
        capturaUsuarioMarks: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [CAPTURA MARKS] Llegint marcadors del timeline...");
            try {
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const marksCrudo   = analysis.crudo   || { markers: [] };
                const marksCocinado = analysis.cocinado || { markers: [] };

                // Leer todos los marcadores del timeline
                const markersRaw = await callJSX("Markers.get()");
                var markers = [];
                if (markersRaw && markersRaw !== "[]") {
                    try { markers = JSON.parse(markersRaw); } catch (e) {}
                }

                // Construir mapas de referencia
                var crudoMap = {};
                for (var i = 0; i < marksCrudo.markers.length; i++) {
                    var m = marksCrudo.markers[i];
                    crudoMap[m.num] = m;
                }
                var cocinadoMap = {};
                for (var j = 0; j < marksCocinado.markers.length; j++) {
                    var m = marksCocinado.markers[j];
                    cocinadoMap[m.num] = m;
                }

                var userMarkers = [];
                for (var k = 0; k < markers.length; k++) {
                    var tm = markers[k];
                    var comment = tm.comments || tm.comment || '';
                    // Saltar marcadores de validación
                    if (comment === 'VALID_IN' || comment === 'VALID_OUT') continue;
                    // Extraer num del comentario
                    var numMatch = comment.match(/^(\d+)/);
                    var num = numMatch ? numMatch[1] : '';
                    var titol = comment.replace(/^\d+\s*-\s*/, '').trim();

                    var crudoRef = crudoMap[num] || null;
                    var cocinadoRef = cocinadoMap[num] || null;

                    userMarkers.push({
                        num: num,
                        titol: titol,
                        posUsuario: tm.time,
                        deltaVsCocinado: cocinadoRef ? (tm.time - cocinadoRef.posColocada) : 0,
                        deltaVsCrudo: crudoRef ? (tm.time - crudoRef.additPosSec) : 0
                    });
                }

                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'usuario', {
                    markers: userMarkers,
                    capturedAt: new Date().toISOString()
                });

                getUtils().status(userMarkers.length + " MARKS Usuari capturats", "exito");
            } catch (e) { getUtils().handleError(e, "capturaUsuarioMarks"); }
        }
    };

    window.FASTPASS_UI.Workflows.Graphics = FASTPASS_UI.Workflows.Graphics;
})();