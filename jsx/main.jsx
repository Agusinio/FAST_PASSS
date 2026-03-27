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
        load("4_Sequences.jsx");
        load("5_Tracks.jsx");
        load("6_Clips.jsx");
        load("7_KF.jsx");
        load("8_Graphics.jsx");
        load("9_Render.jsx");
        load("11_Context.jsx");
        load("12_Diagnostic.jsx");
        load("13_Timeline.jsx");

        return "OK_BOOT";
    } catch (e) {return "ERROR_EN_ARCHIVO [" + currentFile + "] (Línea " + e.line + "): " + e.message; }
}

function jsx_isReady() { return "READY"; }
function jsx_ClearCache() { return "OK"; }
function jsx_fileExists(path) { return (new File(path)).exists; }
function jsx_scanOpenProjects() { try { return FASTPASS.Context.scanOpenProjects(); } catch(e) { return "[]"; } }
function jsx_setWorkProject(projectName) {
    try {
        for (var i = 0; i < app.projects.length; i++) {
            if (app.projects[i].name === projectName) {
                $.global.FASTPASS_WorkProject = app.projects[i];
                return "OK";
            }
        }
        return "ERR:NOT_FOUND";
    } catch(e) { return "ERR:" + e.message; }
}

var FASTPASS_WorkProject = null;

// --- 1. IO & SYSTEM ---
function jsx_scanDirectory(path) { try { return FASTPASS.IO.getRawFiles(path); } catch(e) { return "[]"; } }
function jsx_importFiles(jsonPaths, binName) { try { return FASTPASS.IO.importFiles(jsonPaths, binName); } catch(e) { return "ERR: " + e.message; } }

// --- 2. PROJECT ---
function jsx_listItems(binName, projectPath) { try { return FASTPASS.Project.listItems(binName, projectPath); } catch(e) { return "[]"; } }
function jsx_renameItem(oldName, newName, projectPath) { try { return FASTPASS.Project.renameItem(oldName, newName, projectPath) ? "true" : "false"; } catch(e) { return "false"; } }
function jsx_moveItem(itemName, binName, projectPath) { try { return FASTPASS.Project.moveItem(itemName, binName, projectPath) ? "true" : "false"; } catch(e) { return "false"; } }
function jsx_saveProjectAs(path, projectPath) { try { return FASTPASS.Project.saveAs(path, projectPath) ? "true" : "false"; } catch(e) { return "false"; } }
function jsx_openProject(path) { try { return FASTPASS.Project.openProject(path) ? "true" : "false"; } catch(e) { return "false"; } }
function jsx_cloneSequence(source, target, projectPath) { try { return FASTPASS.Project.cloneSequence(source, target, projectPath); } catch(e) { return "ERR: " + e.message; } }
function jsx_openSequence(name, projectPath) { try { return FASTPASS.Project.openSequence(name, projectPath) ? "true" : "false"; } catch(e) { return "false"; } }
function jsx_getSequences(projectPath) { try { return FASTPASS.Project.listSequences(projectPath); } catch(e) { return "[]"; } }
function jsx_createBin(name, projectPath) { try { var bin = FASTPASS.Project.createBin(name, projectPath); return bin ? bin.name : "root"; } catch(e) { return "root"; } }

// --- 3. TIMELINE & TRACKS ---
function jsx_getCTI() { 
    try { return FASTPASS.Sequences.getCTI(); } catch(e) { return "0"; } 
}
function jsx_setCTI_Safe(val) { try { return FASTPASS.Sequences.setCTI(val); } catch(e) { return "ERR: " + e.message; } }
function jsx_setSequenceInOut(i, o) { try { return FASTPASS.Sequences.setInOut(i, o); } catch(e) { return "ERR: " + e.message; } }
function jsx_getTrackCount(type) { 
    return FASTPASS.Tracks.getTrackCount(type); // Quita el -1 si lo tenías
}
function jsx_setTrackMute(idx, m, type) { try { return FASTPASS.Tracks.setMute(idx, m, type); } catch(e) { return "false"; } }
function jsx_setTrackLock(idx, l, type) { try { return FASTPASS.Tracks.setLock(idx, l, type); } catch(e) { return "false"; } }
function jsx_setTrackTarget(idx, t, type) { try { return FASTPASS.Tracks.setTarget(idx, t, type); } catch(e) { return "false"; } }
function jsx_getProjectFolder() { try { return app.project.path ? (new File(app.project.path)).parent.fsName : ""; } catch(e) { return ""; } }
function jsx_getActiveSequenceName() { try { return app.project.activeSequence ? app.project.activeSequence.name : ""; } catch(e) { return ""; } }

