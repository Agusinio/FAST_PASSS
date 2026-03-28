/*
 * Projecte: FAST >>> PASS
 * Main Router (Version 2.6.0 - PURE LITERAL BRIDGE)
 * ============================================================================
 */

$.global.FASTPASS = $.global.FASTPASS || {};

function jsx_BOOTSTRAP(extensionRootPath) {
    var currentFile = "INICIO";
    try {
        var root = extensionRootPath.replace(/\\/g, "/");
        var load = function (name) {
            currentFile = name;
            $.writeln("📂 Carregant mòdul: " + name);
            var f = new File(root + "/jsx/modules/" + name);
            if (!f.exists) throw new Error("No existe: " + name);
            $.evalFile(f);
        };

        load("1_System.jsx");
        load("2_IO.jsx");
        load("3_Project.jsx");
        load("13_Timeline.jsx"); 
        load("5_Tracks.jsx");
        load("6_Clips.jsx");
        load("7_KF.jsx");
        load("9_Render.jsx");
        load("11_Context.jsx");
        load("12_Diagnostic.jsx");

        return "OK_BOOT";
    } catch (e) { return "ERROR_EN_ARCHIVO [" + currentFile + "] (Línea " + e.line + "): " + e.message; }
}

// ============================================================================
// --- 1. FONAMENTS (System, Context, IO) ---
// ============================================================================

$.global.System = {
    version: function() { return FASTPASS.System.version(); },
    os: function() { return FASTPASS.System.os(); },
    ready: function() { return "READY"; },
    clear: function() { return "OK"; }
};

$.global.Context = {
    list: function() { return FASTPASS.Context.getOpenNames(); },
    activeProj: function() { try { return app.project.name; } catch(e) { return ""; } },
    activeSeq: function() { try { return FASTPASS.Context.getSequenceName_FINAL(); } catch(e) { return ""; } },
    folder: function() { 
        try { 
            var proj = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkProject() : app.project;
            return proj.path ? (new File(proj.path)).parent.fsName : ""; 
        } catch (e) { return ""; } 
    },
    set: function(name) { 
        try {
            for (var i = 0; i < app.projects.length; i++) {
                if (app.projects[i].name === name) {
                    $.global.FASTPASS_WorkProject = app.projects[i];
                    return "OK";
                }
            }
            return "ERR:NOT_FOUND";
        } catch (e) { return "ERR:" + e.message; }
    }
};

$.global.IO = {
    scanDirectory: function(p) { return FASTPASS.IO.scanDirectory(p); },
    importFiles: function(p, b) { return FASTPASS.IO.importFiles(p, b); },
    lookFor: function(n) { return FASTPASS.IO.lookFor(n); },
    readTxt: function(p) { return FASTPASS.IO.readTxt(p); },
    writeTxt: function(p, c) { return FASTPASS.IO.writeTxt(p, c); },
    remove: function(p) { return FASTPASS.IO.remove(p); },
    exists: function(p) { return FASTPASS.IO.exists(p); },
    getUser: function() { return FASTPASS.IO.getUser(); }
};

// ============================================================================
// --- 2. PROJECTE (Project, Timeline) ---
// ============================================================================

$.global.Project = {
    save: function() { return FASTPASS.Project.save(); },
    saveAs: function(path) { return FASTPASS.Project.saveAs(path); },
    open: function(path) { return FASTPASS.Project.open(path); },
    items: function(bin) { return FASTPASS.Project.items(bin); },
    rename: function(n, newN) { return FASTPASS.Project.rename(n, newN); },
    move: function(n, b) { return FASTPASS.Project.move(n, b); },
    clone: function(src) { return FASTPASS.Project.clone(src); },
    openSeq: function(n) { return FASTPASS.Project.openSeq(n); },
    list: function() { return FASTPASS.Project.list() || "[]"; },
    bin: function(n) { return FASTPASS.Project.bin(n); },
    find: function(prog, bloc) { return FASTPASS.Project.byTokens(prog, bloc); },
    biggestIn: function(bin) { return FASTPASS.Project.biggestIn(bin); }
};

