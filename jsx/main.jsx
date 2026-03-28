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
        load("8_Graphics.jsx");
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
    find: function(prog, bloc) { return FASTPASS.Project.byTokens(prog, bloc); }
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
    refresh: function() { return FASTPASS.Timeline.refresh(); }
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
function jsx_getClipCount(trackIdx, type) {
    // ENVIAMOS EL trackIdx TAL CUAL (1, 2, 3...)
    return FASTPASS.Clips.getCount(trackIdx, type || "video");
}
function jsx_getClipDataByIndex(trackIdx, clipIdx, type) {
    return FASTPASS.Clips.getDataByIndex(trackIdx, clipIdx, type || "video");
}
function jsx_removeClip(trackIdx, clipIdx, type) { try { return FASTPASS.Clips.remove(trackIdx, clipIdx, type || "video"); } catch (e) { return "ERR: " + e.message; } }
function jsx_overwriteClip(name, trackIdx, time, type) { try { return FASTPASS.Clips.overwrite(name, trackIdx, time, type); } catch (e) { return "ERR: " + e.message; } }
function jsx_getClipDataByTime(ti, t, type) { try { return FASTPASS.Clips.getDataByTime(ti, t, type); } catch (e) { return "null"; } }
function jsx_getSelectedSubtitleClips() { try { return FASTPASS.Clips.getSelectedSubtitleClips(); } catch (e) { return "[]"; } }
function jsx_detectScenes(trackIdx) { try { return FASTPASS.Clips.detectScenes(trackIdx); } catch (e) { return "ERR: " + e.message; } }
function jsx_setClipStart(ti, ci, t, type) {
    return FASTPASS.Clips.setStart(ti, ci, t, type);
}

function jsx_setClipInPoint(trackIdx, clipIdx, seconds, type) {
    try { return FASTPASS.Clips.setInPoint(trackIdx, clipIdx, seconds, type); } catch (e) { return "ERR:" + e.message; }
}
function jsx_setClipEnd(ti, ci, t, type) { try { return FASTPASS.Clips.setEnd(ti, ci, t, type); } catch (e) { return "ERR: " + e.message; } }
function jsx_setClipProperty(ti, ci, comp, prop, val, type) { return FASTPASS.Clips.setProperty(ti, ci, comp, prop, val, type); }

// --- 5. MOTION & KF ---
function jsx_getXPosition() { try { return FASTPASS.KF.getXPosition(); } catch (e) { return "0"; } }
function jsx_setClipXPosition(val, isFinal) { try { return FASTPASS.KF.setXPosition(val, isFinal); } catch (e) { return "ERR: " + e.message; } }
function jsx_addKey(ti, ci, comp, prop, time) { try { return FASTPASS.KF.addKey(ti, ci, comp, prop, time); } catch (e) { return "ERR: " + e.message; } }
function jsx_removeKey(ti, ci, comp, prop, time) { try { return FASTPASS.KF.removeKey(ti, ci, comp, prop, time); } catch (e) { return "ERR: " + e.message; } }
function jsx_setKeyValue(ti, ci, comp, prop, time, val) { try { return FASTPASS.KF.setKeyValue(ti, ci, comp, prop, time, val); } catch (e) { return "ERR: " + e.message; } }
function jsx_setInterpolation(ti, ci, comp, prop, time, type) { try { return FASTPASS.KF.setInterpolation(ti, ci, comp, prop, time, type); } catch (e) { return "ERR: " + e.message; } }
function jsx_addKeyframe() { try { return FASTPASS.KF.addKeyframeAtCurrentTime(); } catch (e) { return "ERR: " + e.message; } }
function jsx_applyAutoReframe(ti, ci) { try { return FASTPASS.KF.applyAutoReframe(ti, ci); } catch (e) { return "ERR: " + e.message; } }

// --- 6. RENDER & EXPORT ---
function jsx_exportFrameQE(tempPath, time) { try { return FASTPASS.Render.exportFrameQE(tempPath, time); } catch (e) { return "ERR: " + e.message; } }
function jsx_renderActiveSequence(preset, output, name) { try { return FASTPASS.Render.addToAME(preset, output, name); } catch (e) { return "ERR: " + e.message; } }

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