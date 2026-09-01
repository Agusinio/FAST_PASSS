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
var reframeActive = false;

function setReframeActive(on) {
    reframeActive = on;
    var zone = document.getElementById('sliderZone');
    var slider = document.getElementById('slider-move');
    if (zone) zone.classList.toggle('active', on);
    if (slider) slider.disabled = !on;
    if (!on && window.FASTPASS_UI.State) window.FASTPASS_UI.State.isKeyframeMode = false;
    if (on) applySliderLimits();
    FASTPASS_UI.Utils.log(on ? "🎛️ Reencuadre manual ACTIVAT" : "🛑 Reencuadre manual desactivat", "DEBUG");
}

/**
 * applySliderLimits: Ajusta els límits del slider de moviment lateral perquè
 * coincideixin amb les posicions màximes del clip sense que la imatge surti del
 * canvas. Els límits normalitzats (0..1, centre 0.5) provenen d'Anim.limits().
 */
function applySliderLimits() {
    var slider = document.getElementById('slider-move');
    if (!slider || !FASTPASS_UI.Utils) return;
    FASTPASS_UI.Utils.callJSX('Anim.limits()').then(function (raw) {
        if (!raw || raw.indexOf("ERR") === 0) return;
        try {
            var lim = JSON.parse(raw);
            var minNorm = parseFloat(lim.min), maxNorm = parseFloat(lim.max);
            if (!isFinite(minNorm) || !isFinite(maxNorm)) return;
            // Normalitzat (0..1, centre 0.5) -> escala del slider (-1000..1000)
            var sMin = Math.round((minNorm - 0.5) * 2000);
            var sMax = Math.round((maxNorm - 0.5) * 2000);
            slider.min = sMin;
            slider.max = sMax;
            var v = parseInt(slider.value, 10);
            if (isNaN(v)) v = Math.round((parseFloat(lim.cur) - 0.5) * 2000) || 0;
            if (v < sMin) slider.value = sMin;
            if (v > sMax) slider.value = sMax;
            FASTPASS_UI.Utils.log("🎚️ Slider límits(norm): " + lim.min.toFixed(3) + ".." + lim.max.toFixed(3) + " (slider " + sMin + ".." + sMax + ") cur=" + lim.cur.toFixed(3) + " margen=" + lim.margen.toFixed(3), "DEBUG");
        } catch (e) { /* ignora */ }
    });
}

