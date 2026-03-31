/*
 * Projecte: FAST >>> PASS
 * Main Router (Version 2.6.0 - PURE LITERAL BRIDGE)
 * ============================================================================
 */

$.global.FASTPASS = $.global.FASTPASS || {};

$.writeln("------- MOTOR JSX INICIADO -------");

function jsx_BOOTSTRAP(extensionRootPath) {
    var currentFile = "INICIO";
    try {
        // Limpieza extra de la ruta recibida
        var root = extensionRootPath.toString().replace(/\\/g, "/");
        
        var load = function (name) {
            //$.writeln("📦 Intentando cargar: " + name);
            currentFile = name;
            var f = new File(root + "/jsx/modules/" + name);
            if (!f.exists) {
                //$.writeln("❌ ERROR: No existe " + f.fsName);
                // Si no lo encuentra, intentamos sin la barra inicial por si acaso
                f = new File(root.replace(/^\//, "") + "/jsx/modules/" + name);
            }
            if (!f.exists) throw new Error("No existe: " + name + " en la ruta " + root);
            $.evalFile(f);
            //$.writeln("✅ " + name + " cargado OK.");
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
    } catch (e) { 
        $.writeln("💥 CRASH en " + currentFile + ": " + e.message);
        return "ERROR_JSX -> Archivo: " + currentFile + " | Msg: " + e.message + " | Linea: " + e.line; }
};

// ============================================================================
// --- 1. FONAMENTS (System, Context, IO) ---
// ============================================================================

$.global.System = {
    version: function() { return (FASTPASS.System) ? FASTPASS.System.version() : "0.0"; },
    os: function() { return (FASTPASS.System) ? FASTPASS.System.os() : "win"; },
    ready: function() { return "READY"; },
    clear: function() { return (FASTPASS.System) ? FASTPASS.System.clear() : "OK"; }
};

$.global.Context = {
    list: function() { return ($.global.FASTPASS.Context) ? FASTPASS.Context.getOpenNames() : "[]"; },
    activeProj: function() { try { return app.project.name; } catch(e) { return ""; } },
    activeSeq: function() { try { return ($.global.FASTPASS.Context) ? FASTPASS.Context.getSequenceName_FINAL() : ""; } catch(e) { return ""; } },
    folder: function() { 
        try { 
            var proj = ($.global.FASTPASS.Context) ? FASTPASS.Context.getWorkProject() : app.project;
            return proj.path ? (new File(proj.path)).parent.fsName : ""; 
        } catch (e) { return ""; } 
    },
    set: function(name) { 
        if (!$.global.FASTPASS.Context) return "ERR_NO_MODULE";
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
    scanDirectory: function(p) { 
        return ($.global.FASTPASS.IO) ? FASTPASS.IO.scanDirectory(p) : "[]"; 
    },
    importFiles: function(p, b) { 
        return ($.global.FASTPASS.IO) ? FASTPASS.IO.importFiles(p, b) : "ERR_MODULE_NOT_LOADED"; 
    },
    lookFor: function(n) { 
        return ($.global.FASTPASS.IO) ? FASTPASS.IO.lookFor(n) : "false"; 
    },
    readTxt: function(p) { 
        return ($.global.FASTPASS.IO) ? FASTPASS.IO.readTxt(p) : ""; 
    },
    writeTxt: function(path, content) { 
        if (!$.global.FASTPASS.IO) return "ERR_NO_IO_MODULE";
        
        // 📍 BLINDAJE 2: Si el path llega como undefined aquí, lo sabremos
        if (typeof path === "undefined" || path === "undefined") {
            return "ERR:path is undefined en el puente";
        }
        
        return FASTPASS.IO.writeTxt(path, content); 
    },
    remove: function(p) { 
        return ($.global.FASTPASS.IO) ? FASTPASS.IO.remove(p) : "ERR_NOT_EXISTS"; 
    },
    exists: function(p) { 
        // Importante: devolvemos string "true"/"false" para que el JS lo entienda bien
        if (!$.global.FASTPASS.IO) return "false";
        return FASTPASS.IO.exists(p) ? "true" : "false";
    },
    getUser: function() { 
        return ($.global.FASTPASS.IO) ? FASTPASS.IO.getUser() : "UnknownUser"; 
    }
};
// ============================================================================
// --- 2. PROJECTE (Project, Timeline) ---
// ============================================================================

$.global.Project = {
    save: function() { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.save() : "ERR_MODULE_NOT_LOADED"; 
    },
    saveAs: function(path) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.saveAs(path) : "ERR_MODULE_NOT_LOADED"; 
    },
    open: function(path) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.open(path) : "ERR_MODULE_NOT_LOADED"; 
    },
    items: function(bin) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.items(bin) : "[]"; 
    },
    rename: function(n, newN) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.rename(n, newN) : "ERR"; 
    },
    move: function(n, b) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.move(n, b) : "ERR"; 
    },
    cloneSeq: function(src) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.cloneSeq(src) : "ERR"; 
    },
    openSeq: function(n) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.openSeq(n) : "ERR"; 
    },
    list: function() { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.list() : "[]"; 
    },
    bin: function(n) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.bin(n) : null; 
    },
    find: function(prog, bloc) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.byTokens(prog, bloc) : "[]"; 
    },
    biggestIn: function(bin) { 
        return ($.global.FASTPASS.Project) ? FASTPASS.Project.biggestIn(bin) : null; 
    }
};

