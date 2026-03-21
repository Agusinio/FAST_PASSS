/**
 * ============================================================================
 * INSPECTOR: 3_Session (Contingut Projecte Actiu)
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Inspectors = FASTPASS_UI.Inspectors || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Inspectors.Session = {
        
        async getBinContent(binName) {
            const raw = await utils.callJSX(`jsx_listItems('${utils.escape(binName)}')`);
            return JSON.parse(raw || "[]");
        },

        async getSequences() {
            const raw = await utils.callJSX("jsx_getSequences()");
            return JSON.parse(raw || "[]");
        },

        async getClipAtCTI(trackIdx, type) {
            const raw = await utils.callJSX(`jsx_getClipDataByTime(${trackIdx}, -1, '${type || "video"}')`);
            return JSON.parse(raw || "null");
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
