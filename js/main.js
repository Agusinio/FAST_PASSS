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
// Últim clip objectiu detectat per Sync.syncKfMode (track@start@nom). Serveix per
// saber quan l'usuari canvia de clip i adoptar el mode (slider/keyframe) d'origen.
var lastKfClipId = "";
// Escala física del slider en PÍXELS: slider.min=-351, slider.max=959.
// seqW (amplada del frame) es guarda per convertir px <-> normalitzat.
var sliderSeqW = 608;

// ── 📊 PERF (FASE 0 · TEMPORAL 2026-09-16) ───────────────────────────────────
// Instrumentació del slider de reencuadre: quantes ordres s'envien, quant triga
// cada round-trip a ExtendScript, quantes queden en vola alhora i quant temps
// d'I/O de log es consumeix. NO altera el comportament (només mesura).
var _perf = {
    on: true,
    barridos: 0,
    nInput: 0, nSent: 0, nDescarts: 0, inFlight: 0, inFlightMax: 0,
    rtSum: 0, rtMin: 0, rtMax: 0, rtN: 0,
    tFirst: 0, tLastInput: 0, tRelease: 0, drainMs: -1,
    ticks: 0, ticksKf: 0, pollSkip: 0,
    timer: 0, id: 0
};
FASTPASS_UI.Sync._perf = _perf;

function _perfNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _perfBeginBarrido() {
    if (!_perf.on) return;
    if (_perf.timer) { clearTimeout(_perf.timer); _perf.timer = 0; }
    _perf.id++;
    _perf.barridos++;
    _perf.nInput = 0; _perf.nSent = 0; _perf.nDescarts = 0; _perf.inFlight = 0; _perf.inFlightMax = 0;
    _perf.rtSum = 0; _perf.rtMin = 0; _perf.rtMax = 0; _perf.rtN = 0;
    _perf.tLastInput = 0; _perf.tRelease = 0; _perf.drainMs = -1;
    _perf.ticks = 0; _perf.ticksKf = 0; _perf.pollSkip = 0;
    _perf.tFirst = _perfNow();
    if (window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils._perfReset) {
        window.FASTPASS_UI.Utils._perfReset();
    }
}

function _perfSendStart() {
    if (!_perf.on) return 0;
    _perf.nSent++;
    _perf.inFlight++;
    if (_perf.inFlight > _perf.inFlightMax) _perf.inFlightMax = _perf.inFlight;
    return _perfNow();
}

function _perfRecv(t0) {
    if (!_perf.on) return 0;
    var d = _perfNow() - t0;
    if (_perf.inFlight > 0) _perf.inFlight--;
    _perf.rtSum += d; _perf.rtN++;
    if (_perf.rtMin === 0 || d < _perf.rtMin) _perf.rtMin = d;
    if (d > _perf.rtMax) _perf.rtMax = d;
    return d;
}

