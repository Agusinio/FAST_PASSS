/* flow_KF.js - El Negociador de Animación */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    FASTPASS_UI.Workflows.KF = {
        
        // Negociación para el botón KEY
        runAddKF: function() {
            var self = this;
            FASTPASS_UI.Utils.log("💎 Solicitando nuevo KF...");
            
            // 1. Orden atómica al JSX
            callJSX('jsx_addKeyframe()').then(function(res) {
                if (res.indexOf("OK") !== -1) {
                    // 2. Si el KF se creó, negociamos el acabado pro
                    return self.runSmoothKF();
                }
            })['catch'](function(err) {
                console.error("Error en flujo AddKF: " + err);
            });
        },

        runSmoothKF: async function() {
            try {
                // 1. ESPERA DE SEGURIDAD (50ms)
                // Esto da tiempo a Premiere a registrar el KF que puso el slider o el botón KEY
                await FASTPASS_UI.Utils.delay(50); 

                log("🧠 Negociando curvas...");
                var raw = await callJSX("jsx_getKFData()");
                
                if (!raw || raw === "[]") {
                    console.warn("⚠️ No se han obtenido datos. ¿Has puesto el KF primero?");
                    return;
                }

                var data = JSON.parse(raw);
                if (!data || data.length < 2) return;

                // 2. Bucle de decisión (Negociación)
                for (var i = 0; i < data.length; i++) {
                    var t = data[i].time;
                    
                    if (i === 0 || i === data.length - 1) {
                        // Es un extremo (Inicio o Final)
                        await callJSX("jsx_applyExtremeKF(" + t + ")");
                    } else {
                        // Analizamos si es un pico o un punto de paso
                        var vP = data[i-1].val;
                        var vC = data[i].val;
                        var vN = data[i+1].val;

                        var esPuntoDePaso = (vC > vP && vC < vN) || (vC < vP && vC > vN);
                        
                        if (esPuntoDePaso) {
                            await callJSX("jsx_applyIntermediateKF(" + t + ")");
                        } else {
                            await callJSX("jsx_applyExtremeKF(" + t + ")");
                        }
                    }
                }

                // 3. Órdenes finales de limpieza visual
                await callJSX("FASTPASS.Sequences.nuclearRefresh()");
                if (FASTPASS_UI.Sync) FASTPASS_UI.Sync.updateSliderFromPremiere();
                
                log("✅ Curvas procesadas.");
            } catch (e) {
                console.error("💥 Error en Negociación KF: ", e);
            }
        }
    };
})();