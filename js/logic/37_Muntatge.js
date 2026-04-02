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
        escape: (s) => window.FASTPASS_UI.Utils.escape(s)
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
            const masterChyronRaw = await utils.callJSX("Projecte.biggestIn('CHYRONS')");
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
            const folder = await utils.callJSX("Entorn.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`.replace(/\\/g, "\\\\");
            const res = await window.Render.capture(snapPath, targetTime);
            
            // 3. Restauració de visibilitat
            await window.Tracks.all("video", "mute", false);

            // 4. Importació i "Smart Insert"
            if (res.success) {
                const fileName = snapPath.split("\\\\").pop();
                const payload = JSON.stringify([snapPath]);
                // Literal: IO.importFiles
                await utils.callJSX(`Arxiu.importFiles('${payload}', 'root')`);
                
                // Literal: Timeline.duration()
                const dur = await utils.callJSX("Cronologia.duration()");
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
            const payload = JSON.stringify([pathRaw.replace(/\\/g, "\\\\")]);
            // Literal: IO.importFiles
            await utils.callJSX(`Arxiu.importFiles('${payload}', 'root')`);
            await window.Clips.insert(conductorFile, cfg.tracks.video.chyrons, targetTime);
            
            return "OK_CONDUCTOR";
        }
    };

    // Alias global literal
    window.Assembly = FASTPASS_UI.Logic.Assembly;

    window.FASTPASS_UI = FASTPASS_UI;
})();
