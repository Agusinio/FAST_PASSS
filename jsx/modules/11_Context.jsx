/* * =================================================================================
 * 11_Context.jsx (v2.4.1)
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
            // La clave es verificar app.project ANTES de tocar nada
            if (app && app.project && app.project.name) {
                var n = app.project.name;
                return File.decode(n);
            }
            return ""; // Si no hay proyecto, devolvemos string vacío, no error
        } catch(e) { 
            return ""; 
        }
    },

    /**
     * Retorna la llista de noms de tots els projectes oberts.
     */
    getOpenNames: function() {
        try {
            var res = [];
            // CORRECCIÓN: Usamos .length en lugar de .numProjects
            if (typeof app !== "undefined" && app.projects && app.projects.length > 0) {
                for (var i = 0; i < app.projects.length; i++) {
                    if (app.projects[i] && app.projects[i].name) {
                        res.push(File.decode(app.projects[i].name));
                    }
                }
            }
            return JSON.stringify(res);
        } catch(e) { 
            // Si algo falla, devolvemos un JSON de array vacío para no romper el JSON.parse del JS
            return "[]"; 
        }
    }
};