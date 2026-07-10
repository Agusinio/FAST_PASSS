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
         * RESET GRAPHICS: Neteja total de les pistes de gràfics (Pànic button)
         */
        runResetGraphics: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            if (!confirm("Segur que vols ELIMINAR TOTS els gràfics de la línia de temps?")) return;

            log("🧹 Netejant graella de gràfics...");
            const cfg = FASTPASS_UI.Config.get();
            const tracksToClear = [
                cfg.tracks.video.tematitol, 
                cfg.tracks.video.chyrons, 
                cfg.tracks.video.llocdata,
                cfg.tracks.video.graficos
            ];

            try {
                for(let t of tracksToClear) {
                    await callJSX(`Clips.clearTrack(${t}, 'video')`);
                }
                log("✅ Gràfics eliminats correctament.", "INFO");
                getUtils().status("Gràfics Reiniciats", "exito");
            } catch (e) { getUtils().handleError(e, "ResetGraphics"); }
        },

        /**
         * GRAFIC (Marker‑guided placement): Col·loca rètols (wotts) del bin CHY.
         */
        runPlaceGraphic: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Executant placement guiat per marcadors (wotts CHY → markers)...");
            try {
                await FASTPASS_UI.Logic.Assembly.runGuidedAssembly();
                getUtils().status("Placement guiat completat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceGraphic"); }
        },

        /**
         * runPlaceGraph169: Aplica format 16:9 amb fons.
         */
        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9 amb fondos...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     
            const T_FONS = cfg.tracks.video.fondos;  

            try {
                const infoStr = await callJSX(`Clips.at(${T_MP4}, -1, 'video')`);
                if (!infoStr || infoStr === "null") throw new Error("Posa el cabezal sobre el clip.");
                const info = JSON.parse(infoStr);
                await callJSX(`Clips.setProp(${T_MP4}, ${info.index}, 'ADBE Motion', 'ADBE Video Scale', 140, 'video')`);
                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${info.start}, ${info.end}, 'video')`);
            } catch (e) { getUtils().handleError(e, "Graph169"); }
        },

        /**
         * runPlaceBackground: Col·loca un fons vertical genèric.
         */
        runPlaceBackground: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Col·locant fons vertical...");
            const cfg = FASTPASS_UI.Config.get();
            const T_FONS = cfg.tracks.video.fondos;  
            try {
                const cti = parseFloat(await callJSX('Timeline.get()') || "0");
                const bgName = "Fons_Vertical_Generic.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${cti}, null, 'video')`);
                getUtils().status("Fons colocat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceBackground"); }
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
         * FASE 3a-b y 4a-b s'han mogut a flow_markers.js (placeCookedMarkers,
         * capturaUsuarioInOut, capturaUsuarioMarks)
         */
    };

    window.FASTPASS_UI.Workflows.Graphics = FASTPASS_UI.Workflows.Graphics;
})();