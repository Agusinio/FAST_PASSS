/**
 * ============================================================================
 * 31_Pistes.js (Orquestració de Pistes)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const Eines = {
        callJSX: (s) => window.FASTPASS_UI.Eines.callJSX(s),
        log: (m) => window.FASTPASS_UI.Eines.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Pistes = {
        
        /**
         * all: Aplica un estat (mute, lock) a totes les pistes d'un tipus.
         */
        all: async function(type, action, state) {
            const count = parseInt(await Eines.callJSX(`Pistes.count('${type}')`));
            
            for (let i = 1; i <= count; i++) {
                if (action === "mute") {
                    await Eines.callJSX(`Pistes.mute(${i}, ${state}, '${type}')`);
                } else if (action === "lock") {
                    await Eines.callJSX(`Pistes.lock(${i}, ${state}, '${type}')`);
                }
            }
            return "OK_GLOBAL_" + action.toUpperCase();
        },

        /**
         * setGlobalState: Alias semántic de all() per a la crida des dels workflows.
         * @param {string} type - "video" | "audio"
         * @param {string} action - "mute" | "lock"
         * @param {boolean} state - true = activar, false = desactivar
         */
        setGlobalState: async function(type, action, state) {
            return this.all(type, action, state);
        },

        unmuteAll: function(type) { return this.all(type || "video", "mute", false); },
        unlockAll: function(type) { return this.all(type || "video", "lock", false); },

        /**
         * isolate: Muta tota la resta excepte la pista indicada.
         */
        isolate: async function(trackIdx, type) {
            const count = parseInt(await Eines.callJSX(`Pistes.count('${type}')`));

            for (let i = 1; i <= count; i++) {
                const shouldMute = (i !== trackIdx);
                await Eines.callJSX(`Pistes.mute(${i}, ${shouldMute}, '${type}')`);
            }
            return "OK_ISOLATE";
        },

        /**
         * clips: Obté tots els clips d'una pista.
         */
        clips: async function (trackIdx, type = "video") {
            const countStr = await Eines.callJSX(`Segments.count(${trackIdx}, '${type}')`);
            const count = parseInt(countStr || 0);
            const clips = [];
            
            for (let i = 0; i < count; i++) {
                const dataRaw = await Eines.callJSX(`Segments.get(${trackIdx}, ${i}, '${type}')`);
                if (dataRaw && dataRaw !== "null") {
                    const c = JSON.parse(dataRaw);
                    c.index = i;
                    clips.push(c);
                }
            }
            return clips;
        }
    };

    // Alias global literal
    window.Pistes = FASTPASS_UI.Logic.Pistes;

    window.FASTPASS_UI = FASTPASS_UI;
})();
