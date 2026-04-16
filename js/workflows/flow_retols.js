/**
 * ============================================================================
 * WORKFLOW: RETOLS I GRÀFICS - v2.9.5 Tactical
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Retols = {

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
         * RETOLS (Chunk-based): Insereix els rètols només del TEMA/PART seleccionada al cabezal
         */
        runPlaceChyrons: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const state = FASTPASS_UI.State;
            const idx = state.pieceIndex;
            const struct = state.structure;

            if (!struct || !struct[idx]) {
                log("⚠️ No queden més parts per rotular (o escaneig buit).", "WARN");
                return;
            }

            try {
                const part = struct[idx];
                const ctiRaw = await callJSX('Timeline.get()');
                const cti = parseFloat(ctiRaw || "0");

                log(`🎬 Rotulant PART: ${part.id} (${part.theme || 'SENSE TEMA'})`);

                // 1. TEMA-TITOL (V5)
                if (part.theme && part.chyrons) {
                    // Busquem si hi ha un Tema-Titol a la llista de chyrons
                    const themeChyron = part.chyrons.find(c => c.name.toLowerCase().includes("tema") || c.name.toLowerCase().includes("titol"));
                    if (themeChyron) {
                        await callJSX(`Clips.insert('${getUtils().escape(themeChyron.name)}', ${cfg.tracks.video.tematitol}, ${cti}, null, 'video')`);
                    }
                }

                // 2. CHYRON(S) (V6 / V7)
                if (part.chyrons && part.chyrons.length > 0) {
                    const chyronsParaPoner = part.chyrons.filter(c => !c.name.toLowerCase().includes("tema") && !c.name.toLowerCase().includes("titol"));
                    
                    for (let i = 0; i < chyronsParaPoner.length; i++) {
                        const c = chyronsParaPoner[i];
                        const gap = i * 4.0; // Espaiat automàtic si no hi ha metadada de temps
                        
                        let targetTrack = cfg.tracks.video.chyrons;
                        if (c.name.indexOf("Lloc") !== -1 || c.name.indexOf("Data") !== -1) {
                            targetTrack = cfg.tracks.video.llocdata;
                        }
                        
                        await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${cti + gap}, null, 'video')`);
                    }
                }

                // Salta a la següent part
                state.pieceIndex++;
                this.updateUIChunk();
                getUtils().status(`Part ${part.id} LLISTA.`, "exito");

            } catch (e) { getUtils().handleError(e, "PlaceChyronsChunk"); }
        },

        updateUIChunk: function() {
            const state = FASTPASS_UI.State;
            const input = document.getElementById('txt-retol-part');
            if (!input) return;

            if (state.structure && state.structure[state.pieceIndex]) {
                const p = state.structure[state.pieceIndex];
                input.value = p.id + " (" + (p.theme || "???") + ")";
            } else {
                input.value = "FINALITZAT";
            }
        },

        /**
         * GRAFIC (Auto‑placement): Col·loca automàticament tots els rètols, traduccions i llocdata
         * sense fer scene‑detection ni guardar el projecte.
         */
        runPlaceGraphic: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Executant auto‑placement de gràfics (sense guardar)...");

            try {
                await FASTPASS_UI.Workflows.Assembly.runAutoPlacement(T_MP4);
                getUtils().status("Auto‑placement completat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceGraphic"); }
        },

        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9 amb fondos...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     
            const T_FONS = cfg.tracks.video.fondos;  

            try {
                const infoStr = await callJSX(`Clips.at(${T_MP4}, -1, 'video')`);
                if (!infoStr || infoStr === "null") throw new Error("Posa el cabezal sobre el clip.");
                const info = JSON.parse(infoStr);

                // Apliquem preset 16:9 (via callJSX directament per simplificar)
                await callJSX(`Clips.setProp(${T_MP4}, ${info.index}, 'ADBE Motion', 'ADBE Video Scale', 140, 'video')`);

                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${info.start}, ${info.end}, 'video')`);
                
            } catch (e) { getUtils().handleError(e, "Graph169"); }
        },

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
        }
    };

    window.FASTPASS_UI.Workflows.Retols = FASTPASS_UI.Workflows.Retols;
})();