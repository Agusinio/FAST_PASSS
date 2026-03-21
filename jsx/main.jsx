/*
 * Projecte: FAST >>> PASS
 * Main Router (Version con Renumeración Final + Bridges Limpios)
 */

$.global.FASTPASS = $.global.FASTPASS || {};

function jsx_BOOTSTRAP(extensionRootPath) {
    try {
        var root = extensionRootPath.replace(/\\/g, "/");
        var load = function (name) {
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
    } catch (e) { return "ERR: " + e.message; }
}

function jsx_isReady() { return "READY"; }
function jsx_ClearCache() { return "OK"; }
function jsx_fileExists(path) { return (new File(path)).exists; }

var FASTPASS_WorkProject = null;

// --- 1. IO & SYSTEM ---
function jsx_scanDirectory(path) { return FASTPASS.IO.getRawFiles(path); }
function jsx_importFiles(jsonPaths, binName) { return FASTPASS.IO.importFiles(jsonPaths, binName); }

// --- 2. PROJECT ---
function jsx_listItems(binName, projectPath) { return FASTPASS.Project.listItems(binName, projectPath); }
function jsx_renameItem(oldName, newName, projectPath) { return FASTPASS.Project.renameItem(oldName, newName, projectPath) ? "true" : "false"; }
function jsx_moveItem(itemName, binName, projectPath) { return FASTPASS.Project.moveItem(itemName, binName, projectPath) ? "true" : "false"; }
function jsx_saveProjectAs(path, projectPath) { return FASTPASS.Project.saveAs(path, projectPath) ? "true" : "false"; }
function jsx_openProject(path) { return FASTPASS.Project.openProject(path) ? "true" : "false"; }
function jsx_cloneSequence(source, target, projectPath) { return FASTPASS.Project.cloneSequence(source, target, projectPath); }
function jsx_openSequence(name, projectPath) { return FASTPASS.Project.openSequence(name, projectPath) ? "true" : "false"; }
function jsx_getSequences(projectPath) { return FASTPASS.Project.listSequences(projectPath); }
function jsx_createBin(name, projectPath) { var bin = FASTPASS.Project.createBin(name, projectPath); return bin ? bin.name : "root"; }

// --- 3. TIMELINE & TRACKS ---
function jsx_getCTI() { return FASTPASS.Sequences.getCTI(); }
function jsx_setCTI_Safe(val) { return FASTPASS.Sequences.setCTI(val); }
function jsx_setSequenceInOut(i, o) { return FASTPASS.Sequences.setInOut(i, o); }
function jsx_getTrackCount(type) { return FASTPASS.Tracks.getTrackCount(type); }
function jsx_setTrackMute(idx, m, type) { return FASTPASS.Tracks.setMute(idx - 1, m, type); }
function jsx_setTrackLock(idx, l, type) { return FASTPASS.Tracks.setLock(idx - 1, l, type); }
function jsx_setTrackTarget(idx, t, type) { return FASTPASS.Tracks.setTarget(idx - 1, t, type); }
function jsx_getProjectFolder() { return app.project.path ? (new File(app.project.path)).parent.fsName : ""; }
function jsx_getActiveSequenceName() { return app.project.activeSequence ? app.project.activeSequence.name : ""; }

// --- 4. CLIPS (SOPORTE TOTAL V/A/S) ---
function jsx_getClipCount(trackIdx, type) { return FASTPASS.Clips.getCount(trackIdx - 1, type || "video"); }
function jsx_getClipDataByIndex(trackIdx, clipIdx, type) { return FASTPASS.Clips.getDataByIndex(trackIdx - 1, clipIdx, type || "video"); }
function jsx_removeClip(trackIdx, clipIdx, type) { return FASTPASS.Clips.remove(trackIdx - 1, clipIdx, type || "video"); }
function jsx_overwriteClip(name, trackIdx, time, type) { return FASTPASS.Clips.overwrite(name, trackIdx - 1, time, type); }
function jsx_getClipDataByTime(ti, t, type) { return FASTPASS.Clips.getDataByTime(ti, t, type); }
function jsx_getSelectedSubtitleClips() { return FASTPASS.Clips.getSelectedSubtitleClips(); }
function jsx_detectScenes(trackIdx) { return FASTPASS.Clips.detectScenes(trackIdx - 1); }
function jsx_setClipStart(ti, ci, t, type) { return FASTPASS.Clips.setStart(ti - 1, ci, t, type); }
function jsx_setClipEnd(ti, ci, t, type) { return FASTPASS.Clips.setEnd(ti - 1, ci, t, type); }
function jsx_setClipInPoint(ti, ci, t, type) { return FASTPASS.Clips.setInPoint(ti - 1, ci, t, type); }
function jsx_setClipProperty(ti, ci, comp, prop, val, type) { return FASTPASS.Clips.setProperty(ti - 1, ci, comp, prop, val, type); }

// --- 5. MOTION & KF ---
function jsx_getXPosition() { return FASTPASS.KF.getXPosition(); }
function jsx_setClipXPosition(val, isFinal) { return FASTPASS.KF.setXPosition(val, isFinal); }
function jsx_addKey(ti, ci, comp, prop, time) { return FASTPASS.KF.addKey(ti - 1, ci, comp, prop, time); }
function jsx_removeKey(ti, ci, comp, prop, time) { return FASTPASS.KF.removeKey(ti - 1, ci, comp, prop, time); }
function jsx_setKeyValue(ti, ci, comp, prop, time, val) { return FASTPASS.KF.setKeyValue(ti - 1, ci, comp, prop, time, val); }
function jsx_setInterpolation(ti, ci, comp, prop, time, type) { return FASTPASS.KF.setInterpolation(ti - 1, ci, comp, prop, time, type); }
function jsx_addKeyframe() { return FASTPASS.KF.addKeyframeAtCurrentTime(); }

// --- 6. RENDER & EXPORT ---
function jsx_exportFrameQE(tempPath, time) { return FASTPASS.Render.exportFrameQE(tempPath, time); }
function jsx_renderActiveSequence(preset, output, name) { return FASTPASS.Render.addToAME(preset, output, name); }

// --- 7. CONTEXT (ATÓMICO) ---
function jsx_getActiveProjectName() { return FASTPASS.Context.getActiveName(); }
function jsx_getOpenProjectsNames() { return FASTPASS.Context.getOpenNames(); }

// --- 9. GRAPHICS ---
function jsx_findLargeChyronVerbose() { return FASTPASS.Graphics.findLargeChyronVerbose(); }
function jsx_findAndPlaceChyron_Stored(trackIdx, inS, outS) { return FASTPASS.Graphics.placeStoredChyron(trackIdx - 1, inS, outS); }

// --- 10. DIAGNOSTIC ---
function jsx_getKFDiagnostic() { return FASTPASS.Diagnostic.runFullReport(); }