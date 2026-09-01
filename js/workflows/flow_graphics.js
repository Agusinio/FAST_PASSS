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
         * _waitClipAt: Espera (polling) fins que una pista té o deixa de tenir un clip
         * que cobreix un temps donat. Retorna true si s'assoleix l'estat esperat.
         */
        _waitClipAt: async function (trackIdx, timeSec, shouldExist, timeoutMs) {
            const start = Date.now();
            const timeout = timeoutMs || 5000;
            while (Date.now() - start < timeout) {
                const raw = await callJSX(`Clips.at(${trackIdx}, ${timeSec}, 'video')`);
                const exists = (raw && raw !== "null");
                if (exists === shouldExist) return true;
                await getUtils().delay(250);
            }
            return false;
        },

        /**
         * runDoblePantalla: Verticalitza el clip 16:9 de doble pantalla sota el CTI.
         * Tota la lògica viu en JS; el JSX només executa funcions atòmiques.
         * Convenció de pista al JSX: 1-based, però dins de Premiere V1 = videoTracks[0].
         * Per tant: 1=V1, 2=V2, 3=V3, 4=V4.
         */
        runDoblePantalla: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            try {
                log("🎬 [DoblePantalla] Iniciant verticalització de clip 16:9...");
                const T_V1 = 1, T_V2 = 2, T_V3 = 3, T_V4 = 4;

                const cti = parseFloat(await callJSX('Timeline.get()') || "0");
                const infoRaw = await callJSX(`Clips.at(${T_V1}, ${cti}, 'video')`);
                if (!infoRaw || infoRaw === "null") {
                    getUtils().status("Col·loca el CTI sobre el clip 16:9", "warn");
                    return;
                }
                const info = JSON.parse(infoRaw);
                const v1Start = info.start, v1End = info.end;
                log(`🎬 [DoblePantalla] Clip origen: V1[${info.index}] "${info.name}" ${v1Start.toFixed(2)}s→${v1End.toFixed(2)}s`);

                // ── PAS 1: Preservar el clip de V2 (recortar al rang i pujar-lo a V4) ──
                const v2Clips = await getClipsLogic().getTrackClips(T_V2, 'video');
                const v2Clip = v2Clips.find(c => c.start < v1End && c.end > v1Start);
                if (v2Clip) {
                    log(`🎬 [DoblePantalla] PAS1: V2[${v2Clip.index}] "${v2Clip.name}" → recortar a [${v1Start.toFixed(2)},${v1End.toFixed(2)}] i moure a V4`);
                    await callJSX(`Clips.trim(${T_V2}, ${v2Clip.index}, ${v1Start}, ${v1End})`);
                    await getUtils().delay(300);

                    const dupV4 = await callJSX(`Clips.duplicate(${T_V2}, ${v2Clip.index}, ${T_V4})`);
                    log(`🎬 [DoblePantalla]   duplicate V2→V4 → ${dupV4}`);
                    await this._waitClipAt(T_V4, v1Start, true);

                    let rmRes = await callJSX(`Clips.remove(${T_V2}, ${v2Clip.index})`);
                    await getUtils().delay(300);
                    let v2Gone = await this._waitClipAt(T_V2, v1Start, false, 3000);
                    if (!v2Gone) {
                        log("⚠️ [DoblePantalla]   V2 encara té el clip; reintentant remove...");
                        rmRes = await callJSX(`Clips.remove(${T_V2}, ${v2Clip.index})`);
                        await getUtils().delay(300);
                        v2Gone = await this._waitClipAt(T_V2, v1Start, false, 3000);
                    }
                    log(`🎬 [DoblePantalla]   remove V2 → ${rmRes} | verificació: ${v2Gone ? 'OK' : 'TIMEOUT'}`);
                } else {
                    log("ℹ️ [DoblePantalla] PAS1: no hi ha clip a V2 en el rang. Es continua.");
                }

                // ── PAS 2: Moure el clip de V1 a V2 (inferior) ──
                // Move descompost (duplicate + remove) per poder VERIFICAR cada pas.
                log(`🎬 [DoblePantalla] PAS2: moure V1[${info.index}] → V2`);
                const dupV2 = await callJSX(`Clips.duplicate(${T_V1}, ${info.index}, ${T_V2})`);
                log(`🎬 [DoblePantalla]   duplicate V1→V2 → ${dupV2}`);
                const v2ok = await this._waitClipAt(T_V2, cti, true);
                if (!v2ok) { getUtils().status("Error: no apareix el clip a V2", "error"); return; }

                let rmV1 = await callJSX(`Clips.remove(${T_V1}, ${info.index})`);
                await getUtils().delay(300);
                let v1Gone = await this._waitClipAt(T_V1, cti, false, 3000);
                if (!v1Gone) {
                    log("⚠️ [DoblePantalla]   V1 encara té el clip; reintentant remove...");
                    rmV1 = await callJSX(`Clips.remove(${T_V1}, ${info.index})`);
                    await getUtils().delay(300);
                    v1Gone = await this._waitClipAt(T_V1, cti, false, 3000);
                }
                log(`🎬 [DoblePantalla]   remove V1 → ${rmV1} | verificació: ${v1Gone ? 'OK' : 'TIMEOUT'}`);

                // ── PAS 3: Duplicar V2 → V3 (superior) ──
                const v2AfterRaw = await callJSX(`Clips.at(${T_V2}, ${cti}, 'video')`);
                if (!v2AfterRaw || v2AfterRaw === "null") { getUtils().status("No trobat clip a V2", "error"); return; }
                const v2After = JSON.parse(v2AfterRaw);
                log(`🎬 [DoblePantalla] PAS3: duplicar V2[${v2After.index}] → V3`);
                const dupV3 = await callJSX(`Clips.duplicate(${T_V2}, ${v2After.index}, ${T_V3})`);
                log(`🎬 [DoblePantalla]   duplicate V2→V3 → ${dupV3}`);
                await this._waitClipAt(T_V3, cti, true);

                // ── PAS 4: Fons a V1 (opcional; si no està al projecte, només avisa) ──
                const bgName = "Fons_Vertical_Generic.png"; // ⚠️ Pendiente: usuari donarà el clip de fons
                const bgRes = await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_V1}, ${cti}, null, 'video')`);
                if (bgRes !== "OK" && String(bgRes).indexOf('ERR') === 0) {
                    log(`⚠️ [DoblePantalla] PAS4: no s'ha pogut col·locar el fons (${bgRes}). Es continua sense fons.`, "WARN");
                } else {
                    log(`🎬 [DoblePantalla] PAS4: fons a V1 → ${bgRes}`);
                }

                // ── PAS 5: Propietats Motion ──
                const comuns = { scale: 68, cropTop: 14, cropBottom: 15.5 };
                const infVals = Object.assign({}, comuns, { position: [141, 451], cropLeft: 61 });
                const supVals = Object.assign({}, comuns, { position: [492, 451], cropRight: 64.5 });

                const infRes = await callJSX(`Anim.setMotionValues(${T_V2}, ${v2After.index}, '${JSON.stringify(infVals).replace(/'/g, "\\'")}')`);
                const v3Clips = await getClipsLogic().getTrackClips(T_V3, 'video');
                const v3Clip = v3Clips.find(c => Math.abs(c.start - v1Start) < 0.1) || v3Clips[v3Clips.length - 1];
                const supRes = await callJSX(`Anim.setMotionValues(${T_V3}, ${v3Clip.index}, '${JSON.stringify(supVals).replace(/'/g, "\\'")}')`);
                log(`🎬 [DoblePantalla] PAS5: Motion inferior: ${infRes} | superior: ${supRes}`);

                getUtils().status("Doble pantalla processada (revisa el log)", "exito");
            } catch (e) { getUtils().handleError(e, "runDoblePantalla"); }
        },

        /**
         * Placeholders pels botons IPD / MAPA / TOTEM (pendents d'especificació).
         */
        runIpd: async function () {
            log("ℹ️ [IPD] Botó pendent d'implementar.");
            getUtils().status("IPD pendent", "warn");
        },
        runMapa: async function () {
            log("ℹ️ [MAPA] Botó pendent d'implementar.");
            getUtils().status("MAPA pendent", "warn");
        },
        runTotem: async function () {
            log("ℹ️ [TOTEM] Botó pendent d'implementar.");
            getUtils().status("TOTEM pendent", "warn");
        },

        /**
         * FASE 3a-b y 4a-b s'han mogut a flow_markers.js (placeCookedMarkers,
         * capturaUsuarioInOut, capturaUsuarioMarks)
         */
    };

    window.FASTPASS_UI.Workflows.Graphics = FASTPASS_UI.Workflows.Graphics;
})();