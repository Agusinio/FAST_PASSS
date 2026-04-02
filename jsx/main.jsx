/*main.jsx
 * Projecte: FAST >>> PASS
 * Main Router (Version 2.7.0 - CATALANIZED INTERNAL BRIDGE)
 * ============================================================================
 */

$.global.FASTPASS = $.global.FASTPASS || {};

$.writeln("------- MOTOR JSX INICIADO -------");

function jsx_BOOTSTRAP(extensionRootPath) {
    var currentFile = "INICIO";
    try {
        var root = extensionRootPath.toString().replace(/\\/g, "/");
        
        var load = function (name) {
            currentFile = name;
            var f = new File(root + "/jsx/modules/" + name);
            if (!f.exists) {
                f = new File(root.replace(/^\//, "") + "/jsx/modules/" + name);
            }
            if (!f.exists) throw new Error("No existe: " + name);
            $.evalFile(f);
        };

        load("10_Sistema.jsx");
        load("12_Arxiu.jsx");
        load("20_Projecte.jsx");
        load("30_Cronologia.jsx");
        load("31_Pistes.jsx");
        load("32_Segments.jsx");
        load("33_Animacio.jsx");
        load("34_Exportacio.jsx");
        load("11_Entorn.jsx");
        load("19_Diagnosi.jsx");

        return "OK_BOOT";
    } catch (e) { 
        $.writeln("💥 CRASH en " + currentFile + ": " + e.message);
        return "ERROR_JSX -> Archivo: " + currentFile + " | Msg: " + e.message; 
    }
};

// ============================================================================
// --- 1. FONAMENTS (Sistema, Entorn, Arxiu) ---
// ============================================================================

$.global.Sistema = {
    version: function() { return (FASTPASS.Sistema) ? FASTPASS.Sistema.version() : "0.0"; },
    os: function() { return (FASTPASS.Sistema) ? FASTPASS.Sistema.os() : "win"; },
    ready: function() { return "READY"; },
    clear: function() { return (FASTPASS.Sistema) ? FASTPASS.Sistema.clear() : "OK"; }
};

$.global.Entorn = {
    list: function() { return (FASTPASS.Entorn) ? FASTPASS.Entorn.getOpenNames() : "[]"; },
    activeProj: function() { try { return app.project.name; } catch(e) { return ""; } },
    activeSeq: function() { try { return (FASTPASS.Entorn) ? FASTPASS.Entorn.getSequenceName_FINAL() : ""; } catch(e) { return ""; } },
    folder: function() { 
        try { 
            var proj = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkProject() : app.project;
            return proj.path ? (new File(proj.path)).parent.fsName : ""; 
        } catch (e) { return ""; } 
    },
    set: function(name) { 
        if (!FASTPASS.Entorn) return "ERR_NO_MODULE";
        try {
            for (var i = 0; i < app.projects.length; i++) {
                if (app.projects[i].name === name) {
                    $.global.FASTPASS_WorkProject = app.projects[i];
                    return "OK";
                }
            }
            return "ERR:NOT_FOUND";
        } catch (e) { return "ERR:" + e.message; }
    },
    findSequence: function(prog, bloc) {
        return (FASTPASS.Entorn) ? FASTPASS.Entorn.findSequenceByTokens(prog, bloc) : "ERR:NO_MODULE";
    }
};

$.global.Arxiu = {
    scanDirectory: function(p) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.scanDirectory(p) : "[]"; },
    importFiles: function(p, b) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.importFiles(p, b) : "ERR"; },
    lookFor: function(n) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.lookFor(n) : "false"; },
    readTxt: function(p) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.readTxt(p) : ""; },
    writeTxt: function(path, content) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.writeTxt(path, content) : "ERR"; },
    remove: function(p) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.remove(p) : "ERR"; },
    exists: function(p) { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.exists(p) : "false"; },
    getUser: function() { return (FASTPASS.Arxiu) ? FASTPASS.Arxiu.getUser() : "Unknown"; }
};

// ============================================================================
// --- 2. PROJECTE (Projecte, Cronologia) ---
// ============================================================================

