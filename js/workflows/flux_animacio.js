/**
 * ============================================================================
 * flux_animacio.js (Workflow d'Animació i Keyframes)
 * ============================================================================
 */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getEines = () => window.FASTPASS_UI.Eines;
    const log = (m) => getEines().log(m, "DEBUG");
    const callJSX = (s) => getEines().callJSX(s);

    const COMPANT = 'AE.ADBE Motion';
    const PROPPOS = 'ADBE Video Position';

    FASTPASS_UI.Workflows.KF = {

        runAddKF: async function () {
            if (!(await getEines().validateActiveSequence())) return;
            var self = this;
            log("💎 Sol·licitant nou KF...");

            // Literal: Anim.add(track, clip, component, property, time)
            // Posem -1 per a que el motor busque la selecció actual
            callJSX(`Animacio.add(-1, -1, '${COMPANT}', '${PROPPOS}', -1)`).then(function (res) {
                if (res && res.indexOf("OK") !== -1) {
                    return self.runSmoothKF();
                }
            })['catch'](function (err) {
                console.error("Error en flux AddKF: " + err);
            });
        },

        runSmoothKF: async function () {
            try {
                await getEines().delay(50);
                log("🧠 Negociant corbes...");

                // Literal: Anim.get()
                var raw = await callJSX("Animacio.get()");

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
                        await callJSX(`Animacio.interp(-1, -1, '${COMPANT}', '${PROPPOS}', ${t}, 5)`);
                    } else {
                        var vP = data[i - 1].val;
                        var vC = data[i].val;
                        var vN = data[i + 1].val;
                        var esPuntoDePaso = (vC > vP && vC < vN) || (vC < vP && vC > vN);
                        
                        // Intermediate: Linear (1) o Extreme (5) segons càlcul
                        const mode = esPuntoDePaso ? 1 : 5;
                        await callJSX(`Animacio.interp(-1, -1, '${COMPANT}', '${PROPPOS}', ${t}, ${mode})`);
                    }
                }

                await callJSX("Cronologia.refresh()");
                if (FASTPASS_UI.Sync) FASTPASS_UI.Sync.updateSliderFromPremiere();
                log("✅ Corbes processades.");
            } catch (e) {
                console.error("💥 Error en Negociació KF: ", e);
            }
        },

        runAutoReframe: async function() {
            log("🤖 Executant Auto Reframe Intel·ligent...");
            try {
                const res = await callJSX("Animacio.reframe(1, -1)"); // V1, cabezal
                if (res === "OK_ADDED_REFRAME") {
                    getEines().status("Reframe APLICAT", "exito");
                    log("✅ Auto Reframe aplicat al clip de V1.");
                } else if (res === "INFO_ALREADY_HAS_REFRAME") {
                    getEines().status("Clip ja té Reframe", "warn");
                    log("⚠️ El clip ja conté l'efecte Auto Reframe.");
                } else {
                    getEines().status("Error Reframe", "error");
                    log("⚠️ Error d'aplicació: " + res, "WARN");
                }
            } catch (e) {
                console.error("Error en AutoReframe: " + e);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();