/**
 * =================================================================================
 * 11_Entorn.jsx
 * Módulo especializado en la obtención de datos del entorno de Premiere.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

// Inicializamos el objeto Entorn dentro de FASTPASS
FASTPASS.Entorn = {
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

    getSequenceName: function() {
        $.writeln("🔍 [JSX:Entorn] Iniciant getSequenceName...");
        try {
            if (typeof app === "undefined") { $.writeln("❌ [JSX:Entorn] app es UNDEFINED"); return "ERR:APP_NULL"; }
            if (!app.project) { $.writeln("❌ [JSX:Entorn] app.project es NULL"); return "ERR:PROJECT_NULL"; }

            var seq = app.project.activeSequence;
            
            if (!seq) {
                $.writeln("⚠️ [JSX:Entorn] activeSequence es NULL. Provant fallback...");
                if (app.project.sequences && app.project.sequences.numSequences > 0) {
                    var fallbackName = app.project.sequences[0].name;
                    $.writeln("✅ [JSX:Entorn] Fallback a seq[0]: " + fallbackName);
                    return String(fallbackName);
                }
                $.writeln("❌ [JSX:Entorn] No hi ha cap seqüència al projecte.");
                return "ERR:NO_SEQUENCES";
            }

            $.writeln("✅ [JSX:Entorn] Seqüència detectada: " + seq.name);
            return String(seq.name);
        } catch(e) {
            $.writeln("💥 [JSX:Entorn] CRASH: " + e.message);
            return "ERR_EXCEPTION:" + e.message;
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
            var proj = ($.global.FASTPASS_WorkProject instanceof Projecte)
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
            return ($.global.FASTPASS_WorkProject instanceof Projecte)
                ? $.global.FASTPASS_WorkProject
                : app.project;
        } catch(e) { return app.project; }
    }
};

var Entorn = FASTPASS.Entorn;