// 2. ARRANQUE DEL SISTEMA (BOOTSTRAP SINCRO)
(async function () {
    console.log('🔴 MAIN.JS cargado');
    var utils = window.FASTPASS_UI ? window.FASTPASS_UI.Utils : null;
    
    try {
        // 1. Obtenemos la ruta nativa
        var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
        
        // 2. BLINDAJE TOTAL: 
        // Convertimos todas las barras a inclinadas / (formato URL/Unix)
        // Esto evita que Windows interprete \U o \T como caracteres especiales
        var safeRoot = extensionRoot.replace(/\\/g, "/");

        utils.log("📂 Ruta detectada: " + safeRoot, "DEBUG");

        // 3. LLAMADA QUIRÚRGICA:
        // Usamos comillas simples para el envoltorio y dobles para el contenido
        var result = await utils.callJSX('jsx_BOOTSTRAP("' + safeRoot + '")');

        if (result && result.indexOf("OK") !== -1) {
            window.FASTPASS_UI.Utils.isJsxReady = true; // 📍 ESTA LÍNEA ES VITAL
            utils.log("✅ Motor JSX montado con éxito.");
            //utils.isJsxReady = true;
            
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

    function logLayoutWidth() {
        var left = document.querySelector('.upper-left');
        var right = document.querySelector('.right-zone');
        var mainUpper = document.querySelector('.main-upper');
        if (!left) return;
        var lw = Math.round(left.getBoundingClientRect().width);
        var lh = Math.round(left.getBoundingClientRect().height);
        var rw = right ? Math.round(right.getBoundingClientRect().width) : 0;
        var rh = right ? Math.round(right.getBoundingClientRect().height) : 0;
        var tw = mainUpper ? Math.round(mainUpper.getBoundingClientRect().width) : 0;
        var msg = 'Columna: ' + lw + '×' + lh + 'px | Vídeo: ' + rw + '×' + rh + 'px | Total: ' + tw + 'px';
        console.log('📐 [LAYOUT] ' + msg);
        var info = document.getElementById('layoutInfo');
        if (info) info.textContent = '📐 ' + msg;
    }

    function applyLayoutMode(mode) {
        if (mode === 'work') {
            document.body.classList.add('mode-work');
        } else {
            document.body.classList.remove('mode-work');
        }
        window.FASTPASS_UI.LayoutMode = mode;
        var btnMode = document.getElementById('btnMode');
        if (btnMode) btnMode.textContent = (mode === 'work') ? '👤' : '🧪';
        FASTPASS_UI.Utils.log('🔀 Layout mode: ' + mode.toUpperCase(), 'INFO');
    }

    function initSplitter() {
        var splitter = document.getElementById('splitter');
        var left = document.querySelector('.upper-left');
        var right = document.querySelector('.right-zone');
        var mainUpper = document.querySelector('.main-upper');
        if (!splitter || !left || !right || !mainUpper) return;

        var dragging = false;
        splitter.addEventListener('mousedown', function (e) {
            e.preventDefault();
            dragging = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var rect = mainUpper.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var total = rect.width;
            var splitterW = splitter.getBoundingClientRect().width;
            var leftW = x - splitterW / 2;
            if (leftW < 80) leftW = 80;
            if (leftW > total - 120) leftW = total - 120;
            left.style.flex = '0 0 ' + leftW + 'px';
            right.style.flex = '1 1 auto';
        });
        var stop = function () {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            logLayoutWidth();
        };
        document.addEventListener('mouseup', stop);
    }

    function initPanel() {
        FASTPASS_UI.Utils.log("🚀 Vinculando botones...");

        // --- WORKFLOW: CUT ---
        const btnIn = document.getElementById('btnIn');
        console.log('🔍 btnIn:', btnIn);
        if (!btnIn) alert('❌ btnIn no encontrado en el DOM');
        const btnOut = document.getElementById('btnOut');
        const btnScene = document.getElementById('btnScene');
        const btnPrevClip = document.getElementById('btnPrevClip');
        const btnNextClip = document.getElementById('btnNextClip');
        const btnCenter = document.getElementById('btnCenter');
        const btnKey = document.getElementById('btnKey');

        if (btnIn) btnIn.addEventListener('click', function () { console.log('🔘 Botón IN clickeado'); callWorkflow('Cut', 'runCutIn'); });
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

        // --- SLIDER: MOVIMIENTO Y ANIMACIÓN (zona sensible toggle) ---
        const slider = document.getElementById('slider-move');
        const sliderZone = document.getElementById('sliderZone');
        if (slider && sliderZone) {
            sliderZone.addEventListener('click', function (e) {
                // El clic sobre el mateix slider (thumb) no ha de fer toggle
                if (e.target === slider) return;
                setReframeActive(!reframeActive);
            });

            var kfMode = function () {
                return !!(window.FASTPASS_UI.State && window.FASTPASS_UI.State.isKeyframeMode);
            };

            slider.oninput = function () {
                if (!reframeActive) return;
                isUserDraggingSlider = true;
                // Mapa slider (-1000..1000) -> posició normalitzada (0..1, centre 0.5)
                var norm = (parseInt(slider.value, 10) + 1000) / 2000;
                FASTPASS_UI.Utils.callJSX(`Anim.x(${norm}, false)`);
            };

            slider.onchange = function () {
                if (!reframeActive) return;
                isUserDraggingSlider = false;
                var norm = (parseInt(slider.value, 10) + 1000) / 2000;
                // Clava el keyframe només al soltar (si el mode KF està actiu)
                FASTPASS_UI.Utils.callJSX(`Anim.x(${norm}, ${kfMode()})`).then(res => {
                    if (res !== "OK") FASTPASS_UI.Utils.log("Slider: " + res, "DEBUG");
                });
            };
        }

        // --- WORKFLOW: MARCADORS (Fases independents) ---
        const btnMarksF1 = document.getElementById('btnMarksF1');
        const btnMarksF2 = document.getElementById('btnMarksF2');
        const btnMarksF3 = document.getElementById('btnMarksF3');
        const btnMarksF35 = document.getElementById('btnMarksF35');
        const btnMarksF4 = document.getElementById('btnMarksF4');
        const btnMarksF5 = document.getElementById('btnMarksF5');
        const btnMarksF6 = document.getElementById('btnMarksF6');

        if (btnMarksF1) btnMarksF1.addEventListener('click', () => callWorkflow('Markers', 'placeOnAirMarkers'));
        if (btnMarksF2) btnMarksF2.addEventListener('click', () => callWorkflow('Markers', 'placeDeducedOnAirMarkers'));
        if (btnMarksF3) btnMarksF3.addEventListener('click', () => callWorkflow('Markers', 'placeScheduledMarkers'));
        if (btnMarksF35) btnMarksF35.addEventListener('click', () => callWorkflow('Assembly', 'correlationSnapMarkers'));
        if (btnMarksF4) btnMarksF4.addEventListener('click', () => callWorkflow('Assembly', 'snapFaroMarkers'));
        if (btnMarksF5) btnMarksF5.addEventListener('click', () => callWorkflow('Markers', 'snapOrphanMarkers'));
        if (btnMarksF6) btnMarksF6.addEventListener('click', () => callWorkflow('Markers', 'placeGraphicMarkers'));

        // Botons ocults de moment (preservats per a ús futur):
        // const btnResetGrafs = document.getElementById('btnResetGrafs');
        // const btnPlaceGrafic = document.getElementById('btnPlaceGrafic');
        // const btnGraph169 = document.getElementById('btnPlaceGraph169');
        // const btnBg = document.getElementById('btnBg');
        // const btnPlaceStructure = document.getElementById('btnPlaceStructure');
        // const btnSetBlocIn = document.getElementById('btnSetBlocIn');
        // const btnSetBlocOut = document.getElementById('btnSetBlocOut');
        // if (btnResetGrafs) btnResetGrafs.addEventListener('click', () => callWorkflow('Retols', 'runResetGraphics'));
        // if (btnPlaceGrafic) btnPlaceGrafic.addEventListener('click', () => callWorkflow('Retols', 'runPlaceGraphic'));
        // if (btnGraph169) btnGraph169.addEventListener('click', () => callWorkflow('Retols', 'runPlaceGraph169'));
        // if (btnBg) btnBg.addEventListener('click', () => callWorkflow('Retols', 'runPlaceBackground'));
        // if (btnPlaceStructure) btnPlaceStructure.addEventListener('click', () => callWorkflow('Assembly', 'placeMarkers', 'estructura'));
        // if (btnSetBlocIn) btnSetBlocIn.addEventListener('click', () => callWorkflow('Assembly', 'runInOutCrudo'));
        // if (btnSetBlocOut) btnSetBlocOut.addEventListener('click', () => callWorkflow('Assembly', 'updateBlocOutFromCTI'));
        // // --- BOTONES DE ANÁLISIS (DEBUG MARCADORES) ---
        // const btnMarksCrudo = document.getElementById('btnMarksCrudo');
        // const btnInoutCocinado = document.getElementById('btnInoutCocinado');
        // const btnMarksCocinado = document.getElementById('btnMarksCocinado');
        // const btnCapturaUsuarioInOut = document.getElementById('btnCapturaUsuarioInOut');
        // const btnCapturaUsuarioMarks = document.getElementById('btnCapturaUsuarioMarks');
        // if (btnMarksCrudo) btnMarksCrudo.addEventListener('click', () => callWorkflow('Assembly', 'placeMarkers', 'crudo'));
        // if (btnInoutCocinado) btnInoutCocinado.addEventListener('click', () => callWorkflow('Assembly', 'runInOutCocinado'));
        // if (btnMarksCocinado) btnMarksCocinado.addEventListener('click', () => callWorkflow('Assembly', 'placeMarkers', 'cocinado'));
        // if (btnCapturaUsuarioInOut) btnCapturaUsuarioInOut.addEventListener('click', () => callWorkflow('Assembly', 'capturaUsuarioInOut'));
        // if (btnCapturaUsuarioMarks) btnCapturaUsuarioMarks.addEventListener('click', () => callWorkflow('Assembly', 'capturaUsuarioMarks'));

        // --- BOTONS CHYRONS (6 tipus independents via marcadors) ---
        const btnChyronTitol = document.getElementById('btnChyronTitol');
        const btnChyronConductor = document.getElementById('btnChyronConductor');
        const btnChyronLloc = document.getElementById('btnChyronLloc');
        const btnChyronNom = document.getElementById('btnChyronNom');
        const btnChyronTraduccio = document.getElementById('btnChyronTraduccio');
        const btnChyronResto = document.getElementById('btnChyronResto');

        if (btnChyronTitol) btnChyronTitol.addEventListener('click', () => callWorkflow('Chyrons', 'placeChyronTitol'));
        if (btnChyronConductor) btnChyronConductor.addEventListener('click', () => callWorkflow('Chyrons', 'placeChyronConductor'));
        if (btnChyronLloc) btnChyronLloc.addEventListener('click', () => callWorkflow('Chyrons', 'placeChyronLloc'));
        if (btnChyronNom) btnChyronNom.addEventListener('click', () => callWorkflow('Chyrons', 'placeChyronNom'));
        if (btnChyronTraduccio) btnChyronTraduccio.addEventListener('click', () => callWorkflow('Chyrons', 'placeChyronTraduccio'));
        if (btnChyronResto) btnChyronResto.addEventListener('click', () => callWorkflow('Chyrons', 'placeChyronResto'));
        const btnChyronRepartir = document.getElementById('btnChyronRepartir');
        if (btnChyronRepartir) btnChyronRepartir.addEventListener('click', () => callWorkflow('Chyrons', 'repartirChyronTraduccio'));
        // --- WORKFLOW: SRT EDITOR (SUBTÍTULOS) ---
        const btnSrtLoad = document.getElementById('btnSrtLoad');
        const btnSrtPlay = document.getElementById('btnSrtPlay');
        const btnSrtIn = document.getElementById('btnSrtIn');
        const btnSrtOut = document.getElementById('btnSrtOut');
        const btnSrtAdjust = document.getElementById('btnSrtAdjust');
        const btnSrtExport = document.getElementById('btnSrtExport');
        const btnSrtReset = document.getElementById('btnSrtReset');

        if (btnSrtLoad) {
            btnSrtLoad.addEventListener('click', async function (e) {
                const u = FASTPASS_UI.Utils;
                // Control+click → mode EMERGÈNCIA (SRTs per blocs de 15 min)
                if (e && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    u.log("🚨 SRT_CARREGAR: mode EMERGÈNCIA (Control+click)...");
                    if (window.SrtEditor && window.SrtEditor.loadEmergencySrt) {
                        await window.SrtEditor.loadEmergencySrt();
                    } else {
                        u.status("Error: SrtEditor no disponible", "error");
                    }
                    return;
                }
                u.log("📝 SRT_CARREGAR: Buscant .srt al directori del projecte...");
                try {
                    // Font única de veritat: el .srt que viu a la carpeta del projecte.
                    // (No es consulta el bin de Premiere perquè pot contenir .srt residuals
                    //  d'altres notícies/blocs importats anteriorment.)
                    const folder = await u.callJSX("Context.folder()");
                    if (!folder || folder === "" || folder.indexOf('ERR') === 0) {
                        u.status("No s'ha pogut obtenir la carpeta del projecte", "warn");
                        return;
                    }
                    const files = await u.readFolder(folder);
                    const srtFiles = (files || []).filter(function (f) {
                        // Excloure _MOD (exportacions de l'editor de subtítols) per carregar
                        // SEMPRE el .srt original de la sessió, no les modificacions antigues.
                        return f && f.name && f.name.toUpperCase().endsWith('.SRT')
                            && f.name.toUpperCase().indexOf('_MOD') === -1;
                    });
                    if (srtFiles.length === 0) {
                        u.status("No s'ha trobat .srt a la carpeta del projecte", "warn");
                        return;
                    }
                    const srtName = srtFiles[0].name;
                    const srtPath = folder.replace(/[\\/]+$/, '') + '\\' + srtName;
                    u.log("📝 SRT_CARREGAR: Trobat " + srtName);
                    u.log("📝 SRT_CARREGAR: Path = " + srtPath);
                    if (window.SrtEditor) {
                        await window.SrtEditor.loadSrt(srtPath);
                    } else {
                        u.status("Error: SrtEditor no disponible", "error");
                    }
                } catch(e) {
                    u.log("💥 SRT_CARREGAR: " + e.message);
                    u.status("Error carregant .srt", "error");
                }
            });
        }
        if (btnSrtPlay) btnSrtPlay.addEventListener('click', function () {
            if (window.SrtEditor) window.SrtEditor.togglePlay();
        });
        if (btnSrtIn) btnSrtIn.addEventListener('click', function () {
            if (window.SrtEditor) window.SrtEditor.applyIn();
        });
        if (btnSrtOut) btnSrtOut.addEventListener('click', function () {
            if (window.SrtEditor) window.SrtEditor.applyOut();
        });
        if (btnSrtAdjust) btnSrtAdjust.addEventListener('click', function () {
            if (window.SrtEditor) window.SrtEditor.applyAdjust();
        });
        if (btnSrtExport) btnSrtExport.addEventListener('click', function () {
            if (window.SrtEditor) window.SrtEditor.exportToPremiere();
        });
        if (btnSrtReset) btnSrtReset.addEventListener('click', function () {
            if (window.SrtEditor) window.SrtEditor.resetToOriginal();
        });

        // --- WORKFLOW: RENDER ---
        const btnRenderVideo = document.getElementById('btnRenderVideo');
        const btnRenderPortada = document.getElementById('btnRenderPortada');
        const btnRenderClose = document.getElementById('btnRenderClose');

        if (btnRenderVideo) btnRenderVideo.addEventListener('click', () => callWorkflow('Render', 'runVideo'));
        if (btnRenderPortada) btnRenderPortada.addEventListener('click', () => callWorkflow('Render', 'runPortada'));
        if (btnRenderClose) btnRenderClose.addEventListener('click', () => callWorkflow('Render', 'runClose'));

        // --- SETUP Y SELECTORES ---
        const btnSetup = document.getElementById('btnSetup');
        const selectPrograma = document.getElementById('programa');
        const selectBloc = document.getElementById('bloc');

        if (btnSetup) btnSetup.addEventListener('click', () => callWorkflow('Config', 'toggleSetup', true));

        // --- BOTÓ FER FOTO ESCALETA ---
        const btnFetchEscaleta = document.getElementById('btnFetchEscaleta');
        if (btnFetchEscaleta) {
            btnFetchEscaleta.addEventListener('click', async function () {
                const reader = window.FASTPASS_UI.EscaletaReader;
                const utils = window.FASTPASS_UI.Utils;
                if (!reader || !reader.fetchNewEscaleta) {
                    console.error('❌ EscaletaReader.fetchNewEscaleta no disponible');
                    return;
                }
                utils.log('📷 [Fetch] Sol·licitant foto actualitzada de l\'escaleta...', 'INFO');
                btnFetchEscaleta.innerText = '⏳ FOTO...';
                btnFetchEscaleta.disabled = true;

                try {
                    const config = window.FASTPASS_UI.Config.get();
                    const elProg = document.getElementById('programa');
                    const elBloc = document.getElementById('bloc');
                    if (!elProg || !elBloc || !elProg.value || elBloc.value === '---') {
                        utils.log('⚠️ [Fetch] Selecciona programa i bloc primer', 'WARN');
                        btnFetchEscaleta.innerText = '📷 FOTO';
                        btnFetchEscaleta.disabled = false;
                        return;
                    }
                    const progId = elProg.value;
                    const progData = config.mapeoProgramas[progId];
                    // escaletaId es opcional: si no ve de config, es dedueix per programa dins de fetchNewEscaleta
                    const blocId = elBloc.value;
                    const stateDateDir = (window.FASTPASS_UI.State && window.FASTPASS_UI.State.dateDir) || utils.getFormattedDate().replace(/"/g, "").trim();
                    const folderDest = config.rutas.destinoBase + progData.directorio + '/' + stateDateDir;

                    utils.log(`📷 [Fetch] Programa: ${progId}, Bloc: ${blocId}`, 'INFO');
                    const result = await reader.fetchNewEscaleta(
                        progData.escaletaId || null,
                        stateDateDir,
                        progData.archivo,
                        blocId,
                        folderDest
                    );

                    if (result) {
                        utils.log(`✅ [Fetch] Nova escaleta guardada: ${result.filename}`, 'INFO');
                        utils.status('Escaleta actualitzada! Recalculant...', 'exito');

                        // ─── REGENERAR MANIFEST DES DE LA CÒPIA LOCAL ──
                        // La extensió treballa amb la còpia de l'escaleta al directori
                        // del projecte. Després de generar una nova (botó FOTO), es
                        // regenera el manifest des de l'últim JSON del directori.
                        const ctxFoto = {
                            config: config,
                            progData: progData,
                            bloque: blocId,
                            dateDir: stateDateDir
                        };
                        if (window.FASTPASS_UI.Workflows && window.FASTPASS_UI.Workflows.MainButton
                            && window.FASTPASS_UI.Workflows.MainButton._rebuildManifestFromLocal) {
                            await window.FASTPASS_UI.Workflows.MainButton._rebuildManifestFromLocal(ctxFoto);
                        }

                        // Forçar recàrrega del context
                        if (window.FASTPASS_UI.Core && window.FASTPASS_UI.Core.Context) {
                            await window.FASTPASS_UI.Core.Context.checkContext();
                        }
                    } else {
                        utils.log('❌ [Fetch] No s\'ha pogut obtenir la foto de l\'escaleta', 'ERROR');
                        utils.status('Error obtenint foto escaleta', 'error');
                    }
                } catch (e) {
                    utils.log(`❌ [Fetch] Error: ${e.message}`, 'ERROR');
                } finally {
                    btnFetchEscaleta.innerText = '📷 FOTO';
                    btnFetchEscaleta.disabled = false;
                }
            });
        }
        // FIX A4: Els handlers 'change' de programa/bloc ja estan definits a
        // Context.init() (p.onchange / b.onchange). Eliminem els addEventListener
        // duplicats per evitar doble disparament i possibles race conditions.

        // --- INICIALIZACIÓN DE VALORES ---
        if (FASTPASS_UI.Config && FASTPASS_UI.Config.loadSelection) FASTPASS_UI.Config.loadSelection();

        const progInicial = document.getElementById('programa').value;
        if (progInicial && FASTPASS_UI.Core.Context.syncConductorUI) {
            FASTPASS_UI.Core.Context.syncConductorUI(progInicial);
        }

        // Inicialitzar SRT Editor
        if (window.SrtEditor) {
            window.SrtEditor.init();
            FASTPASS_UI.Utils.log("✅ SRT Editor inicialitzat");
        }

        callContextAudit();
        FASTPASS_UI.Utils.log("✅ TODOS LOS BOTONES VINCULADOS");
        initSplitter();
        var btnMode = document.getElementById('btnMode');
        if (btnMode) {
            btnMode.addEventListener('click', function () {
                var cur = window.FASTPASS_UI.LayoutMode || 'test';
                applyLayoutMode(cur === 'test' ? 'work' : 'test');
            });
        }
        applyLayoutMode(window.FASTPASS_UI.LayoutMode || 'test');
        logLayoutWidth();
        window.addEventListener('resize', logLayoutWidth);
    }

    async function callWorkflow(module, method, ...args) {
        console.log(`🔘 callWorkflow: ${module}.${method}`);
        if (FASTPASS_UI.Workflows[module] && FASTPASS_UI.Workflows[module][method]) {
            try {
                await FASTPASS_UI.Workflows[module][method](...args);
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
    if (!reframeActive) return;          // polling només amb el reencuadre actiu
    if (isUserDraggingSlider) return;
    FASTPASS_UI.Utils.callJSX('Anim.x()').then(val => {
        const slider = document.getElementById('slider-move');
        if (slider && val && val !== "undefined" && val !== "") {
            const norm = parseFloat(val);
            slider.value = Math.round((norm - 0.5) * 2000);   // 0..1 -> -1000..1000
        }
    });
};

// 5. DESACTIVAR EL REENCUADRE QUAN ES TOCA UN ALTRE CONTROL
document.addEventListener('click', function (e) {
    if (!reframeActive) return;
    var zone = document.getElementById('sliderZone');
    if (zone && !zone.contains(e.target)) {
        // No desactivar amb els controls de navegació ni KEYFRAME
        var keep = ['btnPrevClip', 'btnNextClip', 'btnKey'];
        var id = e.target && e.target.id;
        if (id && keep.indexOf(id) !== -1) return;
        setReframeActive(false);
    }
});

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