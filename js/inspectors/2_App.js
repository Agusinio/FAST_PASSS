/**
 * ============================================================================
 * INSPECTOR: 2_App (Report Intern de Premiere)
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Inspectors = FASTPASS_UI.Inspectors || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Inspectors.App = {
        
        async getOpenProjects() {
            const raw = await utils.callJSX("jsx_getOpenProjectsNames()");
            return JSON.parse(raw || "[]");
        },

        async getActiveProjectName() {
            return await utils.callJSX("jsx_getActiveProjectName()");
        },

        async checkProjectAvailability(projectPath) {
            const lockFile = projectPath + ".lock";
            const stat = window.cep.fs.stat(lockFile);
            return { isLocked: (stat.err === 0), path: projectPath };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
