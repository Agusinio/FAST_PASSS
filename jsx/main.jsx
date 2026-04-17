/*main.jsx
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
            $.writeln("📦 Intentando cargar: " + name);
            currentFile = name;
            var f = new File(root + "/jsx/modules/" + name);
            if (!f.exists) {
                $.writeln("❌ ERROR: No existe " + f.fsName);
                // Si no lo encuentra, intentamos sin la barra inicial por si acaso
                f = new File(root.replace(/^\//, "") + "/jsx/modules/" + name);
            }
            if (!f.exists) throw new Error("No existe: " + name + " en la ruta " + root);
            $.evalFile(f);
            $.writeln("✅ " + name + " cargado OK.");
        };

        load("1_System.jsx");
        load("2_IO.jsx");
        load("3_Project.jsx");
        $.writeln("   -> FASTPASS.Project definido? " + ($.global.FASTPASS && $.global.FASTPASS.Project ? "SÍ" : "NO"));
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
    activeSeq: function() { try { return ($.global.FASTPASS.Context) ? FASTPASS.Context.getSequenceName() : ""; } catch(e) { return ""; } },
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
                    // Intentar cambiar el proyecto activo en Premiere
                    app.project = app.projects[i];
                    return "OK";
                }
            }
            return "ERR:NOT_FOUND";
        } catch (e) { return "ERR:" + e.message; }
    },
    findSequence: function(prog, bloc) {
        // Esta en concreto dijimos de usar la de Context, que es la especialista
        return ($.global.FASTPASS && $.global.FASTPASS.Context) 
            ? $.global.FASTPASS.Context.findSequenceByTokens(prog, bloc) 
            : "ERR:CONTEXT_NOT_FOUND";
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
    getLogic: function() {
        var mod = $.global.FASTPASS.Project;
        if (!mod) {
            $.writeln("❌ [JSX-DIAG] FASTPASS.Project no está definido.");
        } else {
            $.writeln("✅ [JSX-DIAG] FASTPASS.Project encontrado, typeof mod.open: " + typeof mod.open);
            if (!mod.open) {
                var keys = [];
                for (var k in mod) keys.push(k);
                $.writeln("❌ [JSX-DIAG] FASTPASS.Project.open no es una función. Keys: " + keys.join(','));
            }
        }
        return mod;
    },
  
    _isReady: function() {
        return ($.global.FASTPASS && $.global.FASTPASS.Project);
    },

    open: function(path) {
        var m = this.getLogic();
        if (!m) {
            $.writeln("❌ [JSX-DIAG] Project.open: módulo no encontrado.");
            return "ERR:MODULE_NOT_FOUND";
        }
        if (typeof m.open !== "function") {
            $.writeln("❌ [JSX-DIAG] Project.open: m.open no es función, tipo: " + typeof m.open);
            return "ERR:OPEN_NOT_FUNCTION";
        }
        $.writeln("✅ [JSX-DIAG] Project.open llamando con path: " + path);
        return m.open(path);
    },
    
    saveAs: function(path) {
        var m = this.getLogic();
        if (!m) {
            $.writeln("❌ [JSX-DIAG] Project.saveAs: módulo no encontrado.");
            return "ERR:MODULE_NOT_FOUND";
        }
        if (typeof m.saveAs !== "function") {
            $.writeln("❌ [JSX-DIAG] Project.saveAs: m.saveAs no es función, tipo: " + typeof m.saveAs);
            return "ERR:SAVEAS_NOT_FUNCTION";
        }
        $.writeln("✅ [JSX-DIAG] Project.saveAs llamando con path: " + path);
        return m.saveAs(path);
    },

    save: function() {
        var m = this.getLogic(); return m ? m.save() : "ERR:MODULE_NOT_FOUND";
    },

    path: function() {
        $.writeln("[JSX-DIAG] Project.path llamado");
        var m = this.getLogic();
        if (!m) {
            $.writeln("[JSX-DIAG] Project.path: módulo no encontrado");
            return "";
        }
        if (typeof m.path !== "function") {
            $.writeln("[JSX-DIAG] Project.path: m.path no es función, tipo: " + typeof m.path);
            return "";
        }
        var result = m.path();
        $.writeln("[JSX-DIAG] Project.path resultado: " + result);
        return result;
    },

    bin: function(name) {
        var m = this.getLogic();
        if (!m) {
            $.writeln("❌ [JSX-DIAG] Project.bin: módulo no encontrado.");
            return "ERR:MODULE_NOT_FOUND";
        }
        if (typeof m.bin !== "function") {
            $.writeln("❌ [JSX-DIAG] Project.bin: m.bin no es función, tipo: " + typeof m.bin);
            return "ERR:BIN_NOT_FUNCTION";
        }
        $.writeln("✅ [JSX-DIAG] Project.bin llamando con name: " + name);
        return m.bin(name);
    },

    move: function(item, targetBin) {
        var m = this.getLogic();
        if (!m) {
            $.writeln("❌ [JSX-DIAG] Project.move: módulo no encontrado.");
            return "ERR:MODULE_NOT_FOUND";
        }
        if (typeof m.move !== "function") {
            $.writeln("❌ [JSX-DIAG] Project.move: m.move no es función, tipo: " + typeof m.move);
            return "ERR:MOVE_NOT_FUNCTION";
        }
        $.writeln("✅ [JSX-DIAG] Project.move llamando con item: " + item + ", targetBin: " + targetBin);
        return m.move(item, targetBin);
    },
    
    moveByID: function(id, targetBin) {
        var m = this.getLogic();
        if (!m) {
            $.writeln("❌ [JSX-DIAG] Project.moveByID: módulo no encontrado.");
            return "ERR:MODULE_NOT_FOUND";
        }
        if (typeof m.moveByID !== "function") {
            $.writeln("❌ [JSX-DIAG] Project.moveByID: m.moveByID no es función, tipo: " + typeof m.moveByID);
            return "ERR:MOVEBYID_NOT_FUNCTION";
        }
        $.writeln("✅ [JSX-DIAG] Project.moveByID llamando con id: " + id + ", targetBin: " + targetBin);
        return m.moveByID(id, targetBin);
    },

    rename: function(oldName, newName) { 
        var m = this.getLogic(); return m ? m.rename(oldName, newName) : "ERR:MODULE_NOT_FOUND"; 
    },

    cloneSeq: function(name) {
        var m = this.getLogic();
        if (!m) {
            $.writeln("❌ [JSX-DIAG] Project.cloneSeq: módulo no encontrado.");
            return "ERR:MODULE_NOT_FOUND";
        }
        if (typeof m.cloneSeq !== "function") {
            $.writeln("❌ [JSX-DIAG] Project.cloneSeq: m.cloneSeq no es función, tipo: " + typeof m.cloneSeq);
            return "ERR:CLONESEQ_NOT_FUNCTION";
        }
        $.writeln("✅ [JSX-DIAG] Project.cloneSeq llamando con name: " + name);
        return m.cloneSeq(name);
    },

    findItemByID: function(id) {
        var m = this.getLogic();
        return (m) ? m.findItemByID(id) : null;
    },

    items: function(bin) { 
        return (this._isReady()) ? FASTPASS.Project.items(bin) : "[]"; 
    },

    openSeq: function(n) { 
        return (this._isReady()) ? FASTPASS.Project.openSeq(n) : "ERR_MODULE_NOT_LOADED"; 
    },

    list: function() { 
        return (this._isReady()) ? FASTPASS.Project.list() : "[]"; 
    },

    find: function(nameEncoded) { 
        return (this._isReady()) ? FASTPASS.Project.find(nameEncoded) : null; 
    },

    biggestIn: function(bin) { 
        return (this._isReady()) ? FASTPASS.Project.biggestIn(bin) : null; 
    }
};

// DIAGNÓSTICO DE CARGA
$.writeln("✅ [JSX-DIAG] Módulos cargados:");
$.writeln("   - FASTPASS.Project: " + ($.global.FASTPASS.Project ? "DEFINIDO" : "NO DEFINIDO"));
if ($.global.FASTPASS.Project) {
    $.writeln("   - FASTPASS.Project.open: " + (typeof $.global.FASTPASS.Project.open));
}
$.writeln("   - $.global.Project: " + ($.global.Project ? "DEFINIDO" : "NO DEFINIDO"));
if ($.global.Project) {
    $.writeln("   - $.global.Project.open: " + (typeof $.global.Project.open));
}
$.writeln("===============================");
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
    endAt: function(ti, startSec, newEndSec, type) {
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.endAt(ti, startSec, newEndSec, type || "video") : "ERR";
    },
    removeAt: function(ti, startSec, type) {
        return ($.global.FASTPASS.Clips) ? FASTPASS.Clips.removeAt(ti, startSec, type || "video") : "ERR";
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

$.global.Markers = {
    set: function(time, comment) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR_NO_SEQ";
        var marker = seq.markers.createMarker(time);
        marker.name = comment;
        marker.comment = comment;
        return "OK";
    },
    get: function() {
        var seq = app.project.activeSequence;
        if (!seq) return "[]";
        var markers = seq.markers;
        var result = [];
        for (var i = 0; i < markers.numMarkers; i++) {
            var m = markers[i];
            result.push({ time: m.start.seconds, comment: m.name || m.comment });
        }
        return JSON.stringify(result);
    },
    clear: function() {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR_NO_SEQ";
        var markers = seq.markers;
        if (!markers) return "ERR_NO_MARKERS";
        // Intentar clear() si está disponible
        if (typeof markers.clear === "function") {
            markers.clear();
            return "OK";
        }
        // Fallback: eliminar marcadores uno por uno
        try {
            while (markers.numMarkers > 0) {
                markers[0].delete();
            }
            return "OK";
        } catch (e) {
            return "ERR:" + e.toString();
        }
    }
};

$.global.Diagnostic = {
    report: function() {
        return ($.global.FASTPASS.Diagnostic) ? FASTPASS.Diagnostic.runFullReport() : "ERR_NO_MODULE";
    }
};

// Exponer FASTPASS globalmente para acceso directo en evalScript
FASTPASS = $.global.FASTPASS;