function _perfReport() {
    if (!_perf.on) return;
    var U = window.FASTPASS_UI.Utils;
    var io = (U && U._ioStats) ? U._ioStats : { n: 0, ms: 0, maxMs: 0, bytes: 0, logN: 0, auditN: 0 };
    var js = (U && U._jsxStats) ? U._jsxStats : { n: 0, byPrefix: {}, other: 0 };
    var rtAvg = _perf.rtN ? (_perf.rtSum / _perf.rtN) : 0;
    // Vía d'escriptura detectada (cep_node / require / cep.fs síncron) — diagnòstic Fase 2.
    var fsKind = 'n/a';
    try { if (U && U._nodeFs) { U._nodeFs(); fsKind = U._fsKind || 'n/a'; } } catch(eFsk) {}
    var tEnd = _perf.tRelease || _perf.tLastInput || _perf.tFirst;
    var barrido = (_perf.tFirst && tEnd) ? ((tEnd - _perf.tFirst) / 1000) : 0;
    var top = [];
    for (var k in js.byPrefix) { top.push([k, js.byPrefix[k]]); }
    top.sort(function (a, b) { return b[1] - a[1]; });
    var jsxTxt = [];
    for (var i = 0; i < top.length && i < 6; i++) { jsxTxt.push(top[i][0] + '=' + top[i][1]); }
    if (js.other) jsxTxt.push('altres=' + js.other);
    U.forceLog('📊 [PERF·SLIDER #' + _perf.barridos + '] barrido=' + barrido.toFixed(2) + 's' +
        ' · inputs=' + _perf.nInput + ' · enviats=' + _perf.nSent + ' · descartats=' + _perf.nDescarts +
        ' · max_en_vola=' + _perf.inFlightMax +
        ' · rt_avg=' + rtAvg.toFixed(1) + 'ms (min ' + _perf.rtMin.toFixed(0) + ' / max ' + _perf.rtMax.toFixed(0) + ')' +
        ' · espera_total=' + (_perf.rtSum / 1000).toFixed(2) + 's' +
        ' · drenatge_final=' + (_perf.drainMs >= 0 ? _perf.drainMs.toFixed(0) + 'ms' : 'n/a') +
        ' · IO=' + io.n + ' escr ' + io.ms.toFixed(0) + 'ms (max ' + io.maxMs.toFixed(0) + ', BLOC ' + (io.blockMs || 0).toFixed(0) + 'ms, sync ' + (io.syncN || 0) + ' / async ' + (io.asyncN || 0) + ') ' + (io.bytes / 1048576).toFixed(2) + 'MB · FS=' + fsKind +
        ' · JSX=' + js.n + ' [' + jsxTxt.join(' · ') + ']' +
        ' · ticks500=' + _perf.ticks + ' (syncKfMode=' + _perf.ticksKf + ', poll_saltat=' + _perf.pollSkip + ')');
}

// 📊 FASE 0: accessos ràpids per a la consola del panell (F12 / clic dret → Inspect):
//   FASTPASS_UI.Sync._perf.report()   → torna a escriure l'informe de l'últim barrido
//   FASTPASS_UI.Sync._perf.reset()    → reinicia els comptadors
//   FASTPASS_UI.Sync._perf.on = false → atura la instrumentació
_perf.report = _perfReport;
_perf.reset = _perfBeginBarrido;

