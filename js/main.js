/*
 * =================================================================================
 * PROJECTE: FAST >>> PASS
 * ARXIU: main.js (ENTRY POINT & UI CONTROLLER - FULL VERSION)
 * =================================================================================
 */

// 1. GLOBALES Y NAMESPACES
var csInterface = new CSInterface();
var FASTPASS_UI = window.FASTPASS_UI || {}; 
FASTPASS_UI.Sync = FASTPASS_UI.Sync || {}; // Aseguramos que Sync exista para no dar error
var isUserDraggingSlider = false;

// 2. ARRANQUE DEL SISTEMA (BOOTSTRAP SINCRO)
(async function() {
    var utils = FASTPASS_UI.Utils;
    if (utils && utils.log) utils.log("🚀 Iniciando Panel...");

    try {
        var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
        var safeRoot = extensionRoot.replace(/\\/g, "/");

        // 📍 PASO A: Llamada al Bootstrap
        var result = await utils.callJSX('jsx_BOOTSTRAP("' + safeRoot + '")');

        // 📍 PASO B: Verificación de respuesta (1_System.jsx devuelve "OK_BOOT")
        if (result && result.indexOf("OK") !== -1) {
            utils.log("✅ Premiere Listo (Bootstrap OK).");
            
            // Levantamos el semáforo
            utils.isJsxReady = true; 

            // 📍 PASO C: Inicialización de la lógica
            if (FASTPASS_UI.Logic && FASTPASS_UI.Logic.init) {
                utils.log("🧠 Vinculando lógica de estado...");
                FASTPASS_UI.Logic.init(); 
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
(function() {
    'use strict';

    function initPanel() {
        FASTPASS_UI.Utils.log("🚀 Vinculando botones...");

        // --- WORKFLOW: CUT ---
        const btnIn = document.getElementById('btnIn');
        const btnOut = document.getElementById('btnOut');
        const btnScene = document.getElementById('btnScene');
        const btnPrevClip = document.getElementById('btnPrevClip');
        const btnNextClip = document.getElementById('btnNextClip');
        const btnKey = document.getElementById('btnKey');

        if (btnIn) btnIn.addEventListener('click', function() { callWorkflow('Cut', 'runCutIn'); });
        if (btnOut) btnOut.addEventListener('click', function() { callWorkflow('Cut', 'runCutOut'); });
        if (btnScene) btnScene.addEventListener('click', function() { callWorkflow('Cut', 'runScene'); });
        if (btnPrevClip) btnPrevClip.addEventListener('click', function() { callWorkflow('Cut', 'runPrevClip'); });
        if (btnNextClip) btnNextClip.addEventListener('click', function() { callWorkflow('Cut', 'runNextClip'); });
        if (btnKey) {
            btnKey.addEventListener('click', function() { 
                if(FASTPASS_UI.Workflows.KF) FASTPASS_UI.Workflows.KF.runAddKF(); 
            });
        }

        // --- SLIDER: MOVIMIENTO Y ANIMACIÓN ---
        const slider = document.getElementById('slider-move');
        if (slider) {
            slider.oninput = function() {
                isUserDraggingSlider = true;
                var val = parseInt(slider.value, 10);
                // Movimiento visual (ligero)
                csInterface.evalScript('jsx_setClipXPosition(' + val + ', false)');
            };
            
            slider.onchange = function() {
                isUserDraggingSlider = false;
                var val = parseInt(slider.value, 10);
                // Clavado de KF (pesado) y suavizado
                csInterface.evalScript('jsx_setClipXPosition(' + val + ', true)', function() {
                    if (FASTPASS_UI.Workflows.KF && FASTPASS_UI.Workflows.KF.runSmoothKF) {
                        FASTPASS_UI.Workflows.KF.runSmoothKF();
                    }
                });
            };
        }

        // --- WORKFLOW: GRÀFICS ---
        const btnChyrons = document.getElementById('btnPlaceChyrons');
        const btnGraph169 = document.getElementById('btnPlaceGraph169');
        const btnDiag = document.getElementById('btnDiagnostic');

        if (btnChyrons) btnChyrons.addEventListener('click', () => callWorkflow('Retols', 'runPlaceChyrons'));
        if (btnGraph169) btnGraph169.addEventListener('click', () => callWorkflow('Retols', 'runPlaceGraph169'));
        if (btnDiag) {
            btnDiag.addEventListener('click', function() {
                FASTPASS_UI.Utils.log("🛠️ Ejecutando Diagnóstico...");
                csInterface.evalScript('jsx_getKFDiagnostic()', function(report) {
                    console.log("📊 --- RESULTADO DEL DIAGNÓSTICO ---\n" + report);
                });
            });
        }

        // --- WORKFLOW: SRT (SUBTÍTULOS) ---
        const btnSrtWork = document.getElementById('btnSrtWork');
        const btnSrtIn = document.getElementById('btnSrtIn');
        const btnSrtOut = document.getElementById('btnSrtOut');
        const btnTimeAdjust = document.getElementById('btnTimeAdjust');

        if (btnSrtWork) btnSrtWork.addEventListener('click', (e) => {
            if(FASTPASS_UI.Workflows.Srt) FASTPASS_UI.Workflows.Srt.toggleSrtWork(e.ctrlKey);
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

        if (btnSetup) btnSetup.addEventListener('click', () => console.log("⚙️ Setup Clicked"));
        if (selectPrograma) selectPrograma.addEventListener('change', handleSelectionChange);
        if (selectBloc) selectBloc.addEventListener('change', handleSelectionChange);

        // --- INICIALIZACIÓN DE VALORES ---
        if(FASTPASS_UI.Config && FASTPASS_UI.Config.loadSelection) FASTPASS_UI.Config.loadSelection();

        const progInicial = document.getElementById('programa').value;
        if (progInicial && FASTPASS_UI.Logic.updateConductorSelector) {
            FASTPASS_UI.Logic.updateConductorSelector(progInicial);
        }

        callStateManager();
        FASTPASS_UI.Utils.log("✅ TODOS LOS BOTONES VINCULADOS");
    }

    // HELPERS INTERNOS
    function callWorkflow(module, method) {
        if (FASTPASS_UI.Workflows[module] && FASTPASS_UI.Workflows[module][method]) {
            FASTPASS_UI.Workflows[module][method]();
        } else {
            console.error("⚠️ Error: " + module + "." + method + " no existe.");
        }
    }

    function handleSelectionChange(e) {
        if (e.target.id === 'programa' && FASTPASS_UI.Logic.updateConductorSelector) {
            FASTPASS_UI.Logic.updateConductorSelector(e.target.value);
        }
        if(FASTPASS_UI.Config) FASTPASS_UI.Config.saveSelection(e.target); 
        callStateManager();
    }

    function callStateManager() {
        if (FASTPASS_UI.Logic && FASTPASS_UI.Logic.StateManager) {
            FASTPASS_UI.Logic.StateManager.checkContext();
        }
    }

    window.addEventListener('DOMContentLoaded', initPanel);
})();

// 4. SINCRONIZACIÓN (POLLING)
// Corregido para usar la nueva ruta y evitar el error del debugger
FASTPASS_UI.Sync.updateSliderFromPremiere = function() {
    if (isUserDraggingSlider) return;
    
    csInterface.evalScript('jsx_getXPosition()', function(val) {
        const slider = document.getElementById('slider-move');
        if (slider && val && val !== "undefined" && val !== "") {
            const pxValue = Math.round(parseFloat(val) * 608);
            slider.value = pxValue;
        }
    });
};

setInterval(function() {
    if (FASTPASS_UI.Sync && FASTPASS_UI.Sync.updateSliderFromPremiere) {
        FASTPASS_UI.Sync.updateSliderFromPremiere();
    }
}, 500);

// Diagnóstico post-arranque (matamos el viejo EvalScript error)
setTimeout(() => {
    if (window.FASTPASS_UI && FASTPASS_UI.Utils) {
        FASTPASS_UI.Utils.callJSX("jsx_getKFDiagnostic()").then(report => {
            console.log("📊 REPORTE INICIAL:\n" + report);
        }).catch(() => {});
    }
}, 3000);

// Cache cleaner al entrar con el ratón
window.onmouseenter = function() {
    csInterface.evalScript('jsx_ClearCache()');
};

// Afegeix això al final del teu fitxer d'arrancada del panell
async function warmUpNetwork() {
    var config = FASTPASS_UI.Config.get();
    if (config.rutas) {
        console.log("🔥 [SYSTEM] Escalfant rutes de xarxa...");
        // Cridem a una funció lleugera que només verifiqui l'existència
        utils.callJSX("jsx_fileExists('" + config.rutas.verticalitzacio.replace(/\\/g, '\\\\') + "')");
        utils.callJSX("jsx_fileExists('" + config.rutas.chyrons.replace(/\\/g, '\\\\') + "')");
    }
};