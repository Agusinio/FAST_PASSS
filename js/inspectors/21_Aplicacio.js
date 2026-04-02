/**
 * ============================================================================
 * 21_Aplicacio.js (Report Intern d'Estat de Premiere)
 * ============================================================================
 */
(function() {
    // Aseguramos la existencia de la ruta del namespace
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    window.FASTPASS_UI.Inspectors = window.FASTPASS_UI.Inspectors || {};

    // Definimos el objeto directamente en el window para evitar pérdidas
    window.FASTPASS_UI.Inspectors.App = {
        
        async getOpenProjects() {
            try {
                const raw = await window.FASTPASS_UI.Utils.callJSX("Entorn.list()");
                if (!raw || raw.startsWith("ERR") || raw.startsWith("Eval")) return [];
                return JSON.parse(raw);
            } catch (e) { return []; }
        },

        async getActiveProjectName() {
            try {
                const name = await window.FASTPASS_UI.Utils.callJSX("Entorn.activeProj()");
                if (!name || name.startsWith("ERR") || name.startsWith("Eval")) return "";
                return name;
            } catch (e) { return ""; }
        },

        async checkProjectAvailability(projectPath) {
            try {
                const lockFile = projectPath + ".lock";
                const stat = window.cep.fs.stat(lockFile);
                return { isLocked: (stat.err === 0), path: projectPath };
            } catch (e) { return { isLocked: false }; }
        }
    };
    
    console.log("✅ Inspector App cargado y funciones definidas.");
})();