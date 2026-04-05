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
    var Eines = window.FASTPASS_UI ? window.FASTPASS_UI.Eines : null;
    
    try {
        // 1. Obtenemos la ruta nativa
        var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
        
        // 2. BLINDAJE TOTAL: 
        // Convertimos todas las barras a inclinadas / (formato URL/Unix)
        // Esto evita que Windows interprete \U o \T como caracteres especiales
        var safeRoot = extensionRoot.replace(/\\/g, "/");

        Eines.log("📂 Ruta detectada: " + safeRoot, "DEBUG");

        // 3. LLAMADA QUIRÚRGICA:
        // Usamos comillas simples para el envoltorio y dobles para el contenido
        var result = await Eines.callJSX('jsx_BOOTSTRAP("' + safeRoot + '")');

        if (result && result.indexOf("OK") !== -1) {
            window.FASTPASS_UI.Eines.isJsxReady = true; // 📍 ESTA LÍNEA ES VITAL
            Eines.log("✅ Motor JSX montado con éxito.");
            //Eines.isJsxReady = true;

            await FASTPASS_UI.Config.init();
            
            if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                await FASTPASS_UI.Core.Context.init();
            }
        } else {
            // Si el motor falla, ahora el 'result' nos dirá EXACTAMENTE en qué línea del JSX falló
            console.error("❌ Fallo en el motor: " + result);
        }

    } catch (error) {
        console.error("💥 Error fatal:", error);
    }
})();

// 3. CONTROLADOR DE LA INTERFAZ (BOTONES)
(function () {
    'use strict';

    function initPanel() {
        FASTPASS_UI.Eines.log("🚀 Vinculando botones...");

        // --- WORKFLOW: CUT ---
        const btnIn = document.getElementById('btnIn');
        console.log("🔍 Buscando botón IN...", btnIn);
        const btnOut = document.getElementById('btnOut');
        const btnScene = document.getElementById('btnScene');
        const btnPrevClip = document.getElementById('btnPrevClip');
        const btnNextClip = document.getElementById('btnNextClip');
        const btnCenter = document.getElementById('btnCenter');
        const btnKey = document.getElementById('btnKey');

        if (btnIn) {
            btnIn.onclick = function() { 
                alert("¡BOTÓN CLICADO DIRECTAMENTE!"); 
                callWorkflow('Cut', 'runCutIn'); 
            };
        } else {
            console.error("❌ NO SE ENCUENTRA EL ELEMENTO btnIn EN EL HTML");
        }
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
                FASTPASS_UI.Eines.callJSX(`Animacio.x(${val}, false)`);
            };

            slider.onchange = function () {
                isUserDraggingSlider = false;
                var val = parseInt(slider.value, 10);
                // Clavat de KF i suavitzat literal
                FASTPASS_UI.Eines.callJSX(`Animacio.x(${val}, true)`).then(() => {
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
            Eines.log("⚙️ Obrint Dashboard de Configuració...");
            window.location.href = "setup.html";
        });
        if (selectPrograma) selectPrograma.addEventListener('change', handleSelectionChange);
        if (selectBloc) selectBloc.addEventListener('change', handleSelectionChange);

        // --- INICIALIZACIÓN DE VALORES ---
        if (FASTPASS_UI.Config && FASTPASS_UI.Config.loadSelection) FASTPASS_UI.Config.loadSelection();

        const progInicial = document.getElementById('programa').value;
        if (progInicial && FASTPASS_UI.Core.Context.syncConductorUI) {
            FASTPASS_UI.Core.Context.syncConductorUI(progInicial);
        }

        callContextAudit();
        FASTPASS_UI.Eines.log("✅ TODOS LOS BOTONES VINCULADOS");
    }

    async function callWorkflow(module, method) {
        if (FASTPASS_UI.Workflows[module] && FASTPASS_UI.Workflows[module][method]) {
            try {
                await FASTPASS_UI.Workflows[module][method]();
            } catch (e) {
                console.error("💥 Error en Workflow " + module + "." + method + ":", e);
                if (FASTPASS_UI.Eines && FASTPASS_UI.Eines.handleError) {
                    FASTPASS_UI.Eines.handleError(e, module + "." + method);
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
        if (!window.FASTPASS_UI.Eines.isJsxReady) return;
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
    FASTPASS_UI.Eines.callJSX('Animacio.x()').then(val => {
        const slider = document.getElementById('slider-move');
        if (slider && val && val !== "undefined" && val !== "") {
            const pxValue = Math.round(parseFloat(val) * 608);
            slider.value = pxValue;
        }
    });
};

setInterval(function () {
    // 🛑 BLOQUEO DE SEGURIDAD: 
    // Si el sistema está ocupado en un workflow (Guardando, Ingestando, etc), 
    // detenemos el refresco automático para evitar colisiones y errores 'null'.
    if ( window.FASTPASS_UI.State.isWorking) {
        return; 
    }

    if (FASTPASS_UI.Sync && FASTPASS_UI.Sync.updateSliderFromPremiere) {
        FASTPASS_UI.Sync.updateSliderFromPremiere();
    }
    
    if (FASTPASS_UI.Registry && FASTPASS_UI.Registry.poll) {
        FASTPASS_UI.Registry.poll();
    }
}, 500);

// Neteja de memòria al entrar amb el ratolí
window.onmouseenter = function () {
    FASTPASS_UI.Eines.callJSX('Sistema.clear()');
};

// Escalfament de rutes de xarxa
async function warmUpNetwork() {
    var config = FASTPASS_UI.Config.get();
    if (config.rutas) {
        console.log("🔥 [SYSTEM] Escalfant rutes de xarxa...");
        FASTPASS_UI.Eines.callJSX(`Arxiu.exists('${config.rutas.verticalitzacio.replace(/\\/g, '\\\\')}')`);
        FASTPASS_UI.Eines.callJSX(`Arxiu.exists('${config.rutas.chyrons.replace(/\\/g, '\\\\')}')`);
    }
};