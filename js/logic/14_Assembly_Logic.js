/**
 * ============================================================================
 * LOGIC: ASSEMBLY (Orquestació de muntatge i acabats) - v2.6.0 literal
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG"),
        delay: (ms) => window.FASTPASS_UI.Utils.delay(ms),
        escape: (s) => window.FASTPASS_UI.Utils.escape(s),
        timeToSeconds: (tc) => window.FASTPASS_UI.Utils.timeToSeconds(tc)
    };

    FASTPASS_UI.Logic.Assembly = {
        
        /**
         * setup: Orquestra el muntatge decoratiu base (Temes, SRTs, Chyrons).
         */
        setup: async function(state) {
            utils.log("🏗️ Assembly: Orquestrant muntatge decoratiu...");
            const cfg = window.FASTPASS_UI.Config.get();
            
            // 1. TEMA-TITOL (V4)
            if (state.masterTheme) {
                await window.Clips.insert(state.masterTheme.name, cfg.tracks.video.tematitol, 0.0);
            }

            // 2. SRT (V5)
            if (state.srt) {
                await window.Clips.insert(state.srt.name, cfg.tracks.subtitle.s1, 0.0);
            }
            
            // 3. CHYRON MASTER (V6)
            const masterChyronRaw = await utils.callJSX("Project.biggestIn('CHYRONS')");
            const masterChyron = JSON.parse(masterChyronRaw || "null");
            
            if (masterChyron) {
                utils.log(`🎯 Chyron principal detectat: ${masterChyron.name}`);
                await window.Clips.insert(masterChyron.name, cfg.tracks.video.chyrons, 0.4, 6.6);
            }

            return "OK_SETUP";
        },

        /**
         * freeze: Genera el freeze frame final automatitzat.
         */
        freeze: async function(targetTime = 6.6) {
            utils.log(`📸 Assembly: Generant Freeze Frame a ${targetTime}s...`);
            const cfg = window.FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;

            // 1. Aïllament visual de la pista de Temes
            await window.Tracks.isolate(T_THEME, "video");
            await window.Timeline.set(targetTime);
            await utils.delay(1000);

            // 2. Captura orquestrada (Literal: Context.folder)
            const folder = await utils.callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`.replace(/\\/g, "\\\\");
            const res = await window.Render.capture(snapPath, targetTime);
            
            // 3. Restauració de visibilitat
            await window.Tracks.all("video", "mute", false);

            // 4. Importació i "Smart Insert"
            if (res.success) {
                const fileName = snapPath.split("\\\\").pop();
                const payload = JSON.stringify([snapPath]);
                // Literal: IO.importFiles
                await utils.callJSX(`IO.importFiles('${payload}', 'root')`);
                
                // Literal: Timeline.duration()
                const dur = await utils.callJSX("Timeline.duration()");
                await window.Clips.insert(fileName, T_THEME, targetTime, dur);
                return "OK_FREEZE";
            }
            return "ERR_FREEZE";
        },

        /**
         * conductor: Insereix el grafisme del conductor.
         */
        conductor: async function(conductorFile, targetTime = 7.6) {
            if (!conductorFile) return "NO_CONDUCTOR";
            const cfg = window.FASTPASS_UI.Config.get();
            const pathRaw = `${cfg.rutas.conductors}${conductorFile}`;
            
            utils.log(`👤 Assembly: Inserint conductor ${conductorFile}`);
            const payload = JSON.stringify([pathRaw.replace(/\\/g, "\\\\\\\\")]);  // corregit doble escape
            // Literal: IO.importFiles
            await utils.callJSX(`IO.importFiles('${payload}', 'root')`);
            await window.Clips.insert(conductorFile, cfg.tracks.video.chyrons, targetTime);
            
            return "OK_CONDUCTOR";
        },

        /**
         * calcFootprintDelta: Calcula el decalatge mig entre posició ideal i posició real
         * dels NomCarrec d'un bloc. Retorna 0 si no hi ha ancoratges disponibles.
         *
         * @param {Object} block  - Bloc amb array block.chyrons
         * @param {Array}  clips  - Array de clips del bloc (blockClips)
         * @returns {number} Desplaçament mig en segons
         */
        calcFootprintDelta: function(block, clips) {
            const anchors = [];
            for (const c of block.chyrons) {
                if ((c.rol || '').toUpperCase() !== "NOMCARREC") continue;
                const idealPos = clips[0].start + utils.timeToSeconds(c.tc);
                const candidate = clips.find(clip =>
                    clip.start <= (idealPos + 2) &&
                    clip.start >= (idealPos - 2) &&
                    (clip.end - clip.start) > 2.5
                );
                if (candidate) {
                    anchors.push({ delta: candidate.start - idealPos });
                }
            }
            return anchors.length > 0
                ? anchors.reduce((s, a) => s + a.delta, 0) / anchors.length
                : 0;
        },

        /**
         * findCandidateClip: Busca el clip més adient per col·locar un chyron a idealPos.
         * Intenta trobar un clip contenidor amb marges suficients; cau en fallbacks progressius.
         *
         * @param {Array}  clips    - Array de clips del bloc
         * @param {number} idealPos - Temps ideal en segons
         * @param {Object} [opts]   - { minMarginBefore, minMarginAfter }
         * @returns {Object} Clip candidat
         */
        findCandidateClip: function(clips, idealPos, opts) {
            const minMarginBefore = (opts && opts.minMarginBefore !== undefined) ? opts.minMarginBefore : 0.5;
            const minMarginAfter  = (opts && opts.minMarginAfter  !== undefined) ? opts.minMarginAfter  : 3.0;

            // 1. Clips que contenen idealPos amb marges suficients
            let containerClips = clips.filter(clip =>
                clip.start <= idealPos + 0.1 &&
                clip.end   >= idealPos - 0.1 &&
                (clip.end - clip.start) > 2.5 &&
                (idealPos - clip.start) >= minMarginBefore &&
                (clip.end - idealPos)   >= minMarginAfter
            );
            if (containerClips.length > 0) {
                return containerClips.reduce((prev, curr) => prev.end < curr.end ? prev : curr);
            }

            // 2. Fallback: contenidors sense restricció de marge
            let containerFallback = clips.filter(clip =>
                clip.start <= idealPos + 0.1 &&
                clip.end   >= idealPos - 0.1 &&
                (clip.end - clip.start) > 2.5
            );
            if (containerFallback.length > 0) {
                return containerFallback.reduce((prev, curr) => prev.end < curr.end ? prev : curr);
            }

            // 3. Fallback: clip proper (±2s)
            let nearbyClip = clips.find(clip =>
                clip.start <= (idealPos + 2) &&
                clip.start >= (idealPos - 2) &&
                (clip.end - clip.start) > 2.5
            );
            if (nearbyClip) return nearbyClip;

            // 4. Darrer recurs: primer clip del bloc
            return clips[0];
        },

        /**
         * classifyChyrons: Classifica els chyrons d'un bloc per tipus:
         * temaTitols, traduccions, otros. També detecta si hi ha NomCarrec i Firma.
         *
         * Centralitza els 5+ llocs on s'usava c.name.includes("Tema-Titol").
         *
         * @param {Array} chyrons - Array de chyrons del bloc
         * @returns {{ temaTitols, traduccions, otros, hasNom, hasFirma }}
         */
        classifyChyrons: function(chyrons) {
            const temaTitols = [];
            const traduccions = [];
            const otros = [];
            let hasNom = false;
            let hasFirma = false;

            for (const c of chyrons) {
                if (c.name.includes("Tema-Titol") || c.name.includes("TITOL")) {
                    temaTitols.push(c);
                } else if (
                    (c.rol || '').toUpperCase().includes("TRADUCCIO") ||
                    c.name.toUpperCase().includes("TRADUCCIO")
                ) {
                    traduccions.push(c);
                } else {
                    otros.push(c);
                }
                if ((c.rol || '').toUpperCase() === "NOMCARREC") hasNom = true;
                if (c.name.includes("Firma")) hasFirma = true;
            }

            return { temaTitols, traduccions, otros, hasNom, hasFirma };
        }
    };

    // Alias global literal
    window.Assembly = FASTPASS_UI.Logic.Assembly;

    window.FASTPASS_UI = FASTPASS_UI;
})();
