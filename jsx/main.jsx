/*
 * Projecte: FAST >>> PASS
 * Main Router (Version con Renumeración Final + Bridges Limpios)
 */

$.global.FASTPASS = $.global.FASTPASS || {};

function jsx_BOOTSTRAP(extensionRootPath) {
    var currentFile = "INICIO";
    try {
        var root = extensionRootPath.replace(/\\/g, "/");
        var load = function (name) {
            currentFile = name;

            // 📍 LOG DE DIAGNÒSTIC
            $.writeln("📂 Carregant mòdul: " + name);

            var f = new File(root + "/jsx/modules/" + name);
            if (!f.exists) throw new Error("No existe: " + name);
            $.evalFile(f);
        };

        load("1_System.jsx");
        load("2_IO.jsx");
        load("3_Project.jsx");
        load("13_Timeline.jsx"); // Módulo unificado de navegación
        load("5_Tracks.jsx");
        load("6_Clips.jsx");
        load("7_KF.jsx");
        load("9_Render.jsx");
        load("11_Context.jsx");
        load("12_Diagnostic.jsx");

        return "OK_BOOT";
    } catch (e) { return "ERROR_EN_ARCHIVO [" + currentFile + "] (Línea " + e.line + "): " + e.message; }
}

function jsx_isReady() { return "READY"; }
function jsx_ClearCache() { return "OK"; }
function jsx_fileExists(path) { return (new File(path)).exists; }
function jsx_getActiveProjectName() { try { return app.project.name; } catch (e) { return ""; } }
function jsx_scanOpenProjects() { try { return FASTPASS.Context.scanOpenProjects(); } catch (e) { return "[]"; } }
function jsx_setWorkProject(projectName) {
    try {
        for (var i = 0; i < app.projects.length; i++) {
            if (app.projects[i].name === projectName) {
                $.global.FASTPASS_WorkProject = app.projects[i];
                return "OK";
            }
        }
        return "ERR:NOT_FOUND";
    } catch (e) { return "ERR:" + e.message; }
}

// --- 1. IO & SYSTEM ---
function jsx_scanDirectory(path) { try { return FASTPASS.IO.getRawFiles(path); } catch (e) { return "[]"; } }
function jsx_importFiles(jsonPaths, binName) { try { return FASTPASS.IO.importFiles(jsonPaths, binName); } catch (e) { return "ERR: " + e.message; } }

// --- 2. PROJECT ---

