/**
 * ============================================================================
 * WORKFLOW: CUT (v15 - VERSIÓ VARIABLES GLOBALS) - flow_cut.js
 * ============================================================================
 * Totes les operacions d'edició (In/Out) ara usen el mapa de pistes global.
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Cut = {

        /**
         * Realitza un Ripple Trim In al clip principal de Mp4.
         */
        runCutIn: async function () {
            log("1. Comprobando existencia de función...");
            const check = await callJSX("typeof FASTPASS.Context.findSequenceByTokens");
            log("   Resultado: " + check);

            if (check !== "function") {
                log("❌ CRÍTICO: La función no existe en Premiere. ¿Colisión de nombres?", "ERROR");
                return;
            }

            // Si llegamos aquí, la función existe.
            const prog = document.getElementById('programa').value;
            const bloc = document.getElementById('bloc').value;
  
            try {
                const config = FASTPASS_UI.Config.get();
                const elProg = document.getElementById('programa').value;
                const elBloc = document.getElementById('bloc').value;
                
                // Obtenemos el token del programa (ej: "TNV" o "TN_VESPRE")
                const progData = config.mapeoProgramas[elProg];
                const progToken = progData ? progData.archivo : elProg;
        
                log(`🔍 Buscant seqüència per tokens: [${progToken}] + [${elBloc}]`);
        
                // 1. Llamada al JSX
                const foundNameRaw = await callJSX(`FASTPASS.Context.findSequenceByTokens('${progToken}', '${elBloc}')`);

                // 2. BLINDAJE: Forzamos que sea un String y limpiamos basura
                // Si llega un objeto o array, String() lo convertirá en algo legible.
                const foundName = await callJSX(`jsx_findSequenceByTokens('${progToken}', '${elBloc}')`);

                if (!foundName || foundName.indexOf("ERR") !== -1 || foundName === "null") {
                    getUtils().status("⚠️ No trobo la seqüència!", "error");
                    log("❌ Error o buit: " + foundName, "ERROR");
                    return;
                }

                // 3. Sincronizamos
                window.FASTPASS_UI.State.activeSequenceName = foundName;
                log("✅ Seqüència sintonitzada: " + foundName);
        
                // 3. Ahora la validación de sincronía PASARÁ siempre
                if (!(await getUtils().validateActiveSequence())) return;
        
                // --- SEGUIMOS CON EL CORTE ---
                const T_MP4 = config.tracks.video.mp4;
                const ctiRaw = await callJSX('jsx_getCTI()'); 
                const val = parseFloat(ctiRaw || "0");
        
                // 4. Buscar el clip (Pasamos el nombre por si findAtTime lo necesita)
                const clip = await getClipsLogic().findAtTime(T_MP4, val, "video");
                
                if (clip) {
                    await getClipsLogic().rippleTrimStart(T_MP4, clip.index, val, clip);
                    await callJSX('jsx_setCTI_Safe(0)');
                    getUtils().status("IN: Tall OK", "exito");
                } else {
                    log("⚠️ No s'ha trobat clip a V" + T_MP4 + " al segon " + val, "WARN");
                }
        
            } catch (e) { getUtils().handleError(e, "CutIn"); }
        },

        /**
         * Workflow de tancament (CUT OUT).
         */
        runCutOut: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Executant tancament PRO (CUT OUT)...");
            
            const cfg = FASTPASS_UI.Config.get();
            const state = FASTPASS_UI.State;
            
            const T_MP4 = cfg.tracks.video.mp4;         // V1
            const T_THEME = cfg.tracks.video.tematitol; // V4
            const T_CHYRONS = cfg.tracks.video.chyrons; // V5

            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const val = parseFloat(ctiRaw || "0");
                
                // 1. NETEJA DE CUES: Esborrem tot el que sobresurti
                // Netegem pistes 1 a 6 (Video)
                await getClipsLogic().clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [T_MP4]);

                // 2. COL·LOCACIÓ TEMA MESTRE (V4)
                if (state.masterTheme) {
                    log(`📌 Col·locant Tema: ${state.masterTheme.name}`);
                    await callJSX(`jsx_overwriteClip('${getUtils().escape(state.masterTheme.name)}', ${T_THEME}, 0.0, 'video')`);
                }

                // 3. COL·LOCACIÓ CONDUCTOR (V5)
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    log(`📌 Col·locant Conductor: ${elCond.value}`);
                    // El conductor sol anar al frame 0 o amb un petit offset si calgués
                    await callJSX(`jsx_overwriteClip('${getUtils().escape(elCond.value)}', ${T_CHYRONS}, 0.0, 'video')`);
                }

                // 4. TANCAMENT DE SEQÜÈNCIA
                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`jsx_setSequenceInOut(0.0, ${outPoint})`);
                
                // 📍 Posicionament final del cabezal per a revisió (1 frame abans del final)
                await callJSX(`jsx_setCTI_Safe(${outPoint})`);
                
                await callJSX('app.project.save()');
                getUtils().status("Peça Tancada OK", "exito");
                log("🏁 Tancament de seqüència completat amb èxit.", "INFO");

            } catch (e) { getUtils().handleError(e, "CutOut"); }
        },

        /**
         * Detectar talls automàticament en el clip principal.
         */
        runScene: async function() { 
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Detectant escenes a V" + T_MP4 + "...");
            await callJSX(`jsx_detectScenes(${T_MP4})`); 
        },

        /**
         * Navegació ràpida al clip ANTERIOR de la pista Mp4.
         */
        runPrevClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("⏮ Nav: Clip anterior a V" + T_MP4);
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`jsx_getClipCount(${T_MP4}, 'video')`));
                for (let i = count - 1; i >= 0; i--) {
                    const raw = await callJSX(`jsx_getClipDataByIndex(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.end <= cti - 0.04) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`jsx_setCTI_Safe(${mid})`);
                        return;
                    }
                }
            } catch (e) { getUtils().handleError(e, "NavPrev"); }
        },

        /**
         * Navegació ràpida al clip SEGÜENT de la pista Mp4.
         */
        runNextClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("⏭ Nav: Clip següent a V" + T_MP4);
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`jsx_getClipCount(${T_MP4}, 'video')`));
                for (let i = 0; i < count; i++) {
                    const raw = await callJSX(`jsx_getClipDataByIndex(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.start >= cti + 0.04) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`jsx_setCTI_Safe(${mid})`);
                        return;
                    }
                }
            } catch (e) { getUtils().handleError(e, "NavNext"); }
        },

        init: function () {
            log("🔧 Workflow Cut lligat a tracks dinàmics.");
        }

    };

    window.FASTPASS_UI = FASTPASS_UI;
})();