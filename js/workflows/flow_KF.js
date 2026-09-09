/* flow_KF.js - El Negociador de Animació - v2.6.0 literal */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    const COMPANT = 'AE.ADBE Motion';
    const PROPPOS = 'ADBE Video Position';

    FASTPASS_UI.Workflows.KF = {

        runAddKF: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("💎 Toggle keyframe al clip objectiu (el SELECCIONAT)...");
            console.log('DEBUG runAddKF: called');
            try {
                const res = await callJSX("Anim.addKF()");
                const st = window.FASTPASS_UI.State;

                // KEY tret (el clip ja tenia un key a l'instant del CTI).
                if (res && res.indexOf("OK_REMOVED") === 0) {
                    if (st) st.isKeyframeMode = false;
                    getUtils().status("Keyframe eliminat", "warn");
                    // El mode real el decideixen els keys que quedin: consultem
                    // el clip objectiu per no quedar-nos amb un mode obsolet.
                    try {
                        const mi = await callJSX("Anim.modeInfo()");
                        if (mi && mi !== "null") {
                            const o = JSON.parse(mi);
                            if (st) st.isKeyframeMode = !!o.kf;
                        }
                    } catch (eM) {}
                    if (getUtils().forceLog) getUtils().forceLog("🔬 addKF TRACE: " + res);
                    log("✅ Keyframe tret del clip objectiu. " + res);
                    return;
                }

                // Clip de fons (PNG/JPG): no s'anima mai.
                if (res && res.indexOf("OK_IGNORAT") === 0) {
                    getUtils().status("Clip de fons: no es pot animar", "warn");
                    log("⚠️ addKF ignorat (clip de fons). " + res, "WARN");
                    return;
                }

                if (res && res.indexOf("OK") === 0) {
                    if (st) st.isKeyframeMode = true;
                    getUtils().status("Keyframe col·locat", "exito");
                    const diag = await callJSX("Anim.debugPos()");
                    const diagKF = await callJSX("Anim.debugKF()");
                    // Traça de diagnòstic visible al FASTPASS.log (sense filtres)
                    if (getUtils().forceLog) {
                        getUtils().forceLog("🔬 addKF TRACE: " + res + " || DebugPos: " + diag + " || DebugKF: " + diagKF);
                    }
                    log("✅ Keyframe col·locat al clip objectiu. Mode KF activat. " + res);
                } else {
                    getUtils().status("Error Keyframe", "error");
                    if (getUtils().forceLog) getUtils().forceLog("🔬 addKF ERROR: " + res);
                    log("⚠️ Error en addKF: " + res, "WARN");
                }
            } catch (e) {
                console.error("Error en runAddKF: " + e);
            }
        },

        runSmoothKF: async function () {
            try {
                await getUtils().delay(50);
                log("🧠 Negociant corbes...");

                // Literal: Anim.get()
                var raw = await callJSX("Anim.get()");

                if (!raw || raw === "[]") {
                    console.warn("⚠️ No s'han obtingut dades. Has posat el KF primer?");
                    return;
                }

                var data = JSON.parse(raw);
                if (!data || data.length < 2) return;

                for (var i = 0; i < data.length; i++) {
                    var t = data[i].time;
                    if (i === 0 || i === data.length - 1) {
                        // Extreme: Bezier (5)
                        await callJSX(`Anim.interp(-1, -1, '${COMPANT}', '${PROPPOS}', ${t}, 5)`);
                    } else {
                        var vP = data[i - 1].val;
                        var vC = data[i].val;
                        var vN = data[i + 1].val;
                        var esPuntoDePaso = (vC > vP && vC < vN) || (vC < vP && vC > vN);
                        
                        // Intermediate: Linear (1) o Extreme (5) segons càlcul
                        const mode = esPuntoDePaso ? 1 : 5;
                        await callJSX(`Anim.interp(-1, -1, '${COMPANT}', '${PROPPOS}', ${t}, ${mode})`);
                    }
                }

                await callJSX("Sequences.refresh()");
                if (FASTPASS_UI.Sync) FASTPASS_UI.Sync.updateSliderFromPremiere();
                log("✅ Corbes processades.");
            } catch (e) {
                console.error("💥 Error en Negociació KF: ", e);
            }
        },

        runAutoReframe: async function() {
            log("🔄 Toggle Auto Reframe...");
            console.log('DEBUG runAutoReframe: called');
            try {
                const res = await callJSX("Anim.toggleReframe()");
                if (res === "OK_ADDED_REFRAME") {
                    getUtils().status("Reframe APLICAT", "exito");
                    log("✅ Auto Reframe aplicat al clip seleccionat.");
                } else if (res === "OK_REMOVED_REFRAME") {
                    getUtils().status("Reframe TRET", "warn");
                    log("🔁 Auto Reframe tret del clip.");
                } else if (res === "INFO_ALREADY_HAS_REFRAME") {
                    getUtils().status("Clip ja té Reframe", "warn");
                    log("⚠️ El clip ja conté l'efecte Auto Reframe.");
                } else {
                    getUtils().status("Error Reframe", "error");
                    log("⚠️ Error d'aplicació: " + res, "WARN");
                    if (res === "ERR_EFFECT_NOT_FOUND") {
                        const diag = await callJSX("Anim.debugVideoEffects()");
                        log("🔍 Efectes de vídeo: " + diag, "WARN");
                    }
                }
            } catch (e) {
                console.error("Error en AutoReframe: " + e);
            }
        }
    };

    window.FASTPASS_UI.Workflows.KF = FASTPASS_UI.Workflows.KF;
})();