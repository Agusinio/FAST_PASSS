/**
 * ============================================================================
 * INSPECTOR: 3_Session (Contingut Projecte Actiu) - v2.6.0 literal
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Inspectors = FASTPASS_UI.Inspectors || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG"),
        escape: (s) => window.FASTPASS_UI.Utils.escape(s)
    };

    FASTPASS_UI.Inspectors.Session = {
        
        async getBinContent(binName) {
            const raw = await utils.callJSX(`Project.items('${utils.escape(binName)}')`);
            return JSON.parse(raw || "[]");
        },

        async getSequences() {
            const raw = await utils.callJSX("Project.list()");
            return JSON.parse(raw || "[]");
        },

        async getClipAtCTI(trackIdx, type) {
            // Seguint la convenció literal: Clips.at(track, time)
            // Posem -1 per a que el JSX use el playerPosition actual
            const raw = await utils.callJSX(`Clips.at(${trackIdx}, -1, '${type || "video"}')`);
            return JSON.parse(raw || "null");
        },

        async getActiveSequenceName() {
            return await utils.callJSX("Context.activeSeq()");
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
