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
// Escala física del slider en PÍXELS: slider.min=-351, slider.max=959.
// seqW (amplada del frame) es guarda per convertir px <-> normalitzat.
var sliderSeqW = 608;

function setReframeActive(on) {
    reframeActive = on;
    var zone = document.getElementById('sliderZone');
    var slider = document.getElementById('slider-move');
    if (zone) zone.classList.toggle('active', on);
    if (slider) slider.disabled = !on;
    if (!on && window.FASTPASS_UI.State) window.FASTPASS_UI.State.isKeyframeMode = false;
    if (on) applySliderLimits();
    FASTPASS_UI.Utils.log(on ? "🎛️ Reencuadre manual ACTIVAT (actua sobre el clip SELECCIONAT)" : "🛑 Reencuadre manual desactivat", "DEBUG");
}

/**
 * applySliderLimits: Ajusta el recorregut FÍSIC del slider al rang en píxels
 * del reencuadre horitzontal (min=-351 px, max=959 px). El valor del slider és
 * directament la posició X en PÍXELS (no una escala relativa), de manera que el
 * valor màxim físic del <input> és exactament 959 i el mínim -351 → no es pot
 * arrossegar més enllà ni provocar el "reset" del motor.
 */
function applySliderLimits() {
    var slider = document.getElementById('slider-move');
    if (!slider || !FASTPASS_UI.Utils) return;
    // Els límits es calculen sobre el clip SELECCIONAT (o V1 sota CTI si no n'hi ha).
    // Anim.sliderLimits incorpora la restricció dels recortes si el clip en té.
    FASTPASS_UI.Utils.callJSX('Anim.sliderLimits()').then(function (raw) {
        if (!raw || raw.indexOf("ERR") === 0) return;
        try {
            var lim = JSON.parse(raw);
            var minPx = parseFloat(lim.minPx), maxPx = parseFloat(lim.maxPx);
            var seqW = parseFloat(lim.seqW);
            var curPx = parseFloat(lim.curPx);
            if (!isFinite(minPx) || !isFinite(maxPx) || !isFinite(seqW)) return;

            // 🎯 Doble Finestra: ajust FI hardcodejat (±margen px) al voltant de la base
            // del PAS4 per a V2/V3. Evita que el moviment mostri la imatge de l'altra
            // finestra. Només s'aplica si la DF s'ha processat i hi ha clip SELECCIONAT
            // a V2 o V3 (el mateix criteri que decideix el comportament del slider).
            var base = (window.FASTPASS_UI && FASTPASS_UI._dfReencuadre) ? FASTPASS_UI._dfReencuadre : null;
            if (base && typeof base.margen === 'number') {
                FASTPASS_UI.Utils.callJSX('Clips.getSelectedVideo()').then(function (selRaw) {
                    var bx = null;
                    if (selRaw && selRaw !== "null") {
                        try {
                            var sel = JSON.parse(selRaw);
                            if (parseInt(sel.track, 10) === 2) bx = parseFloat(base.v2x);
                            else if (parseInt(sel.track, 10) === 3) bx = parseFloat(base.v3x);
                        } catch (eSel) {}
                    }
                    if (bx != null && isFinite(bx)) {
                        minPx = bx - parseFloat(base.margen);
                        maxPx = bx + parseFloat(base.margen);
                    }
                    _applySliderRange(minPx, maxPx, seqW, curPx);
                }).catch(function () { _applySliderRange(minPx, maxPx, seqW, curPx); });
            } else {
                _applySliderRange(minPx, maxPx, seqW, curPx);
            }
        } catch (e) { /* ignora */ }
    });

    function _applySliderRange(minPx, maxPx, seqW, curPx) {
        if (!slider) return;
        sliderSeqW = seqW;
        slider.min = Math.round(minPx);
        slider.max = Math.round(maxPx);
        // Posicionar el thumb a la X actual (px). Centre per defecte = seqW/2.
        var v = parseInt(slider.value, 10);
        if (isNaN(v) || !isFinite(curPx)) v = Math.round(seqW / 2);
        else v = Math.round(curPx);
        if (v < slider.min) slider.value = slider.min;
        else if (v > slider.max) slider.value = slider.max;
        else slider.value = v;
        // forceLog: salta el filtre de tema perquè el rang del slider sempre es vegi.
        FASTPASS_UI.Utils.forceLog("🎚️ Slider límits(px): " + Math.round(minPx) + ".." + Math.round(maxPx) + " cur=" + v + " seqW=" + seqW);
    }
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
        if (btnOut) btnOut.addEventListener("click", function () { runOutHandler(); });
        if (btnScene) btnScene.addEventListener('click', function () { callWorkflow('Cut', 'runScene'); });
        if (btnPrevClip) btnPrevClip.addEventListener('click', function () { callWorkflow('Cut', 'runPrevClip'); });
        if (btnNextClip) btnNextClip.addEventListener('click', function () { callWorkflow('Cut', 'runNextClip'); });

        if (btnCenter) {
            btnCenter.addEventListener('click', function () {
                if (FASTPASS_UI.Workflows.KF) FASTPASS_UI.Workflows.KF.runAutoReframe();
            });
        }
        if (btnKey) {
            btnKey.addEventListener('click', async function (ev) {
                // DIAGNÒSTIC: Ctrl+clic a KEY = probeRange (límit real de la Position)
                if (ev && (ev.ctrlKey || ev.metaKey)) {
                    if (FASTPASS_UI.Utils) {
                        FASTPASS_UI.Utils.log('🔬 [PROBE] Provant límit real de la Position al clip del CTI...', 'INFO');
                        try {
                            const pr = await FASTPASS_UI.Utils.callJSX('Anim.probeRange()');
                            FASTPASS_UI.Utils.log('🔬 [PROBE] RESULTAT: ' + pr, 'INFO');
                            try { alert('PROBE límit Position:\n\n' + pr); } catch (eAl) {}
                        } catch (ePr) {
                            FASTPASS_UI.Utils.log('🔬 [PROBE] Error: ' + ePr.message, 'ERROR');
                            try { alert('PROBE Error: ' + ePr.message); } catch (eAl2) {}
                        }
                    }
                    return;
                }
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

            // El slider actua sobre el clip SELECCIONAT (Anim.sliderApply ho decideix:
            // V1 sense recorte → x(); V2 sense recorte → posició normal;
            // clip amb recorte (V3 de la doble finestra) → PAN amb compensació).
            slider.oninput = function () {
                if (!reframeActive) return;
                isUserDraggingSlider = true;
                // El valor del slider ja és la X en PÍXELS → normalitzar (0..1)
                var norm = parseInt(slider.value, 10) / sliderSeqW;
                FASTPASS_UI.Utils.callJSX(`Anim.sliderApply(${norm}, false)`).then(res => {
                    FASTPASS_UI.Utils.log(`🎚️ Slider ${Math.round(slider.value)}px → ${res}`, "DEBUG");
                });
            };

            slider.onchange = function () {
                if (!reframeActive) return;
                isUserDraggingSlider = false;
                var norm = parseInt(slider.value, 10) / sliderSeqW;
                // En soltar: isFinal=true per fer el COMMIT (refresc) a Premiere.
                FASTPASS_UI.Utils.callJSX(`Anim.sliderApply(${norm}, true, ${kfMode()})`).then(res => {
                    // forceLog: salta el filtre de tema perquè el resultat (dx/crops del
                    // panRecorte) sempre aparegui al log de diagnòstic.
                    FASTPASS_UI.Utils.forceLog(`🎚️ Slider FINAL ${Math.round(slider.value)}px → ${res}`);
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
        const btnChyronColocar = document.getElementById('btnChyronColocar');
        if (btnChyronColocar) btnChyronColocar.addEventListener('click', () => runPlaceAllChyrons());

        // --- BOTONS GRÀFICS (IPD, Doble Pantalla, MAPA, TOTEM) ---
        const btnGrafIpd = document.getElementById('btnGrafIpd');
        const btnGrafDoblePantalla = document.getElementById('btnGrafDoblePantalla');
        const btnGrafMapa = document.getElementById('btnGrafMapa');
        const btnGrafTotem = document.getElementById('btnGrafTotem');
        if (btnGrafIpd) btnGrafIpd.addEventListener("click", function (ev) {
            if (ev && (ev.ctrlKey || ev.metaKey)) {
                callWorkflow("Markers", "runAplicarIpdDesdeMarkers");
            } else {
                callWorkflow("Graphics", "runIpd");
            }
        });
        if (btnGrafDoblePantalla) btnGrafDoblePantalla.addEventListener('click', (e) => callWorkflow('Graphics', 'runDoblePantalla', e));
        if (btnGrafMapa) btnGrafMapa.addEventListener('click', () => callWorkflow('Graphics', 'runMapa'));
        if (btnGrafTotem) btnGrafTotem.addEventListener('click', () => callWorkflow('Graphics', 'runTotem'));
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
                // [SRT 2026-09-04] El mecanisme d'emergencia (SRTs per blocs de 15 min)
                // passa a ser el mecanisme PRINCIPAL de CARREGAR (abans nomes amb Ctrl+clic).
                if (e && (e.ctrlKey || e.metaKey)) e.preventDefault();
                u.log("[SRT_CARREGAR] Carregant SRT (mecanisme principal: blocs de 15 min)...");
                if (window.SrtEditor && window.SrtEditor.loadEmergencySrt) {
                    await window.SrtEditor.loadEmergencySrt();
                } else {
                    u.status("Error: SrtEditor no disponible", "error");
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
            btnFetchEscaleta.addEventListener('click', async function (ev) {
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

                    // Ctrl+FOTO → foto de l'escaleta d'AHIR (per comparar/corregir el dia anterior).
                    const useYesterdayFoto = !!(ev && (ev.ctrlKey || ev.metaKey));
                    let fotoDateDir = useYesterdayFoto
                        ? utils.getYesterdayDateDir()
                        : utils.getFormattedDate().replace(/\"/g, "").trim();
                    try {
                        const coreCtx = window.FASTPASS_UI.Core && window.FASTPASS_UI.Core.Context;
                        if (coreCtx && coreCtx._targetDateDir && !useYesterdayFoto) {
                            fotoDateDir = coreCtx._targetDateDir();
                        }
                        const wt = (window.FASTPASS_UI.State && window.FASTPASS_UI.State.workTarget) || 'today';
                        utils.log('[Fetch] FOTO data de treball: ' + fotoDateDir + (useYesterdayFoto ? ' (Ctrl+FOTO = AHIR)' : ' (workTarget=' + wt + ')'), 'INFO');
                    } catch (eDate) {
                        utils.log('[Fetch] No s\'ha pogut resoldre la data de treball: ' + eDate.message, 'WARN');
                    }
                    if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                        window.FASTPASS_UI.State.dateDir = fotoDateDir;
                    }
                    const stateDateDir = fotoDateDir;
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

    /**
     * runFullPipelineOut: Marcadors del botó OUT en mode TREBALL.
     * Ordre: OUT (recorte i neteja), TROSSEJA, OnAir, Deduc, Prev, Correl,
     * Density. Els chyrons es col·loquen després (botó COLOCAR), un cop
     * l'usuari ha verificat els marcadors.
     */
    async function runFullPipelineOut() {
        const utils = FASTPASS_UI.Utils;
        const phases = [
            ['OUT · recorte i neteja', () => callWorkflow('Cut', 'runCutOut')],
            ['TROSSEJA',               () => callWorkflow('Cut', 'runScene')],
            ['OnAir (F1)',             () => callWorkflow('Markers', 'placeOnAirMarkers')],
            ['Deduc (F2)',             () => callWorkflow('Markers', 'placeDeducedOnAirMarkers')],
            ['Prev (F3)',              () => callWorkflow('Markers', 'placeScheduledMarkers')],
            ['Correl (F3.5)',          () => callWorkflow('Assembly', 'correlationSnapMarkers')],
            ['Density (F4)',           () => callWorkflow('Assembly', 'snapFaroMarkers')]
        ];
        utils.log('🚀 [PIPE] Marcadors post-OUT: ' + phases.map(p => p[0]).join(' → ') + '. Verifica els marcadors i usa COLOCAR per als chyrons.', 'INFO');
        for (const ph of phases) {
            const t0 = Date.now();
            utils.log('🔄 [PIPE] ' + ph[0] + '...', 'INFO');
            try {
                await ph[1]();
            } catch (e) {
                utils.log('⚠️ [PIPE] ' + ph[0] + ' ha llançat: ' + e.message, 'ERROR');
            }
            await utils.delay(350);
            utils.log('✅ [PIPE] ' + ph[0] + ' finalitzada (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)', 'INFO');
        }
        utils.log('🏁 [PIPE] Marcadors col·locats. Verifica la seqüència i prem COLOCAR per posar els chyrons.', 'INFO');
        utils.status('Marcadors col·locats — prem COLOCAR', 'exito');
    }

    /**
     * runPlaceAllChyrons: Col·loca TOTS els chyrons del bloc (botó COLOCAR).
     * Ordre: Conductor, Titol, Lloc, Nom, Resto, Traducció.
     */
    async function runPlaceAllChyrons() {
        const utils = FASTPASS_UI.Utils;
        const phases = [
            ['Conduct',   () => callWorkflow('Chyrons', 'placeChyronConductor')],
            ['Titol',     () => callWorkflow('Chyrons', 'placeChyronTitol')],
            ['Lloc',      () => callWorkflow('Chyrons', 'placeChyronLloc')],
            ['Nom',       () => callWorkflow('Chyrons', 'placeChyronNom')],
            ['Resto',     () => callWorkflow('Chyrons', 'placeChyronResto')],
            ['Traducció', () => callWorkflow('Chyrons', 'placeChyronTraduccio')]
        ];
        utils.log('🚀 [CHY] Col·locant TOTS els chyrons: ' + phases.map(p => p[0]).join(' → '), 'INFO');
        for (const ph of phases) {
            const t0 = Date.now();
            utils.log('🔄 [CHY] ' + ph[0] + '...', 'INFO');
            try {
                await ph[1]();
            } catch (e) {
                utils.log('⚠️ [CHY] ' + ph[0] + ' ha llançat: ' + e.message, 'ERROR');
            }
            await utils.delay(350);
            utils.log('✅ [CHY] ' + ph[0] + ' finalitzat (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)', 'INFO');
        }
        utils.log('🏁 [CHY] Tots els chyrons col·locats.', 'INFO');
        utils.status('Chyrons col·locats', 'exito');
    }

    /**
     * runOutHandler: Comportament del botó OUT segons el layout.
     *  - mode TEST: només el tancament clàssic (runCutOut), per poder provar les peces per separat.
     *  - mode TREBALL: dispara el pipeline complet automàtic.
     */
    async function runOutHandler() {
        const layoutMode = window.FASTPASS_UI.LayoutMode || 'test';
        if (layoutMode === 'work') {
            await runFullPipelineOut();
        } else {
            await callWorkflow('Cut', 'runCutOut');
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
    // Llegeix la X del clip objectiu (el SELECCIONAT, o V1 sota CTI): Anim.sliderApply().
    FASTPASS_UI.Utils.callJSX('Anim.sliderApply()').then(val => {
        const slider = document.getElementById('slider-move');
        if (slider && val && val !== "undefined" && val !== "") {
            const norm = parseFloat(val);
            slider.value = Math.round(norm * sliderSeqW);   // normalitzat -> px
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
