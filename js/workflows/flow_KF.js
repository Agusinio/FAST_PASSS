/* flow_KF.js - El Negociador de Animació */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    // FIX CRASH: callJSX i log no estaven definits en el scope. 
    // Ara s'obtenen correctament de Utils.
    const getUtils = () => window.FASTPASS_UI.Utils;
    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.KF = {

        runAddKF: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            var self = this;
            log("💎 Sol·licitant nou KF...");

            callJSX('jsx_addKeyframe()').then(function (res) {
                if (res && res.indexOf("OK") !== -1) {
                    return self.runSmoothKF();
                }
            })['catch'](function (err) {
                console.error("Error en flux AddKF: " + err);
            });
        },

        runSmoothKF: async function () {
            try {
                await getUtils().delay(50);
                log("🧠 Negociant corbes...");

                var raw = await callJSX("jsx_getKFData()");

                if (!raw || raw === "[]") {
                    console.warn("⚠️ No s'han obtingut dades. Has posat el KF primer?");
                    return;
                }

                var data = JSON.parse(raw);
                if (!data || data.length < 2) return;

                for (var i = 0; i < data.length; i++) {
                    var t = data[i].time;
                    if (i === 0 || i === data.length - 1) {
                        await callJSX("jsx_applyExtremeKF(" + t + ")");
                    } else {
                        var vP = data[i - 1].val;
                        var vC = data[i].val;
                        var vN = data[i + 1].val;
                        var esPuntoDePaso = (vC > vP && vC < vN) || (vC < vP && vC > vN);
                        if (esPuntoDePaso) {
                            await callJSX("jsx_applyIntermediateKF(" + t + ")");
                        } else {
                            await callJSX("jsx_applyExtremeKF(" + t + ")");
                        }
                    }
                }

                await callJSX("FASTPASS.Sequences.nuclearRefresh()");
                if (FASTPASS_UI.Sync) FASTPASS_UI.Sync.updateSliderFromPremiere();
                log("✅ Corbes processades.");
            } catch (e) {
                console.error("💥 Error en Negociació KF: ", e);
            }
        },

        runAutoReframe: async function() {
            log("🤖 Executant Auto Reframe Intel·ligent...");
            try {
                const res = await callJSX("FASTPASS.KF.applyAutoReframe()");
                if (res === "OK_REFRAME") {
                    getUtils().status("Reframe OK", "exito");
                    log("✅ Auto Reframe aplicat al clip de V1.");
                } else {
                    log("⚠️ Error Reframe: " + res, "WARN");
                }
            } catch (e) {
                console.error("Error en AutoReframe: " + e);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();