// --- 4. CLIPS (SOPORTE TOTAL V/A/S) ---
function jsx_getClipCount(trackIdx, type) { 
    // ENVIAMOS EL trackIdx TAL CUAL (1, 2, 3...)
    return FASTPASS.Clips.getCount(trackIdx, type || "video"); 
}
function jsx_getClipDataByIndex(trackIdx, clipIdx, type) { 
    return FASTPASS.Clips.getDataByIndex(trackIdx, clipIdx, type || "video"); 
}
function jsx_removeClip(trackIdx, clipIdx, type) { try { return FASTPASS.Clips.remove(trackIdx, clipIdx, type || "video"); } catch(e) { return "ERR: " + e.message; } }
function jsx_overwriteClip(name, trackIdx, time, type) { try { return FASTPASS.Clips.overwrite(name, trackIdx, time, type); } catch(e) { return "ERR: " + e.message; } }
function jsx_getClipDataByTime(ti, t, type) { try { return FASTPASS.Clips.getDataByTime(ti, t, type); } catch(e) { return "null"; } }
function jsx_getSelectedSubtitleClips() { try { return FASTPASS.Clips.getSelectedSubtitleClips(); } catch(e) { return "[]"; } }
function jsx_detectScenes(trackIdx) { try { return FASTPASS.Clips.detectScenes(trackIdx); } catch(e) { return "ERR: " + e.message; } }
function jsx_setClipStart(ti, ci, t, type) { 
    return FASTPASS.Clips.setStart(ti, ci, t, type); 
}

function jsx_setClipInPoint(trackIdx, clipIdx, seconds, type) {
    try { return FASTPASS.Clips.setInPoint(trackIdx, clipIdx, seconds, type); } catch(e) { return "ERR:" + e.message; }
}
function jsx_setClipEnd(ti, ci, t, type) { try { return FASTPASS.Clips.setEnd(ti, ci, t, type); } catch(e) { return "ERR: " + e.message; } }
function jsx_setClipProperty(ti, ci, comp, prop, val, type) { return FASTPASS.Clips.setProperty(ti, ci, comp, prop, val, type); }

// --- 5. MOTION & KF ---
function jsx_getXPosition() { try { return FASTPASS.KF.getXPosition(); } catch(e) { return "0"; } }
function jsx_setClipXPosition(val, isFinal) { try { return FASTPASS.KF.setXPosition(val, isFinal); } catch(e) { return "ERR: " + e.message; } }
function jsx_addKey(ti, ci, comp, prop, time) { try { return FASTPASS.KF.addKey(ti, ci, comp, prop, time); } catch(e) { return "ERR: " + e.message; } }
function jsx_removeKey(ti, ci, comp, prop, time) { try { return FASTPASS.KF.removeKey(ti, ci, comp, prop, time); } catch(e) { return "ERR: " + e.message; } }
function jsx_setKeyValue(ti, ci, comp, prop, time, val) { try { return FASTPASS.KF.setKeyValue(ti, ci, comp, prop, time, val); } catch(e) { return "ERR: " + e.message; } }
function jsx_setInterpolation(ti, ci, comp, prop, time, type) { try { return FASTPASS.KF.setInterpolation(ti, ci, comp, prop, time, type); } catch(e) { return "ERR: " + e.message; } }
function jsx_addKeyframe() { try { return FASTPASS.KF.addKeyframeAtCurrentTime(); } catch(e) { return "ERR: " + e.message; } }
function jsx_applyAutoReframe(ti, ci) { try { return FASTPASS.KF.applyAutoReframe(ti, ci); } catch(e) { return "ERR: " + e.message; } }

// --- 6. RENDER & EXPORT ---
function jsx_exportFrameQE(tempPath, time) { try { return FASTPASS.Render.exportFrameQE(tempPath, time); } catch(e) { return "ERR: " + e.message; } }
function jsx_renderActiveSequence(preset, output, name) { try { return FASTPASS.Render.addToAME(preset, output, name); } catch(e) { return "ERR: " + e.message; } }

// --- 7. CONTEXT (ATÓMICO Y SEGURO) ---
function jsx_findSequenceByTokens(prog, bloc) {
    try {
        return FASTPASS.Context.findSequenceByTokens(prog, bloc);
    } catch(e) { return "ERR:" + e.message; }
}

function jsx_getActiveSequenceName() {
    try {
        // Usamos la lógica robusta del módulo Context
        return FASTPASS.Context.getSequenceName_FINAL();
    } catch(e) { return "ERR:NO_SEQ"; }
}

function jsx_getOpenProjectsNames() { 
    if ($.global.FASTPASS && FASTPASS.Context) {
        return FASTPASS.Context.getOpenNames(); 
    }
    return "[]"; 
}

// --- 9. GRAPHICS ---
function jsx_findLargeChyronVerbose() { try { return FASTPASS.Graphics.findLargeChyronVerbose(); } catch(e) { return "ERR: " + e.message; } }
function jsx_findAndPlaceChyron_Stored(trackIdx, inS, outS) { try { return FASTPASS.Graphics.placeStoredChyron(trackIdx, inS, outS); } catch(e) { return "ERR: " + e.message; } }

// --- 10. DIAGNOSTIC ---
function jsx_getKFDiagnostic() { try { return FASTPASS.Diagnostic.runFullReport(); } catch(e) { return "null"; } }