/*
 * =================================================================================
 * PROJECTE: FAST >>> PASS
 * ARXIU: main.js (ENTRY POINT & UI CONTROLLER - v2.6.0 literal)
 * =================================================================================
 */

// 1. GLOBALES Y NAMESPACES
var csInterface = new CSInterface();
var FASTPASS_UI = window.FASTPASS_UI || {};
FASTPASS_UI.Sync = FASTPASS_UI.Sync || {}; 
var isUserDraggingSlider = false;

// 2. ARRANQUE DEL SISTEMA (BOOTSTRAP SINCRO)
(async function () {
    var getUtils = () => window.FASTPASS_UI ? window.FASTPASS_UI.Utils : null;
    var utils = getUtils();
    if (utils && utils.log) utils.log("🚀 Iniciando Panel...");

    try {
        var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
        var safeRoot = extensionRoot.replace(/\\/g, "/");

        // 📍 PASO A: Llamada al Bootstrap (Manté el nom per ser el punt d'entrada)
        var result = await utils.callJSX('jsx_BOOTSTRAP("' + safeRoot + '")');

        // 📍 PASO B: Iniciar Motor de Configuración (Profile.json)
        await FASTPASS_UI.Config.init();

        // 📍 PASO C: Iniciar Inspectors
        if (result && result.indexOf("OK") !== -1) {
            utils.log("✅ Premiere Listo (Bootstrap OK).");
            utils.isJsxReady = true;

            if (FASTPASS_UI.Core.Context && FASTPASS_UI.Core.Context.init) {
                utils.log("🧠 Vinculando lógica de estado...");
                await FASTPASS_UI.Core.Context.init();
                FASTPASS_UI.Core.Context.checkContext();
            }
        } else {
            console.error("❌ El motor JSX no ha respondido correctamente: " + result);
            if (utils.status) utils.status("Error de motor JSX", "error");
        }

    } catch (error) {
        console.error("💥 Error fatal durante el arranque:", error);
    }
})();

