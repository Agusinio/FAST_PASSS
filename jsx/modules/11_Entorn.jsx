/**
 * =================================================================================
 * 11_Context.jsx
 * Módulo especializado en la obtención de datos del entorno de Premiere.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

// Inicializamos el objeto Context dentro de FASTPASS
FASTPASS.Context = {
    getActiveName: function() {
        try {
            if (app && app.project && app.project.name) {
                return File.decode(app.project.name);
            }
            return "";
        } catch(e) { return ""; }
    },

    getOpenNames: function() {
        try {
            var res = [];
            if (typeof app !== "undefined" && app.projects && app.projects.length > 0) {
                for (var i = 0; i < app.projects.length; i++) {
                    if (app.projects[i] && app.projects[i].name) {
                        res.push(File.decode(app.projects[i].name));
                    }
                }
            }
            return JSON.stringify(res);
        } catch(e) { return "[]"; }
    },

    jsx_getProjectItems: function() {
        try {
            if (!app.project) return "[]";
            var items = [];
            var root = app.project.rootItem;
            
            for (var i = 0; i < root.children.numItems; i++) {
                var item = root.children[i];
                var obj = {
                    name: item.name,
                    type: item.type, // 1 = CLIP, 2 = BIN
                    children: []
                };
                
                if (item.type === 2) { // Si és carpeta, llistem fills
                    for (var j = 0; j < item.children.numItems; j++) {
                        obj.children.push(item.children[j].name);
                    }
                }
                items.push(obj);
            }
            return JSON.stringify(items);
        } catch(e) { return "[]"; }
    },


    findSequenceByTokens: function(tokenProg, tokenBloc) {
        try {
            if (!app.project) return "ERR:NO_PROJECT";
            var num = app.project.sequences.numSequences;
            for (var i = 0; i < num; i++) {
                var s = app.project.sequences[i];
                if (s && s.name.indexOf(tokenProg) !== -1 && s.name.indexOf(tokenBloc) !== -1) {
                    return String(s.name);
                }
            }
            return "ERR:NOT_FOUND";
        } catch(e) { return "ERR:" + e.message; }
    },

    getSequenceName_FINAL: function() {
        try {
            if (!app.project) return "ERROR:NO_PROJECT";
            
            var seq = app.project.activeSequence;
            
            // Fallback: Si no hi ha focus al Timeline, mirem si n'hi ha alguna oberta
            if (!seq && app.project.sequences.numSequences > 0) {
                seq = app.project.sequences[0];
            }
            
            if (!seq) return "ERROR:NO_SEQUENCE";
            
            return String(seq.name); 
        } catch(e) { 
            return "ERROR_JSX:" + e.message; 
        }
    },

    scanOpenProjects: function() {
        try {
            var result = [];
            if (typeof app === "undefined" || !app.projects) return "[]";
            for (var i = 0; i < app.projects.length; i++) {
                var proj = app.projects[i];
                if (!proj) continue;
                var seqName = "";
                try {
                    if (proj.activeSequence) seqName = proj.activeSequence.name;
                    else if (proj.sequences && proj.sequences.numSequences > 0) seqName = proj.sequences[0].name;
                } catch(se) { /* no seq */ }
                result.push({ name: String(proj.name), sequenceName: seqName });
            }
            return JSON.stringify(result);
        } catch(e) { return "[]"; }
    },

    getWorkSequence: function() {
        try {
            var proj = ($.global.FASTPASS_WorkProject instanceof Project)
                ? $.global.FASTPASS_WorkProject
                : app.project;
            if (!proj) return null;
            return proj.activeSequence || (proj.sequences.numSequences > 0 ? proj.sequences[0] : null);
        } catch(e) { return null; }
    },

    /**
     * Retorna l'objecte projecte ancorat (o l'actiu per defecte).
     */
    getWorkProject: function() {
        try {
            return ($.global.FASTPASS_WorkProject instanceof Project)
                ? $.global.FASTPASS_WorkProject
                : app.project;
        } catch(e) { return app.project; }
    }
};

var Context = FASTPASS.Context;