$.global.Timeline = {
    get: function() { return FASTPASS.Timeline.get(); },
    set: function(s) { return FASTPASS.Timeline.set(s); },
    range: function(i, o) { return FASTPASS.Timeline.range(i, o); },
    refresh: function() { return FASTPASS.Timeline.refresh(); },
    duration: function() { return FASTPASS.Timeline.duration(); },
    in: function(v) { return FASTPASS.Timeline.in(v); },
    out: function(v) { return FASTPASS.Timeline.out(v); }
};

// ============================================================================
// --- 3. EDICIÓ (Tracks, Clips) ---
// ============================================================================

$.global.Tracks = {
    count: function(type) { return FASTPASS.Tracks.count(type); },
    mute: function(idx, m, type) { return FASTPASS.Tracks.mute(idx, m, type); },
    lock: function(idx, l, type) { return FASTPASS.Tracks.lock(idx, l, type); },
    target: function(idx, t, type) { return FASTPASS.Tracks.target(idx, t, type); }
};

$.global.Clips = {
    count: function(ti, type) { return FASTPASS.Clips.count(ti, type || "video"); },
    get: function(ti, ci, type) { return FASTPASS.Clips.get(ti, ci, type || "video"); },
    at: function(ti, t, type) { return FASTPASS.Clips.at(ti, t, type || "video"); },
    remove: function(ti, ci, type) { return FASTPASS.Clips.remove(ti, ci, type || "video"); },
    insert: function(n, ti, s, e, t) { return FASTPASS.Clips.insert(n, ti, s, e, t); },
    start: function(ti, ci, v, type) { return FASTPASS.Clips.start(ti, ci, v, type || "video"); },
    end: function(ti, ci, v, type) { return FASTPASS.Clips.end(ti, ci, v, type || "video"); },
    inPoint: function(ti, ci, v, type) { return FASTPASS.Clips.inPoint(ti, ci, v, type || "video"); },
    setProp: function(ti, ci, cp, pr, v, t) { return FASTPASS.Clips.setProp(ti, ci, cp, pr, v, t || "video"); },
    getSubtitles: function() { return FASTPASS.Clips.getSubtitles(); },
    scenes: function(ti) { return FASTPASS.Clips.scenes(ti); }
};

// ============================================================================
// --- 4. EFECTES I CAPTURA (Anim, Render, Diagnostic) ---
// ============================================================================

$.global.Anim = {
    add: function(ti, ci, cp, pr, t) { return FASTPASS.Anim.add(ti, ci, cp, pr, t); },
    remove: function(ti, ci, cp, pr, t) { return FASTPASS.Anim.remove(ti, ci, cp, pr, t); },
    set: function(ti, ci, cp, pr, t, v) { return FASTPASS.Anim.set(ti, ci, cp, pr, t, v); },
    interp: function(ti, ci, cp, pr, t, i) { return FASTPASS.Anim.interp(ti, ci, cp, pr, t, i); },
    list: function(ti, ci, cp, pr) { return FASTPASS.Anim.list(ti, ci, cp, pr); },
    x: function(v, f) { return (arguments.length === 0) ? FASTPASS.Anim.x() : FASTPASS.Anim.x(v, f); },
    reframe: function(ti, ci) { return FASTPASS.Anim.reframe(ti, ci); }
};

$.global.Render = {
    frame: function(p, t) { return FASTPASS.Render.frame(p, t); },
    snapshot: function(p, t) { return FASTPASS.Render.exportFrameQE(p, t); },
    queue: function(pr, o, n) { return FASTPASS.Render.addToAME(pr, o, n); }
};

$.global.Diagnostic = {
    report: function() { return FASTPASS.Diagnostic.runFullReport(); }
};