function setReframeActive(on) {
    reframeActive = on;
    var zone = document.getElementById('sliderZone');
    var slider = document.getElementById('slider-move');
    if (zone) zone.classList.toggle('active', on);
    if (slider) slider.disabled = !on;
    if (!on && window.FASTPASS_UI.State) window.FASTPASS_UI.State.isKeyframeMode = false;
    if (on) applySliderLimits();
    FASTPASS_UI.Utils.log(on ? "🎛️ Reencuadre manual ACTIVAT (actua sobre el clip SELECCIONAT)" : "🛑 Reencuadre manual desactivat", "DEBUG");
    // En activar, mostra el mode d'origen del clip objectiu (ja sincronitzat pel poll).
    if (on && window.FASTPASS_UI.State && FASTPASS_UI.Utils) {
        var kfMod = !!window.FASTPASS_UI.State.isKeyframeMode;
        FASTPASS_UI.Utils.status("Reencuadre actiu · mode " + (kfMod ? "KEYFRAME" : "SLIDER"), kfMod ? "exito" : "warn");
    }
    // Forçar una sincronització immediata del mode (el poll només corre amb reframe actiu).
    if (on && window.FASTPASS_UI.Sync && window.FASTPASS_UI.Sync.syncKfMode) {
        try { window.FASTPASS_UI.Sync.syncKfMode(); } catch (eSync) { }
    }
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

            // ── Detecció de motor JSX desactualitzat ─────────────────────────────
            // Si la carpeta de l'extensió té .jsx més nous que els que el motor va
            // carregar, es recarrega automàticament: així no cal reiniciar Premiere
            // cada cop que s'actualitza l'extensió.
            try {
                const bootRaw = await utils.callJSX("System.bootInfo()");
                const bootStamp = parseInt((JSON.parse(bootRaw || "{}")).stamp, 10) || 0;
                const diskStamp = parseInt(await utils.callJSX("System.jsxDiskStamp()"), 10) || 0;
                if (diskStamp > bootStamp + 1000) {
                    utils.log("🔄 [JSX] Extensió més nova que el motor (disk=" + diskStamp + " boot=" + bootStamp + "). Recarregant mòduls...", "INFO");
                    const rl = await utils.callJSX("System.reloadModules()");
                    utils.status("Motor JSX recarregat (" + rl + ")", "exito");
                } else {
                    utils.log("✅ [JSX] Motor al dia (disk=" + diskStamp + " boot=" + bootStamp + ")", "DEBUG");
                }
            } catch (eJsx) {
                utils.log("⚠️ [JSX] Comprovació de frescor fallida: " + eJsx.message, "DEBUG");
            }
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


    function applyLayoutMode(mode) {
        if (mode === 'work') {
            document.body.classList.add('mode-work');
        } else {
            document.body.classList.remove('mode-work');
        }
        window.FASTPASS_UI.LayoutMode = mode;
        // Persistir el mode: si no, en recarregar el panell torna a TEST i el botó
        // OUT deixa de disparar el pipeline de marcadors (s'ha de passar a TREBALL).
        try { localStorage.setItem('fastpass_v1_layout', mode); } catch (e) { }
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
        // (2026-09-16) TROSSEJA i REFRAME: botons eliminats del panell d'usuari.
        //  - TROSSEJA es fa dins del pipeline d'OUT & GO (Cut.runScene).
        //  - REFRAME (KF.runAutoReframe) no permet col·locar l'efecte de reencuadre.
        const btnPrevClip = document.getElementById('btnPrevClip');
        const btnNextClip = document.getElementById('btnNextClip');
        const btnKey = document.getElementById('btnKey');

        if (btnIn) btnIn.addEventListener('click', function () { console.log('🔘 Botón IN clickeado'); callWorkflow('Cut', 'runCutIn'); });
        if (btnOut) btnOut.addEventListener("click", function () { runOutHandler(); });
        if (btnPrevClip) btnPrevClip.addEventListener('click', function () { callWorkflow('Cut', 'runPrevClip'); });
        if (btnNextClip) btnNextClip.addEventListener('click', function () { callWorkflow('Cut', 'runNextClip'); });

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
            // ── 🚀 FASE 1 (2026-09-16): enviament coalescent (últim-gana) ────────
            // Mesura Fase 0: 105 inputs → 106 evalScript, fins a 25 en vola, rt_avg
            // 592 ms i 62,8 s d'espera acumulada per a un barrido de 4,5 s. Ara:
            //  · com a màxim 1 crida en vola (la resta espera),
            //  · els valors intermedis obsolets es DESCARTEN (només compta l'últim),
            //  · el COMMIT (isFinal) s'envia SEMPRE com a última operació del barrido.
            var slPending = null, slInFlight = false, slRaf = 0;

            var slSend = function (job) {
                slInFlight = true;
                var _t = _perfSendStart();                                 // 📊 FASE 0
                var script = job.final
                    ? `Anim.sliderApply(${job.norm}, true, ${kfMode()})`
                    : `Anim.sliderApply(${job.norm}, false)`;
                return FASTPASS_UI.Utils.callJSX(script).then(function (res) {
                    _perfRecv(_t);                                         // 📊 FASE 0
                    slInFlight = false;
                    var px = Math.round(job.norm * sliderSeqW);
                    if (job.final) {
                        _perf.drainMs = _perfNow() - (_perf.tRelease || _perfNow());   // 📊 FASE 0
                        // forceLog: salta el filtre de tema perquè el resultat (dx/crops del
                        // panRecorte) sempre aparegui al log de diagnòstic.
                        FASTPASS_UI.Utils.forceLog(`🎚️ Slider FINAL ${px}px → ${res}`);
                        // 📊 FASE 0: informe del barrido (2,5 s d'espera perquè dreni la cua).
                        if (_perf.on) {
                            var _myId = _perf.id;
                            if (_perf.timer) clearTimeout(_perf.timer);
                            _perf.timer = setTimeout(function () {
                                _perf.timer = 0;
                                if (_perf.id === _myId) _perfReport();
                            }, 2500);
                        }
                    } else {
                        FASTPASS_UI.Utils.log(`🎚️ Slider ${px}px → ${res}`, "DEBUG");
                    }
                    // Si ha arribat un valor nou mentre volava → s'envia ARA (només l'últim).
                    if (slPending) { slFlush(); }
                });
            };

            var slFlush = function () {
                slRaf = 0;
                if (slInFlight || !slPending) return;
                // Si el reencuadre s'ha desactivat pel camí, descarta els valors
                // intermedis (el COMMIT final sí que s'envia sempre).
                if (!reframeActive && !slPending.final) { slPending = null; return; }
                var job = slPending;
                slPending = null;
                slSend(job);
            };

            slider.oninput = function () {
                if (!reframeActive) return;
                if (!isUserDraggingSlider) _perfBeginBarrido();            // 📊 FASE 0
                isUserDraggingSlider = true;
                _perf.nInput++; _perf.tLastInput = _perfNow();             // 📊 FASE 0
                // El valor del slider ja és la X en PÍXELS → normalitzar (0..1)
                if (slPending) _perf.nDescarts++;                          // 📊 FASE 0: intermedi obsolet
                slPending = { norm: parseInt(slider.value, 10) / sliderSeqW, final: false };
                if (!slRaf) slRaf = requestAnimationFrame(slFlush);        // 🚀 FASE 1
            };

            slider.onchange = function () {
                if (!reframeActive) return;
                isUserDraggingSlider = false;
                _perf.tRelease = _perfNow();                               // 📊 FASE 0
                // En soltar: isFinal=true per fer el COMMIT (refresc) a Premiere.
                if (slPending) _perf.nDescarts++;                          // 📊 FASE 0
                slPending = { norm: parseInt(slider.value, 10) / sliderSeqW, final: true };
                if (slRaf) { cancelAnimationFrame(slRaf); slRaf = 0; }
                slFlush();                                                 // 🚀 FASE 1: COMMIT garantit
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
        // (2026-09-18) Botó 🎨 "Gráfica" → importador MAPA (ZZZ_GRAFISME → bin GRAF → V6).
        // ABANS: callWorkflow('Markers','placeGraphicMarkers') (F6·Gràfics de l'escaleta).
        if (btnMarksF6) btnMarksF6.addEventListener('click', () => callWorkflow('Mapa', 'run'));

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

        // --- BOTONS GRÀFICS (IPD, Doble Pantalla, MAPA, TOTEM, GRÀFICA/MAPA-GRAF) ---
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
                    // Guarda de temps: si l'API d'escaletes o el motor JSX no responen
                    // (xarxa/VPN), el botó no pot quedar-se penjat en "⏳ FOTO...".
                    // 45 s: el fetch fa un intent (curl --max-time 20 + marge).
                    // Guarda de temps: si l'API d'escaletes o el motor JSX no responen
        // (2026-09-17): 45 s era insuficient. El handshake TLS amb digition triga
        // ~26 s en aquesta xarxa, i la FOTO pot provar 2-3 candidats d'escaletaId
        // abans d'encertar -> cal marge per a 3 intents (~30 s cadascun).
        const FOTO_TIMEOUT_MS = 180000;
                    const result = await Promise.race([
                        reader.fetchNewEscaleta(
                            progData.escaletaId || null,
                            stateDateDir,
                            progData.archivo,
                            blocId,
                            folderDest
                        ),
                        new Promise(function (resolve) {
                            setTimeout(function () { resolve('__TIMEOUT__'); }, FOTO_TIMEOUT_MS);
                        })
                    ]);
                    if (result === '__TIMEOUT__') {
                        utils.log(`❌ [Fetch] Sense resposta de l'API d'escaletes (${FOTO_TIMEOUT_MS / 1000}s). Comprova la xarxa/VPN i torna-ho a provar.`, 'ERROR');
                        utils.status("FOTO: l'API no respon", 'error');
                        return;
                    }

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

                        // Forçar recàrrega del context (force=true per saltar el debounce
                        // de checkContext: la foto on_demand acabada de generar s'ha de
                        // detectar en aquest mateix instant, no en el següent poll).
                        if (window.FASTPASS_UI.Core && window.FASTPASS_UI.Core.Context) {
                            await window.FASTPASS_UI.Core.Context.checkContext({ force: true });
                        }
                    } else {
                        // El motiu REAL ja l'ha registrat EscaletaReader.fetchNewEscaleta al log
                        // (missatge/debugInfo de l'API de digition).
                        utils.log('❌ [Fetch] No s\'ha pogut obtenir la foto de l\'escaleta (mira el motiu de l\'API més amunt al log)', 'ERROR');
                        utils.status("FOTO: l'API no ha donat escaleta (mira el log)", 'error');
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
        // El mode de layout es recorda entre sessions: TREBALL és el de producció
        // (i el que fa que el botó OUT dispari el pipeline de marcadors).
        var savedMode = 'test';
        try { savedMode = localStorage.getItem('fastpass_v1_layout') || 'test'; } catch (e) { }
        applyLayoutMode(window.FASTPASS_UI.LayoutMode || savedMode);
        if (typeof sizeVideoToFit === 'function') sizeVideoToFit();
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
            ['Density (F4)',           () => callWorkflow('Assembly', 'snapFaroMarkers')],
            ['Ordre (F6)',             () => callWorkflow('Markers', 'enforceMarkerOrder')]
        ];
        utils.log('🚀 [PIPE] Marcadors post-OUT: ' + phases.map(p => p[0]).join(' → ') + '. Verifica els marcadors i usa COLOCAR per als chyrons.', 'INFO');
        // [2026-09-17] NOMES MARCADORS: si la V1 ja esta trocejada (>=2 clips) no tornem a
        // fer OUT ni TROSSEJA: nomes es re-col·loquen els marcadors (F1-F6). Es substitueix
        // la funcio de les dues primeres fases (l'array es const, pero els seus elements son
        // mutables), aixi el bucle de sota queda intacte.
        try {
            const nV1 = parseInt(await utils.callJSX("FASTPASS.Clips.count(1,'video')") || "0", 10) || 0;
            if (nV1 >= 2) {
                phases[0][1] = async function () { utils.log('   [PIPE] OUT omes (V1 ja trocejada)', 'INFO'); };
                phases[1][1] = async function () { utils.log('   [PIPE] TROSSEJA omes (V1 ja trocejada)', 'INFO'); };
                utils.log('   [PIPE] V1 ja te ' + nV1 + ' clips -> saltant OUT i TROSSEJA (nomes marcadors)', 'INFO');
            }
        } catch (eNV) { }

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
        // SNAPSHOT: deixar constància de COM han quedat els marcadors (posició,
        // comentari, color) abans que l'usuari els mogui a mà. Es desa a la carpeta
        // del projecte com a MARCADORS_<data>_<hora>.txt i .json.
        try {
            const MK = FASTPASS_UI.Workflows && FASTPASS_UI.Workflows.Markers;
            if (MK && MK.dumpMarkersSnapshot) {
                const nSnap = await MK.dumpMarkersSnapshot();
                if (typeof nSnap === 'number' && nSnap >= 0) {
                    utils.log('💾 [PIPE] Snapshot de marcadors desat (' + nSnap + ' marcadors) a la carpeta del projecte.', 'INFO');
                }
            }
        } catch (eSnap) {
            utils.log('⚠️ [PIPE] Snapshot de marcadors: ' + eSnap.message, 'WARN');
        }
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

        // ── IPD (auto): si hi ha algun marcador IPD (color turquesa=7) a la seqüència,
        //    repassa els clips del tram (des del marcador IPD fins al següent marcador
        //    d'estructura) i hi col·loca l'efecte de ZOOM + POSICIÓ (mecànica IPD aplicada,
        //    mai toggle: no reverteix els clips que ja tinguin l'efecte).
        let ipdMarkers = [];
        try {
            const markersRaw = await utils.callJSX('Markers.get()');
            try { ipdMarkers = JSON.parse(markersRaw || '[]'); } catch (eM) {}
        } catch (eI) {
            utils.log('⚠️ [CHY] No s\'ha pogut llegir els marcadors per revisar IPD: ' + eI.message, 'ERROR');
        }
        ipdMarkers = (ipdMarkers || []).filter(m => m && (m.color === 7 || String(m.comments || m.title || '').toUpperCase().indexOf('IPD') !== -1));
        if (ipdMarkers.length > 0) {
            utils.log(`🔎 [CHY] ${ipdMarkers.length} marcador(s) IPD detectat(s) (turquesa o títol amb IPD) → col·locant zoom+posició als clips del tram fins al següent estructural...`, 'INFO');
            try {
                await callWorkflow('Markers', 'runAplicarIpdDesdeMarkers');
            } catch (eI2) {
                utils.log('⚠️ [CHY] La revisió IPD ha llançat: ' + eI2.message, 'ERROR');
            }
        } else {
            utils.log('➖ [CHY] Sense marcadors IPD (turquesa o títol amb IPD): no cal revisar IPD.', 'INFO');
        }
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
            // Mode TEST: només el tancament clàssic. Avisem ben clar perquè el log
            // no deixi cap dubte de per què no s'han col·locat els marcadors.
            FASTPASS_UI.Utils.log('⚠️ [OUT] Mode TEST: només tancament (CUT OUT). El pipeline de marcadors ' +
                '(TROSSEJA → OnAir → Deduc → Prev → Correl → Density) només s\'executa en mode TREBALL (👤).', 'WARN');
            try { FASTPASS_UI.Utils.status('Mode TEST: només tancament — passa a 👤 TREBALL', 'warn'); } catch (eS) { }
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
    if (isUserDraggingSlider) { _perf.pollSkip++; return; }   // 📊 FASE 0
    // Llegeix la X del clip objectiu (el SELECCIONAT, o V1 sota CTI): Anim.sliderApply().
    FASTPASS_UI.Utils.callJSX('Anim.sliderApply()').then(val => {
        const slider = document.getElementById('slider-move');
        if (slider && val && val !== "undefined" && val !== "") {
            const norm = parseFloat(val);
            slider.value = Math.round(norm * sliderSeqW);   // normalitzat -> px
        }
    });
};

// 5. SINCRONITZACIÓ DEL MODE (SLIDER / KEYFRAME) AMB EL CLIP SELECCIONAT
FASTPASS_UI.Sync.syncKfMode = function () {
    if (!window.FASTPASS_UI.Utils || !window.FASTPASS_UI.Utils.isJsxReady) return;
    // 🚀 FASE 3 (2026-09-16): mentre s'arrossega el slider no es fa cap crida de
    // sincronització (competia a la mateixa cua d'ExtendScript: 15 Anim.modeInfo
    // per barrido). Es reprendrà al tick següent de deixar anar el slider.
    if (isUserDraggingSlider) { _perf.ticksKf++; return; }   // 📊 FASE 0
    // El clip objectiu (Anim.modeInfo) és el SELECCIONAT (o V1 sota CTI com a
    // fallback), el mateix sobre el qual actuen el slider i el botó KEYFRAME.
    FASTPASS_UI.Utils.callJSX('Anim.modeInfo()').then(function (raw) {
        if (!raw || raw === "null" || raw.indexOf("ERR") === 0) return;
        var o;
        try { o = JSON.parse(raw); } catch (eP) { return; }
        var clipId = (o.track || "") + "@" + (o.start || "") + "@" + (o.name || "");
        var kf = !!o.kf;
        if (clipId !== lastKfClipId) {
            // Ha canviat el clip → adoptem el mode "d'origen" d'aquest clip:
            // sense keyframes → mode SLIDER; amb keyframes → mode KEYFRAME.
            lastKfClipId = clipId;
            if (FASTPASS_UI.State) FASTPASS_UI.State.isKeyframeMode = kf;
            var nom = o.name ? (' "' + o.name + '"') : '';
            var trackTxt = o.track ? ("V" + o.track) : "?";
            FASTPASS_UI.Utils.log("🎬 Clip " + trackTxt + nom + " → mode " + (kf ? "KEYFRAME (té keyframes)" : "SLIDER (sense keyframes)"), "DEBUG");
            // El status només es mostra amb el reencuadre actiu (l'usuari està a la
            // zona del slider); així no pisa els missatges d'altres workflows.
            if (reframeActive) {
                FASTPASS_UI.Utils.status("Clip " + trackTxt + ": mode " + (kf ? "KEYFRAME" : "SLIDER"), kf ? "exito" : "warn");
            }
        } else if (FASTPASS_UI.State && kf !== !!FASTPASS_UI.State.isKeyframeMode) {
            // El mode del mateix clip ha canviat (s'ha afegit o eliminat un key).
            FASTPASS_UI.State.isKeyframeMode = kf;
        }
    });
};

// 6. DESACTIVAR EL REENCUADRE QUAN ES TOCA UN ALTRE CONTROL
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


/**
 * sizeVideoToFit: Dimensiona el visor de vídeo (9:16) perquè quedi pegat a la
 * columna de botons i es redueixi quan la vista es compacta.
 * Amplada = min(ample disponible, 9/16 de l'altura de la columna).
 */
function sizeVideoToFit(force) {
    try {
        var wrap = document.getElementById('srtVideoWrap');
        var zone = document.querySelector('.right-zone');
        var col = document.querySelector('.upper-left');
        if (!wrap || !zone || !col) return;
        var aw = zone.clientWidth;
        if (aw <= 0) return;
        /* 1) Alçada de la columna de controls. Només es mesura quan cal:
              - la primera vegada (normalment encara no hi ha vídeo), o
              - en redimensionar el panell (force).
              Mesurar obliga a treure el visor del flux i, amb un <video> carregat,
              qualsevol canvi de layout el deixa a mig pintar: és el parpadeig negre
              de la part inferior (passava cada 500 ms, també en pausa). */
        if (!wrap._fitAh) {
            var pW = wrap.style.width, pH = wrap.style.height;
            wrap.style.width = '10px';
            wrap.style.height = '0';
            wrap._fitAh = col.offsetHeight;
            wrap.style.width = pW;      // restaurar (no inventar 'auto'): el CSS mana
            wrap.style.height = pH;
        } else if (force) {
            var prevW = wrap.style.width, prevH = wrap.style.height;
            wrap.style.width = '10px';
            wrap.style.height = '0';
            wrap._fitAh = col.offsetHeight;
            wrap.style.width = prevW;
            wrap.style.height = prevH;
        }
        var ah = wrap._fitAh;
        if (!ah || ah <= 0) return;
        /* 2) Mida EXACTA en px enters (9:16). Amb aspect-ratio la alçada surt amb
              decimals i el compositor rasteritza el <video> a mig píxel: d'aquí
              surten les franges "mig negres". */
        var w = Math.min(aw, Math.floor(ah * 9 / 16));
        var h = Math.round(w * 16 / 9);
        // Si la mida calculada no ha canviat, NO tocar estils del visor:
        // reescriure width/height invalida el layout de la zona del <video>.
        if (wrap._fitW === w) return;
        wrap._fitW = w;
        wrap.style.width = w + 'px';
        wrap.style.height = h + 'px';
    } catch (e) { /* no crític */ }
}
window.addEventListener('resize', function () { sizeVideoToFit(true); });

// AUTO-REFRESC DE L'ESTAT D'ARRENCADA (cada 60 s)
// Mentre no tenim tot el necessari (escaleta llista, MP4/rètols pendents) el
// semàfor es recalcula sol: així l'usuari veu quan pot CREAR o ACTUALITZAR
// sense haver de tocar res. S'atura mentre el visor SRT reprodueix.
// NOTA: cada checkContext fa un escaneig COMPLET del NAS (escaleta + media +
// wotts + chyrons) amb crides JSX síncirones que BLOQUEGEN la UI del panell.
// Per això: (a) no se solapen (guard _ctxRefreshBusy) i (b) s'espacien a 60 s.
var _ctxRefreshBusy = false;
setInterval(async function () {
    var srA = window.FASTPASS_UI && FASTPASS_UI.Editor && FASTPASS_UI.Editor.SrtEditor;
    if (srA && (srA._isPlaying || srA._timelineRunning)) return;
    if (_ctxRefreshBusy) return;   // un escaneig en curs: no n'arrenquem un altre
    var ctA = window.FASTPASS_UI && window.FASTPASS_UI.Core && window.FASTPASS_UI.Core.Context;
    if (!ctA || !ctA.checkContext) return;
    // ── DATA DEL PROJECTE OBERT ─────────────────────────────────────────────
    // Si el projecte obert és d'un altre dia (ex: correcció d'AHIR), no hi
    // haurà cap fitxer nou d'aquell dia: no cal escanejar res (escaleta, media,
    // wotts). Si no hi ha cap projecte ancorat obert, tornem a la data del
    // sistema (HOY) perquè el botó principal pugui oferir CREAR el de avui.
    var StA = window.FASTPASS_UI.State;
    var regA = window.FASTPASS_UI.Registry;
    if (StA && StA.projectDateDir) {
        var activeA = regA ? regA.activeProjectName : null;
        if (!activeA) {
            StA.projectDateDir = null;
            StA.lastOpenedProjectName = "";
        } else if (StA.lastOpenedProjectName && activeA === StA.lastOpenedProjectName) {
            var todayA = (FASTPASS_UI.Utils.getFormattedDate() || '').replace(/["\s]/g, '').trim();
            if (todayA && StA.projectDateDir !== todayA) return;
        }
    }
    var stA = ctA._lastConclusion;
    var semA = (ctA._lastButtonData && ctA._lastButtonData.semaforo) || null;
    var pendA = !!(semA && (semA.mp4 === "pending" || semA.wot === "pending"));
    if (stA === "MASSA" || stA === "ESPERANT" || stA === null || pendA) {
        _ctxRefreshBusy = true;
        try { await ctA.checkContext(); } catch (eA) { } finally { _ctxRefreshBusy = false; }
    }
}, 60000);

setInterval(function () {
    if (isUserDraggingSlider) _perf.ticks++;   // 📊 FASE 0: ticks de 500 ms amb el slider arrossegant
    // Mentre el visor SRT està reproduint, NO es fa cap mesura de layout ni JSX
    // extern (Registry/slider/reframe): competirien amb el polling del cabezal
    // (250ms) i causarien talls al <video>. Fora de la reproducció es manté tot.
    var _sr = window.FASTPASS_UI && FASTPASS_UI.Editor && FASTPASS_UI.Editor.SrtEditor;
    var _visorRunning = !!(_sr && (_sr._isPlaying || _sr._timelineRunning));
    if (_visorRunning) return;
    sizeVideoToFit();
    // SLIDER / MODE KF: NOMES amb el reencuadre actiu (recuadro azul).
    // Fora d'aquest mode el slider esta desactivat i NO s'ha de fer cap crida JSX
    // de slider (Anim.sliderApply / Anim.modeInfo). Si el panell no te el focus
    // (l'usuari es a Premiere) el poll es pausa i el reencuadre s'apaga, per no
    // quedar sondejant en segon pla (cas real: 17 min de poll a 2 Hz).
    if (reframeActive) {
        if (!document.hasFocus()) {
            setReframeActive(false);
        } else {
            if (FASTPASS_UI.Sync && FASTPASS_UI.Sync.updateSliderFromPremiere) {
                FASTPASS_UI.Sync.updateSliderFromPremiere();
            }
            if (FASTPASS_UI.Sync && FASTPASS_UI.Sync.syncKfMode) {
                FASTPASS_UI.Sync.syncKfMode();
            }
        }
    }
    // Registry.poll es limita sol a 1 cicle cada 2 s (vegeu project_registry.js).
    // 🚀 FASE 3 (2026-09-16): tampoc no ha de competir amb la cua del slider mentre
    // s'arrossega (la mesura Fase 0 hi comptava Timeline.get / Context.list).
    if (!isUserDraggingSlider && FASTPASS_UI.Registry && FASTPASS_UI.Registry.poll) {
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
