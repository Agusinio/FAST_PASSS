/**
 * ============================================================================
 * 20_Sessio.js (Contingut del Projecte Actiu)
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Inspectors = FASTPASS_UI.Inspectors || {};

    const Eines = {
        callJSX: (s) => window.FASTPASS_UI.Eines.callJSX(s),
        log: (m) => window.FASTPASS_UI.Eines.log(m, "DEBUG"),
        escape: (s) => window.FASTPASS_UI.Eines.escape(s)
    };

    FASTPASS_UI.Inspectors.Session = {
        
        async getBinContent(binName) {
            const raw = await Eines.callJSX(`Projecte.items('${Eines.escape(binName)}')`);
            return JSON.parse(raw || "[]");
        },

        async getSequences() {
            const raw = await Eines.callJSX("Projecte.list()");
            return JSON.parse(raw || "[]");
        },

        async getClipAtCTI(trackIdx, type) {
            // Seguint la convenció literal: Clips.at(track, time)
            // Posem -1 per a que el JSX use el playerPosition actual
            const raw = await Eines.callJSX(`Segments.at(${trackIdx}, -1, '${type || "video"}')`);
            return JSON.parse(raw || "null");
        },

        async getActiveSequenceName() {
            return await Eines.callJSX("Entorn.activeSeq()");
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
