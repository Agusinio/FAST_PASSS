/*
 * =================================================================================
 * PROJECTE: FAST >>> PASS
 * ARXIU: flow_srt.js (WORKFLOW: SUBTÍTOLS)
 * =================================================================================
 */

(function () {
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    const FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};
    const utils = FASTPASS_UI.Utils;

    FASTPASS_UI.Workflows.Srt = {

        /**
         * Activa/Desactiva el mode de treball de subtítols (bloqueja pistes).
         */
        toggleSrtWork: async function (force) {
            utils.log("📝 SRT: Toggle Work Mode.", "DEBUG");

            FASTPASS_UI.State.srtWorkMode = !FASTPASS_UI.State.srtWorkMode;

            const btn = document.getElementById('btn-srt-work');
            const btnIn = document.getElementById('btn-srt-in');
            const btnOut = document.getElementById('btn-srt-out');

            const tracksLogic = FASTPASS_UI.Logic.Tracks;

            if (FASTPASS_UI.State.srtWorkMode) {
                if (btn) { btn.textContent = "TANCAR"; btn.classList.add('btn-active'); }
                if (btnIn) btnIn.disabled = false;
                if (btnOut) btnOut.disabled = false;
                // Bloqueamos todas las de VÍDEO para trabajar tranquilos en subtítulos
                await tracksLogic.setGlobalState("video", "lock", true);
            } else {
                if (btn) { btn.textContent = "PREPARAR"; btn.classList.remove('btn-active'); }
                if (btnIn) btnIn.disabled = true;
                if (btnOut) btnOut.disabled = true;
                await tracksLogic.setGlobalState("video", "lock", false);
            }
            utils.setBusy(false);
        },

        runSrtIn: async function () {
            utils.log("📝 SRT: Marcar IN", "DEBUG");
            try {
                const cti = await utils.callJSX('jsx_getCTI()');

                const srtLogic = FASTPASS_UI.Logic.Srt;
                const clipCount = await utils.callJSX('jsx_getClipCount(1, "subtitle")'); 
                let finalCti = cti;
                if (parseInt(clipCount) === 0 && cti < 0.4) {
                    finalCti = 0.4;
                    utils.log("📍 Primer subtítol: Forçant inici a Frame 10 (0.4s)", "INFO");
                }

                await srtLogic.cleanIn(finalCti);
            } catch (e) {
                utils.handleError(e, "SrtIn");
            } finally {
                utils.setBusy(false);
            }
        },

        runSrtOut: async function () {
            utils.log("📝 SRT: Marcar OUT", "DEBUG");
            try {
                const cti = await utils.callJSX('jsx_getCTI()');
                await FASTPASS_UI.Logic.Srt.cleanOut(cti);
            } catch (e) {
                utils.handleError(e, "SrtOut");
            } finally {
                utils.setBusy(false);
            }
        },

        /**
         * Ajusta la durada del bloc de subtítols de forma proporcional (Acordió).
         */
        runTimeAdjust: async function () {
            utils.log("📝 SRT: Ajustant temps proporcional...", "INFO");

            try {
                // 1. Obtenir Clips Seleccionats
                const jsonClips = await utils.callJSX('jsx_getSelectedSubtitleClips()');
                let clips = [];
                try { clips = JSON.parse(jsonClips); } catch (e) { clips = []; }

                if (!clips || clips.length === 0) throw new Error("Selecciona els rètols que vols ajustar.");

                clips.sort((a, b) => a.start - b.start);

                const firstClipIn = clips[0].start;
                const lastClipOut = clips[clips.length - 1].end;
                const currentTrack = clips[0].trackIndex;
                const currentDur = lastClipOut - firstClipIn;

                // 2. Calcular Límite (Duración Ideal)
                const cti = parseFloat(await utils.callJSX('jsx_getCTI()'));
                const oppositeTrack = (currentTrack === 1) ? 2 : 1;
                const nextClipIn = parseFloat(await utils.callJSX(`jsx_findNextClipOnTrack(${oppositeTrack}, ${firstClipIn}, "subtitle")`));

                let limitTime = 0;
                // Fix v9.5.0: Acordió intel·ligent
                // Detecta el clip més proper a l'altra pista o el cabezal.
                if (nextClipIn > 0 && nextClipIn < cti) {
                    limitTime = nextClipIn;
                    utils.log(`🔗 Ajustant contra clip proper a pista S${oppositeTrack}: ${limitTime}s`, "DEBUG");
                } else if (cti > firstClipIn) {
                    limitTime = cti;
                    utils.log(`🔗 Ajustant contra cabezal (CTI): ${limitTime}s`, "DEBUG");
                } else if (nextClipIn > 0) {
                    limitTime = nextClipIn;
                } else {
                    throw new Error("Posa el cabezal on vols que acabi el bloc.");
                }

                const durIdeal = limitTime - firstClipIn;
                const ratio = durIdeal / currentDur;
                const padding = 0.12; // 3 frames aprox

                // 3. Re-calcular i aplicar de forma atòmica
                log("⏳ Aplicant re-ajust atòmic clip a clip...");
                for (let i = 0; i < clips.length; i++) {
                    const clip = clips[i];
                    const newClipDur = clip.duration * ratio;
                    const newStart = currentTimeCursor;
                    const newEnd = newStart + newClipDur;

                    // Apliquem directament des del JS orquestrant
                    await utils.callJSX(`jsx_setClipStart(${clip.trackIndex}, ${clip.clipIndex}, ${newStart}, 'subtitle')`);
                    await utils.callJSX(`jsx_setClipEnd(${clip.trackIndex}, ${clip.clipIndex}, ${newEnd}, 'subtitle')`);
                    
                    currentTimeCursor = newEnd + padding;
                }

                utils.log(`✅ ${clips.length} subtítols ajustats.`, "INFO");
                utils.status("Ajust Proporcional OK", "exito");

            } catch (e) {
                utils.handleError(e, "SrtTimeAdjust");
            } finally {
                utils.setBusy(false);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();