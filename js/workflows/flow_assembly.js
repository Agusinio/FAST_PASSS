/**
 * ============================================================================
 * WORKFLOW: ASSEMBLY (Montatge Automàtic i Orquestració)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const getParse = () => window.Parse;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Assembly = {

        /**
         * Realitza el posicionament automàtic de rètols després del scene Detection.
         */
        runAutoPlacement: async function (mainTrack = 1) {
            log("🎬 Iniciant Assemblatge Automàtic (THE MAGIC)...");
            const state = FASTPASS_UI.State;
            const cfg = FASTPASS_UI.Config.get();

            if (!state.structure || state.structure.length === 0) {
                log("⚠️ No hi ha estructura carregada. Avortant muntatge.");
                return;
            }

            try {
                // 1. Obtenir clips de la línia de temps
                const clips = await getClipsLogic().getTrackClips(mainTrack, "video");
                if (clips.length === 0) return;

                const struct = state.structure;
                let clipIndex = 0;

                for (let bIndex = 0; bIndex < struct.length; bIndex++) {
                    const block = struct[bIndex];

                    // Cercar el primer clip d'aquest bloc
                    let headClip = clips[clipIndex];
                    if (!headClip) break;

                    const blockStartTime = headClip.start;
                    const blockDuration = headClip.end - headClip.start;
                    const type = getParse().classify(block, blockDuration);

                    log(`📦 Bloc ${block.id} (${type}) -> Clips iniciant a ${blockStartTime.toFixed(2)}s`);

                    if (type === "INTRO") {
                        await this._placeIntroGfx(block, headClip, cfg.tracks.video, (bIndex === 0));
                        // Aplicar REFRAME a la Intro
                        log(`   ✨ Aplicant Auto Reframe a la INTRO (V${mainTrack}:${headClip.index})`);
                        await callJSX(`jsx_applyAutoReframe(${mainTrack}, ${headClip.index})`);
                        clipIndex++;
                    } else {
                        // Agrupem tots els clips que pertanyen a aquest bloc
                        let blockClips = [headClip];
                        let nextI = clipIndex + 1;
                        while (clips[nextI] && (clips[nextI].end - clips[nextI].start) < 10) {
                            blockClips.push(clips[nextI]);
                            nextI++;
                        }

                        // ALQUÍMIA: Inferència màgica
                        const result = await this._placeMagicChyrons(block, blockClips, cfg.tracks.video);

                        // Si el bloc és un INSERT (té NomCarrec i Firma) -> Reframe a tots els seus clips
                        if (result.isInsert) {
                            log(`   ✨ Aplicant Auto Reframe a INSERTS de ${block.id}`);
                            for (const clip of blockClips) {
                                await callJSX(`jsx_applyAutoReframe(${mainTrack}, ${clip.index})`);
                            }
                        }

                        clipIndex = nextI;
                    }
                }

                log("✅ Assemblatge Màgic completat.");

            } catch (e) { getUtils().handleError(e, "Assembly_Magic"); }
        },

        /**
         * Regles d'Intro: Decalatges i seguretat de temporal.
         */
        _placeIntroGfx: async function (block, clip, tracks, isFirst) {
            const safety = 0.4; // 10 frames
            const start = isFirst ? Math.max(clip.start, safety) : clip.start;
            const duration = clip.end - clip.start;

            const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
            const conductor = block.chyrons.find(c => c.rol === "CONDUCTOR");

            if (duration >= 10) {
                // TemaTitol -> 6.3s -> Conductor
                if (tematitol) await callJSX(`jsx_overwriteClip('${getUtils().escape(tematitol.name)}', ${tracks.tematitol}, ${start}, 'video')`);
                if (conductor) await callJSX(`jsx_overwriteClip('${getUtils().escape(conductor.name)}', ${tracks.chyrons}, ${start + 6.3}, 'video')`);
            } else {
                // Conductor -> final -> TemaTitol
                if (conductor) await callJSX(`jsx_overwriteClip('${getUtils().escape(conductor.name)}', ${tracks.chyrons}, ${start}, 'video')`);
                if (tematitol) await callJSX(`jsx_overwriteClip('${getUtils().escape(tematitol.name)}', ${tracks.tematitol}, ${clip.end - 2.0}, 'video')`);
            }
        },

        /**
         * LA MÀGIA: Match de footprint i snap magnètic a talls.
         */
        _placeMagicChyrons: async function (block, clips, tracks) {
            log(`   🔮 Aplicant Footprint Matching a ${block.id}...`);

            // 1. Buscar ANCLA (NomCarrec coincidents amb clips llargs)
            let anchors = [];
            for (const c of block.chyrons) {
                if (c.rol !== "NOMCARREC") continue;
                const idealPos = clips[0].start + getUtils().timeToSeconds(c.tc);

                // Busquem un clip que envolti aquesta posició ideal i duri > 2.5s
                const candidate = clips.find(clip => clip.start <= (idealPos + 2) && clip.start >= (idealPos - 2) && (clip.end - clip.start) > 2.5);
                if (candidate) {
                    anchors.push({ delta: candidate.start - idealPos });
                }
            }

            // 2. Calcular Offset Mig
            const avgDelta = anchors.length > 0 ? (anchors.reduce((s, a) => s + a.delta, 0) / anchors.length) : 0;
            log(`      📐 Decalatge mig detectat per al bloc: ${avgDelta.toFixed(2)}s`);

            // 3. Col·locació amb SNAP al tall real més proper
            let hasNom = false;
            let hasFirma = false;

            for (const c of block.chyrons) {
                const idealPos = clips[0].start + getUtils().timeToSeconds(c.tc);
                const adjustedTime = idealPos + avgDelta;

                // Marcadors per a REFRAME
                if (c.rol === "NOMCARREC") hasNom = true;
                if (c.name.includes("Firma")) hasFirma = true;

                // Ancoratge magnètic al tall real de V1
                let bestCut = clips[0].start;
                let minDiff = 999;
                for (const clip of clips) {
                    const diff = Math.abs(clip.start - adjustedTime);
                    if (diff < minDiff) { minDiff = diff; bestCut = clip.start; }
                }

                let targetTrack = tracks.chyrons;
                if (c.name.includes("Lloc") || c.name.includes("Data")) targetTrack = tracks.llocdata;
                if (c.name.indexOf("   ") === 0) targetTrack = tracks.graficos;

                log(`      📍 Snap: ${c.name} -> ${bestCut.toFixed(2)}s (V${targetTrack})`);
                await callJSX(`jsx_overwriteClip('${getUtils().escape(c.name)}', ${targetTrack}, bestCut, 'video')`);
            }

            return { isInsert: (hasNom && hasFirma) };
        }
    };

    window.FASTPASS_UI.Workflows.Assembly = FASTPASS_UI.Workflows.Assembly;
})();