// 3. CONTROLADOR DE LA INTERFAZ (BOTONES)
(function () {
    'use strict';

    function initPanel() {
        FASTPASS_UI.Utils.log("🚀 Vinculando botones...");

        // --- WORKFLOW: CUT ---
        const btnIn = document.getElementById('btnIn');
        const btnOut = document.getElementById('btnOut');
        const btnScene = document.getElementById('btnScene');
        const btnPrevClip = document.getElementById('btnPrevClip');
        const btnNextClip = document.getElementById('btnNextClip');
        const btnCenter = document.getElementById('btnCenter');
        const btnKey = document.getElementById('btnKey');

        if (btnIn) btnIn.addEventListener('click', function () { callWorkflow('Cut', 'runCutIn'); });
        if (btnOut) btnOut.addEventListener('click', function () { callWorkflow('Cut', 'runCutOut'); });
        if (btnScene) btnScene.addEventListener('click', function () { callWorkflow('Cut', 'runScene'); });
        if (btnPrevClip) btnPrevClip.addEventListener('click', function () { callWorkflow('Cut', 'runPrevClip'); });
        if (btnNextClip) btnNextClip.addEventListener('click', function () { callWorkflow('Cut', 'runNextClip'); });

        if (btnCenter) {
            btnCenter.addEventListener('click', function () {
                if (FASTPASS_UI.Workflows.KF) FASTPASS_UI.Workflows.KF.runAutoReframe();
            });
        }
        if (btnKey) {
            btnKey.addEventListener('click', function () {
                if (FASTPASS_UI.Workflows.KF) FASTPASS_UI.Workflows.KF.runAddKF();
            });
        }

        // --- SLIDER: MOVIMIENTO Y ANIMACIÓN ---
        const slider = document.getElementById('slider-move');
        if (slider) {
            slider.oninput = function () {
                isUserDraggingSlider = true;
                var val = parseInt(slider.value, 10);
                // Moviment visual literal
                FASTPASS_UI.Utils.callJSX(`Anim.x(${val}, false)`);
            };

            slider.onchange = function () {
                isUserDraggingSlider = false;
                var val = parseInt(slider.value, 10);
                // Clavat de KF i suavitzat literal
                FASTPASS_UI.Utils.callJSX(`Anim.x(${val}, true)`).then(() => {
                    if (FASTPASS_UI.Workflows.KF && FASTPASS_UI.Workflows.KF.runSmoothKF) {
                        FASTPASS_UI.Workflows.KF.runSmoothKF();
                    }
                });
            };
        }

        // --- WORKFLOW: GRÀFICS ---
        const btnResetGrafs = document.getElementById('btnResetGrafs');
        const btnChyrons = document.getElementById('btnPlaceChyrons');
        const btnPlaceGrafic = document.getElementById('btnPlaceGrafic');
        const btnGraph169 = document.getElementById('btnPlaceGraph169');
        const btnBg = document.getElementById('btnBg');

        if (btnResetGrafs) btnResetGrafs.addEventListener('click', () => callWorkflow('Retols', 'runResetGraphics'));
        if (btnChyrons) btnChyrons.addEventListener('click', () => callWorkflow('Retols', 'runPlaceChyrons'));
        if (btnPlaceGrafic) btnPlaceGrafic.addEventListener('click', () => callWorkflow('Retols', 'runPlaceGraphic'));
        if (btnGraph169) btnGraph169.addEventListener('click', () => callWorkflow('Retols', 'runPlaceGraph169'));
        if (btnBg) btnBg.addEventListener('click', () => callWorkflow('Retols', 'runPlaceBackground'));

        // --- WORKFLOW: SRT (SUBTÍTULOS) ---
        const btnSrtWork = document.getElementById('btnSrtWork');
        const btnSrtIn = document.getElementById('btnSrtIn');
        const btnSrtOut = document.getElementById('btnSrtOut');
        const btnTimeAdjust = document.getElementById('btnTimeAdjust');

        if (btnSrtWork) btnSrtWork.addEventListener('click', (e) => {
            if (FASTPASS_UI.Workflows.Srt) FASTPASS_UI.Workflows.Srt.toggleSrtWork(e.ctrlKey);
        });
        if (btnSrtIn) btnSrtIn.addEventListener('click', () => callWorkflow('Srt', 'runSrtIn'));
        if (btnSrtOut) btnSrtOut.addEventListener('click', () => callWorkflow('Srt', 'runSrtOut'));
        if (btnTimeAdjust) btnTimeAdjust.addEventListener('click', () => callWorkflow('Srt', 'runTimeAdjust'));

        // --- WORKFLOW: RENDER ---
        const btnRenderVideo = document.getElementById('btnRenderVideo');
        const btnRenderPortada = document.getElementById('btnRenderPortada');

        if (btnRenderVideo) btnRenderVideo.addEventListener('click', () => callWorkflow('Render', 'runVideo'));
        if (btnRenderPortada) btnRenderPortada.addEventListener('click', () => callWorkflow('Render', 'runPortada'));

        // --- SETUP Y SELECTORES ---
        const btnSetup = document.getElementById('btnSetup');
        const selectPrograma = document.getElementById('programa');
        const selectBloc = document.getElementById('bloc');

        if (btnSetup) btnSetup.addEventListener('click', () => {
            utils.log("⚙️ Obrint Dashboard de Configuració...");
            window.location.href = "setup.html";
        });
        if (selectPrograma) selectPrograma.addEventListener('change', handleSelectionChange);
        if (selectBloc) selectBloc.addEventListener('change', handleSelectionChange);

        // --- INICIALIZACIÓN DE VALORES ---
        if (FASTPASS_UI.Config && FASTPASS_UI.Config.loadSelection) FASTPASS_UI.Config.loadSelection();

        const progInicial = document.getElementById('programa').value;
        if (progInicial && FASTPASS_UI.Core.Context.updateConductorSelector) {
            FASTPASS_UI.Core.Context.updateConductorSelector(progInicial);
        }

        callContextAudit();
        FASTPASS_UI.Utils.log("✅ TODOS LOS BOTONES VINCULADOS");
    }

    async function callWorkflow(module, method) {
        if (FASTPASS_UI.Workflows[module] && FASTPASS_UI.Workflows[module][method]) {
            try {
                await FASTPASS_UI.Workflows[module][method]();
            } catch (e) {
                console.error("💥 Error en Workflow " + module + "." + method + ":", e);
                if (FASTPASS_UI.Utils && FASTPASS_UI.Utils.handleError) {
                    FASTPASS_UI.Utils.handleError(e, module + "." + method);
                }
            }
        } else {
            console.error("⚠️ Error: " + module + "." + method + " no existe.");
        }
    }

    function handleSelectionChange(e) {
        if (e.target.id === 'programa' && FASTPASS_UI.Core.Context.updateConductorSelector) {
            FASTPASS_UI.Core.Context.updateConductorSelector(e.target.value);
        }
        if (FASTPASS_UI.Config) FASTPASS_UI.Config.saveSelection(e.target);
        callContextAudit();
    }

    function callContextAudit() {
        if (!window.FASTPASS_UI.Utils.isJsxReady) return;
        if (FASTPASS_UI.Core.Context && FASTPASS_UI.Core.Context.checkContext) {
            FASTPASS_UI.Core.Context.checkContext();
        }
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initPanel);
    } else {
        initPanel();
    }
})();

// 4. SINCRONIZACIÓN (POLLING DEL SLIDER)
FASTPASS_UI.Sync.updateSliderFromPremiere = function () {
    if (isUserDraggingSlider) return;
    FASTPASS_UI.Utils.callJSX('Anim.x()').then(val => {
        const slider = document.getElementById('slider-move');
        if (slider && val && val !== "undefined" && val !== "") {
            const pxValue = Math.round(parseFloat(val) * 608);
            slider.value = pxValue;
        }
    });
};

setInterval(function () {
    if (FASTPASS_UI.Sync && FASTPASS_UI.Sync.updateSliderFromPremiere) {
        FASTPASS_UI.Sync.updateSliderFromPremiere();
    }
    if (FASTPASS_UI.Registry && FASTPASS_UI.Registry.poll) {
        FASTPASS_UI.Registry.poll();
    }
}, 500);

// Neteja de memòria al entrar amb el ratolí
window.onmouseenter = function () {
    FASTPASS_UI.Utils.callJSX('System.clear()');
};

// Escalfament de rutes de xarxa
async function warmUpNetwork() {
    var config = FASTPASS_UI.Config.get();
    if (config.rutas) {
        console.log("🔥 [SYSTEM] Escalfant rutes de xarxa...");
        FASTPASS_UI.Utils.callJSX(`IO.exists('${config.rutas.verticalitzacio.replace(/\\/g, '\\\\')}')`);
        FASTPASS_UI.Utils.callJSX(`IO.exists('${config.rutas.chyrons.replace(/\\/g, '\\\\')}')`);
    }
};