$.global.Projecte = {
    open: function(path) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.open(path) : "ERR"; },
    path: function() { return (FASTPASS.Projecte) ? FASTPASS.Projecte.path() : ""; },
    save: function() { return (FASTPASS.Projecte) ? FASTPASS.Projecte.save() : "ERR"; },
    saveAs: function(path) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.saveAs(path) : "ERR"; },
    items: function(bin) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.items(bin) : "[]"; },
    find: function(n) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.find(n) : null; },
    rename: function(n, newN) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.rename(n, newN) : "ERR"; },
    move: function(n, b) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.move(n, b) : "ERR"; },
    moveByPath: function(p, b) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.moveByPath(p, b) : "ERR"; },
    bin: function(n) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.bin(n) : "root"; },
    cloneSeq: function(n) { return (FASTPASS.Projecte) ? FASTPASS.Projecte.cloneSeq(n) : "ERR"; }
};

$.global.Cronologia = {
    get: function() { return (FASTPASS.Cronologia) ? FASTPASS.Cronologia.get() : 0; },
    set: function(s) { return (FASTPASS.Cronologia) ? FASTPASS.Cronologia.set(s) : "ERR"; },
    range: function(i, o) { return (FASTPASS.Cronologia) ? FASTPASS.Cronologia.range(i, o) : "ERR"; },
    refresh: function() { return (FASTPASS.Cronologia) ? FASTPASS.Cronologia.refresh() : "ERR"; },
    duration: function() { return (FASTPASS.Cronologia) ? FASTPASS.Cronologia.duration() : 0; }
};

// ============================================================================
// --- 3. EDICIÓ (Pistes, Segments, Animacio) ---
// ============================================================================

$.global.Pistes = {
    count: function(t) { return (FASTPASS.Pistes) ? FASTPASS.Pistes.count(t) : 0; },
    mute: function(i, s, t) { return (FASTPASS.Pistes) ? FASTPASS.Pistes.mute(i, s, t) : "ERR"; },
    lock: function(i, s, t) { return (FASTPASS.Pistes) ? FASTPASS.Pistes.lock(i, s, t) : "ERR"; },
    target: function(i, s, t) { return (FASTPASS.Pistes) ? FASTPASS.Pistes.target(i, s, t) : "ERR"; }
};

$.global.Segments = {
    get: function(t, i, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.get(t, i, ty) : "null"; },
    at: function(t, ti, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.at(t, ti, ty) : "null"; },
    remove: function(t, i, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.remove(t, i, ty) : "ERR"; },
    insert: function(n, t, s, e, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.insert(n, t, s, e, ty) : "ERR"; },
    inPoint: function(t, i, v, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.inPoint(t, i, v, ty) : "ERR"; },
    outPoint: function(t, i, v, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.outPoint(t, i, v, ty) : "ERR"; },
    start: function(t, i, v, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.start(t, i, v, ty) : "ERR"; },
    end: function(t, i, v, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.end(t, i, v, ty) : "ERR"; },
    setProp: function(t, i, cm, pm, v, ty) { return (FASTPASS.Segments) ? FASTPASS.Segments.setProp(t, i, cm, pm, v, ty) : "ERR"; }
};

$.global.Animacio = {
    add: function(ti, ci, cm, pm, t) { return (FASTPASS.Animacio) ? FASTPASS.Animacio.add(ti, ci, cm, pm, t) : "ERR"; },
    set: function(ti, ci, cm, pm, t, v) { return (FASTPASS.Animacio) ? FASTPASS.Animacio.set(ti, ci, cm, pm, t, v) : "ERR"; },
    x: function(v, f) { return (FASTPASS.Animacio) ? FASTPASS.Animacio.x(v, f) : 0.5; }
};

$.global.Exportacio = {
    frame: function(p, t) { return (FASTPASS.Exportacio) ? FASTPASS.Exportacio.frame(p, t) : "ERR"; },
    addToAME: function(pr, o, fn) { return (FASTPASS.Exportacio) ? FASTPASS.Exportacio.addToAME(pr, o, fn) : "ERR"; }
};