$.global.Timeline = {
    get: function() { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.get() : null; 
    },
    set: function(s) { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.set(s) : "ERR_MODULE_NOT_LOADED"; 
    },
    range: function(i, o) { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.range(i, o) : "ERR_MODULE_NOT_LOADED"; 
    },
    refresh: function() { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.refresh() : "OK"; 
    },
    duration: function() { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.duration() : 0; 
    },
    "in": function(v) { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.inPoint(v) : "ERR"; 
    },
    "out": function(v) { 
        return ($.global.FASTPASS.Timeline) ? FASTPASS.Timeline.outpoint(v) : "ERR"; 
    }
};

// ============================================================================
// --- 3. EDICIÓ (Tracks, Clips) ---
// ============================================================================

$.global.Tracks = {
    count: function(type) { 
        return ($.global.FASTPASS.Tracks) ? FASTPASS.Tracks.count(type) : 0; 
    },
    mute: function(idx, m, type) { 
        return ($.global.FASTPASS.Tracks) ? FASTPASS.Tracks.mute(idx, m, type) : "ERR"; 
    },
    lock: function(idx, l, type) { 
        return ($.global.FASTPASS.Tracks) ? FASTPASS.Tracks.lock(idx, l, type) : "ERR"; 
    },
    target: function(idx, t, type) { 
        return ($.global.FASTPASS.Tracks) ? FASTPASS.Tracks.target(idx, t, type) : "ERR"; 
    }
};

$.global.Clips = {
    count: function(ti, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.count(ti, type || "video") : 0; 
    },
    get: function(ti, ci, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.get(ti, ci, type || "video") : null; 
    },
    at: function(ti, t, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.at(ti, t, type || "video") : null; 
    },
    remove: function(ti, ci, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.remove(ti, ci, type || "video") : "ERR"; 
    },
    insert: function(n, ti, s, e, t) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.insert(n, ti, s, e, t) : "ERR_NO_CLIPS_MODULE"; 
    },
    start: function(ti, ci, v, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.start(ti, ci, v, type || "video") : "ERR"; 
    },
    end: function(ti, ci, v, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.end(ti, ci, v, type || "video") : "ERR"; 
    },
    inPoint: function(ti, ci, v, type) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.inPoint(ti, ci, v, type || "video") : "ERR"; 
    },
    setProp: function(ti, ci, cp, pr, v, t) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.setProp(ti, ci, cp, pr, v, t || "video") : "ERR"; 
    },
    getSubtitles: function() { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.getSubtitles() : "[]"; 
    },
    scenes: function(ti) { 
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.scenes(ti) : "[]"; 
    }
};

// ============================================================================
// --- 4. EFECTES I CAPTURA (Anim, Render, Diagnostic) ---
// ============================================================================

$.global.Anim = {
    add: function(ti, ci, cp, pr, t) { 
        return ($.global.FASTPASS.Anim) ? FASTPASS.Anim.add(ti, ci, cp, pr, t) : "ERR"; 
    },
    remove: function(ti, ci, cp, pr, t) { 
        return ($.global.FASTPASS.Anim) ? FASTPASS.Anim.remove(ti, ci, cp, pr, t) : "ERR"; 
    },
    set: function(ti, ci, cp, pr, t, v) { 
        return ($.global.FASTPASS.Anim) ? FASTPASS.Anim.set(ti, ci, cp, pr, t, v) : "ERR"; 
    },
    interp: function(ti, ci, cp, pr, t, i) { 
        return ($.global.FASTPASS.Anim) ? FASTPASS.Anim.interp(ti, ci, cp, pr, t, i) : "ERR"; 
    },
    list: function(ti, ci, cp, pr) { 
        return ($.global.FASTPASS.Anim) ? FASTPASS.Anim.list(ti, ci, cp, pr) : "[]"; 
    },
    x: function(v, f) { 
        if (!$.global.FASTPASS.Anim) return "0";
        return (arguments.length === 0) ? FASTPASS.Anim.x() : FASTPASS.Anim.x(v, f); 
    },
    reframe: function(ti, ci) { 
        return ($.global.FASTPASS.Anim) ? FASTPASS.Anim.reframe(ti, ci) : "ERR"; 
    }
};

$.global.Render = {
    frame: function(p, t) { 
        return ($.global.FASTPASS.Render) ? FASTPASS.Render.frame(p, t) : "ERR"; 
    },
    snapshot: function(p, t) { 
        return ($.global.FASTPASS.Render) ? FASTPASS.Render.exportFrameQE(p, t) : "ERR"; 
    },
    queue: function(pr, o, n) { 
        return ($.global.FASTPASS.Render) ? FASTPASS.Render.addToAME(pr, o, n) : "ERR"; 
    }
};

$.global.Diagnostic = {
    report: function() { 
        return ($.global.FASTPASS.Diagnostic) ? FASTPASS.Diagnostic.runFullReport() : "ERR_NO_MODULE"; 
    }
};