// 📍 NUEVA NOMENCLATURA LITERAL
$.global.Project = {
    save: function() { return FASTPASS.Project.save(); },
    saveAs: function(path) { return FASTPASS.Project.saveAs(path); },
    open: function(path, newSeqName) { 
        var ok = FASTPASS.Project.open(path); 
        if (ok === "OK" && app.project.activeSequence && newSeqName) {
            app.project.activeSequence.name = newSeqName;
        }
        return ok;
    },
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

// 📍 Manteniment Retroactiu (Bridges antics)
function jsx_saveProject() { return Project.save(); }
function jsx_saveProjectAs(path) { return Project.saveAs(path); }
function jsx_openProject(path, newSeqName) { return Project.open(path, newSeqName); }
function jsx_listItems(binName) { return Project.items(binName); }
function jsx_renameItem(n, newN) { return Project.rename(n, newN) === "OK" ? "true" : "false"; }
function jsx_moveItem(it, bin) { return Project.move(it, bin) === "OK" ? "true" : "false"; }
function jsx_cloneSequence(src) { return Project.clone(src); }
function jsx_openSequence(name) { return Project.openSeq(name) === "OK" ? "true" : "false"; }
function jsx_getSequences() { return Project.list(); }
function jsx_createBin(name) { return Project.bin(name); }
function jsx_findSequenceByTokens(p, b) { return Project.find(p, b); }

// --- 3. TIMELINE & NAVEGACIÓN ---

// 📍 NUEVA NOMENCLATURA LITERAL
$.global.Timeline = {
    get: function() { return FASTPASS.Timeline.get(); },
    set: function(s) { return FASTPASS.Timeline.set(s); },
    range: function(i, o) { return FASTPASS.Timeline.range(i, o); },
    refresh: function() { return FASTPASS.Timeline.refresh(); },
    duration: function() { return FASTPASS.Timeline.duration(); },
    in: function(v) { return FASTPASS.Timeline.in(v); },
    out: function(v) { return FASTPASS.Timeline.out(v); }
};

// 📍 Manteniment Retroactiu (Bridges antics)
function jsx_getCTI() { return Timeline.get(); }
function jsx_setCTI_Safe(val) { return Timeline.set(val); }
function jsx_setSequenceInOut(i, o) { return Timeline.range(i, o); }
function jsx_nuclearRefresh() { return Timeline.refresh(); }

// --- 3. TRACKS & PROJ INFO ---

// 📍 NUEVA NOMENCLATURA LITERAL
$.global.Tracks = {
    count: function(type) { return FASTPASS.Tracks.count(type); },
    mute: function(idx, m, type) { return FASTPASS.Tracks.mute(idx, m, type); },
    lock: function(idx, l, type) { return FASTPASS.Tracks.lock(idx, l, type); },
    target: function(idx, t, type) { return FASTPASS.Tracks.target(idx, t, type); }
};

// 📍 Manteniment Retroactiu (Bridges antics)
function jsx_getTrackCount(type) { return Tracks.count(type); }
function jsx_setTrackMute(idx, m, type) { try { return Tracks.mute(idx, m, type); } catch (e) { return "false"; } }
function jsx_setTrackLock(idx, l, type) { try { return Tracks.lock(idx, l, type); } catch (e) { return "false"; } }
function jsx_setTrackTarget(idx, t, type) { try { return Tracks.target(idx, t, type); } catch (e) { return "false"; } }

function jsx_getProjectFolder() { 
    try { 
        var proj = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkProject() : app.project;
        return proj.path ? (new File(proj.path)).parent.fsName : ""; 
    } catch (e) { return ""; } 
}

// --- 4. CLIPS (SOPORTE TOTAL V/A/S) ---
function jsx_getClipCount(trackIdx, type) { return FASTPASS.Clips.count(trackIdx, type || "video"); }
function jsx_getClipDataByIndex(trackIdx, clipIdx, type) { return FASTPASS.Clips.get(trackIdx, clipIdx, type || "video"); }
function jsx_removeClip(trackIdx, clipIdx, type) { try { return FASTPASS.Clips.remove(trackIdx, clipIdx, type || "video"); } catch (e) { return "ERR: " + e.message; } }
function jsx_overwriteClip(name, trackIdx, time, type) { try { return FASTPASS.Clips.insert(name, trackIdx, time, type); } catch (e) { return "ERR: " + e.message; } }
function jsx_getClipDataByTime(ti, t, type) { try { return FASTPASS.Clips.at(ti, t, type); } catch (e) { return "null"; } }
function jsx_getSelectedSubtitleClips() { try { return FASTPASS.Clips.getSubtitles(); } catch (e) { return "[]"; } }
function jsx_detectScenes(trackIdx) { try { return FASTPASS.Clips.scenes(trackIdx); } catch (e) { return "ERR: " + e.message; } }
function jsx_setClipStart(ti, ci, t, type) { return FASTPASS.Clips.start(ti, ci, t, type); }
function jsx_setClipInPoint(trackIdx, clipIdx, seconds, type) { try { return FASTPASS.Clips.inPoint(trackIdx, clipIdx, seconds, type); } catch (e) { return "ERR:" + e.message; } }
function jsx_setClipEnd(ti, ci, t, type) { try { return FASTPASS.Clips.end(ti, ci, t, type); } catch (e) { return "ERR: " + e.message; } }
function jsx_setClipProperty(ti, ci, comp, prop, val, type) { return FASTPASS.Clips.setProp(ti, ci, comp, prop, val, type); }

// --- 5. MOTION & KF ---
// --- 5. MOTION & ANIM ---
$.global.Anim = {
    add: function(ti, ci, comp, prop, t) { return FASTPASS.Anim.add(ti, ci, comp, prop, t); },
    remove: function(ti, ci, comp, prop, t) { return FASTPASS.Anim.remove(ti, ci, comp, prop, t); },
    set: function(ti, ci, comp, prop, t, v) { return FASTPASS.Anim.set(ti, ci, comp, prop, t, v); },
    interp: function(ti, ci, comp, prop, t, i) { return FASTPASS.Anim.interp(ti, ci, comp, prop, t, i); },
    list: function(ti, ci, comp, prop) { return FASTPASS.Anim.list(ti, ci, comp, prop); },
    x: function(v, f) { return (arguments.length === 0) ? FASTPASS.Anim.x() : FASTPASS.Anim.x(v, f); },
    reframe: function(ti, ci) { return FASTPASS.Anim.reframe(ti, ci); }
};

function jsx_getXPosition() { return Anim.x(); }
function jsx_setClipXPosition(val, isFinal) { return Anim.x(val, isFinal); }
function jsx_addKey(ti, ci, comp, prop, time) { return Anim.add(ti, ci, comp, prop, time); }
function jsx_removeKey(ti, ci, comp, prop, time) { return Anim.remove(ti, ci, comp, prop, time); }
function jsx_setKeyValue(ti, ci, comp, prop, time, val) { return Anim.set(ti, ci, comp, prop, time, val); }
function jsx_setInterpolation(ti, ci, comp, prop, time, type) { return Anim.interp(ti, ci, comp, prop, time, type); }
function jsx_addKeyframe() { 
    var seq = app.project.activeSequence;
    var cti = seq.getPlayerPosition();
    var info = FASTPASS.Clips.at(1, cti.seconds, "video");
    if (!info || info === "null") return "ERR";
    return Anim.add(1, info.index, "ADBE Motion", "ADBE Video Position", cti.seconds);
}
function jsx_applyAutoReframe(ti, ci) { return Anim.reframe(ti, ci); }

// --- 6. RENDER & EXPORT ---
$.global.Render = {
    frame: function(p, t) { return FASTPASS.Render.frame(p, t); },
    snapshot: function(p, t) { return FASTPASS.Render.exportFrameQE(p, t); },
    queue: function(pr, o, n) { return FASTPASS.Render.addToAME(pr, o, n); }
};

function jsx_exportFrameQE(tempPath, time) { return Render.snapshot(tempPath, time); }
function jsx_renderActiveSequence(preset, output, name) { return Render.queue(preset, output, name); }

// --- 7. CONTEXT (ATÓMICO Y SEGURO) ---
function jsx_findSequenceByTokens(prog, bloc) {
    try {
        return FASTPASS.Context.findSequenceByTokens(prog, bloc);
    } catch (e) { return "ERR:" + e.message; }
}

function jsx_getActiveSequenceName() {
    try {
        // Usamos la lógica robusta del módulo Context
        return FASTPASS.Context.getSequenceName_FINAL();
    } catch (e) { return "ERR:NO_SEQ"; }
}

function jsx_getOpenProjectsNames() {
    if ($.global.FASTPASS && FASTPASS.Context) {
        return FASTPASS.Context.getOpenNames();
    }
    return "[]";
}

// --- 9. GRAPHICS ---
function jsx_findLargeChyronVerbose() { try { return FASTPASS.Graphics.findLargeChyronVerbose(); } catch (e) { return "ERR: " + e.message; } }
function jsx_findAndPlaceChyron_Stored(trackIdx, inS, outS) { try { return FASTPASS.Graphics.placeStoredChyron(trackIdx, inS, outS); } catch (e) { return "ERR: " + e.message; } }

// --- 10. DIAGNOSTIC ---
function jsx_getKFDiagnostic() { try { return FASTPASS.Diagnostic.runFullReport(); } catch (e) { return "null"; } }