/**
 * ============================================================================
 * LOGIC: TRACKS (Orquestación de pistas)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    FASTPASS_UI.Logic.Tracks = {
        
        /**
         * Silencia o desbloquea todas las pistas de un tipo.
         */
        setGlobalState: async function(type, action, state) {
            const utils = window.FASTPASS_UI.Utils;
            const count = parseInt(await utils.callJSX(`jsx_getTrackCount('${type}')`));
            
            for (let i = 1; i <= count; i++) {
                if (action === "mute") {
                    await utils.callJSX(`jsx_setTrackMute(${i}, ${state}, '${type}')`);
                } else if (action === "lock") {
                    await utils.callJSX(`jsx_setTrackLock(${i}, ${state}, '${type}')`);
                }
            }
            return "OK_GLOBAL_" + action.toUpperCase();
        },

        unmuteAll: function(type) { return this.setGlobalState(type || "video", "mute", false); },
        unlockAll: function(type) { return this.setGlobalState(type || "video", "lock", false); },

        /**
         * AISLAMIENTO: Muta todo excepto la pista indicada.
         */
        isolateTrack: async function(trackIdx, type) {
            const utils = window.FASTPASS_UI.Utils;
            const count = parseInt(await utils.callJSX(`jsx_getTrackCount('${type}')`));

            for (let i = 1; i <= count; i++) {
                const shouldMute = (i !== trackIdx);
                await utils.callJSX(`jsx_setTrackMute(${i}, ${shouldMute}, '${type}')`);
            }
            return "OK_ISOLATE";
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
