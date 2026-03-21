/* * =================================================================================
 * 11_Context.jsx
 * Módulo especializado en la obtención de datos del entorno de Premiere.
 * (v12 - VERSIÓN ULTRA-ATÓMICA: SIN BÚSQUEDA EN DISCO)
 * =================================================================================
 */

var FASTPASS = FASTPASS || {};
FASTPASS.Context = {

    /**
     * Retorna el nom del projecte actiu.
     */
    getActiveName: function() {
        try {
            if (!app.project || !app.project.name) return "";
            return File.decode(app.project.name);
        } catch(e) { return ""; }
    },

    /**
     * Retorna la llista de noms de tots els projectes oberts.
     */
    getOpenNames: function() {
        try {
            var res = [];
            if (app.projects && app.projects.numProjects > 0) {
                for (var i = 0; i < app.projects.numProjects; i++) {
                    res.push(File.decode(app.projects[i].name));
                }
            }
            return JSON.stringify(res);
        } catch(e) { return "[]"; }
    }
};