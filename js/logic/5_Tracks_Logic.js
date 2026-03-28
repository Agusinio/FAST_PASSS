/**
 * ============================================================================
 * LOGIC: TRACKS (Orquestació de pistes)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Tracks = {
        
        /**
         * all: Aplica un estat (mute, lock) a totes les pistes d'un tipus.
         */
        all: async function(type, action, state) {
            const count = parseInt(await utils.callJSX(`Tracks.count('${type}')`));
            
            for (let i = 1; i <= count; i++) {
                if (action === "mute") {
                    await utils.callJSX(`Tracks.mute(${i}, ${state}, '${type}')`);
                } else if (action === "lock") {
                    await utils.callJSX(`Tracks.lock(${i}, ${state}, '${type}')`);
                }
            }
            return "OK_GLOBAL_" + action.toUpperCase();
        },

        unmuteAll: function(type) { return this.all(type || "video", "mute", false); },
        unlockAll: function(type) { return this.all(type || "video", "lock", false); },

        /**
         * isolate: Muta tota la resta excepte la pista indicada.
         */
        isolate: async function(trackIdx, type) {
            const count = parseInt(await utils.callJSX(`Tracks.count('${type}')`));

            for (let i = 1; i <= count; i++) {
                const shouldMute = (i !== trackIdx);
                await utils.callJSX(`Tracks.mute(${i}, ${shouldMute}, '${type}')`);
            }
            return "OK_ISOLATE";
        }
    };

    // Alias global literal
    window.Tracks = FASTPASS_UI.Logic.Tracks;

    window.FASTPASS_UI = FASTPASS_UI;
})();
