/* ============================================================================
 * flow_mapa.js — Botó 🎨 "Gráfica" (grup GRF): importador MAPA
 *
 * (2026-09-18) Amb el clip a substituir SELECCIONAT al timeline (2026-09-22: la
 * REFERÈNCIA és el clip seleccionat, no el cabezal), aquest workflow ofereix 3 opcions:
 *   1) Importar el(s) fitxer(s) de la carpeta del dia que coincideixin amb el nom
 *      de l'ÍTEM D'ESCALETA on és el cabezal.
 *   2) Obrir el navegador de fitxers perquè l'usuari triï.
 *   3) Importar el coincident i, si no n'hi ha cap, obrir el navegador.
 *
 * Carpeta del dia: ...\ZZZ_GRAFISME\<DD MES>  (les subcarpetes són "17 SETEMBRE",
 * NO "2026_09_17" → cal traduir la data del projecte).
 * El material s'importa al BIN "GRAF" i es col·loca a la pista de grafismes, en ordre
 * d'escaleta, des de l'IN del clip seleccionat. Si no hi cap tot, es retallen els clips.
 * Ítem de referència: el del marcador anterior o en la posició del clip seleccionat.
 * ========================================================================== */
(function () {
    'use strict';

    window.FASTPASS_UI = window.FASTPASS_UI || {};
    var W = window.FASTPASS_UI.Workflows = window.FASTPASS_UI.Workflows || {};

    // ── Configuració ──────────────────────────────────────────────────────
    var GRAF_ROOT = '\\\\public.ad-ccrtv.local\\Public\\VERTICALITZACIO_INFORMATIUS\\ZZZ_GRAFISME';
    var GRAF_BIN = 'GRAF';
    // (2026-09-22) Mapa FINAL de pistes: GRAF/grafismes = fondos = V3 (v_graf/v_graficos),
    // congelat del tema-títol = V6 (v_tema). Es resolen des de la CONFIG a _flow()
    // (aquí només són el fallback si la configuració no respon).
    var TRACK_GRAF = 3;
    var TRACK_FREEZE = 6;
    var VIDEO_EXT = ['mov', 'mp4', 'mxf', 'm4v', 'avi', 'mts', 'm2t', 'wmv', 'r3d'];
    var MESOS = ['GENER', 'FEBRER', 'MARÇ', 'ABRIL', 'MAIG', 'JUNY',
        'JULIOL', 'AGOST', 'SETEMBRE', 'OCTUBRE', 'NOVEMBRE', 'DESEMBRE'];

    // ── Helpers de la casa: ressolts via FASTPASS_UI.Utils (com flow_chyrons.js).
    // OJO: callJSX / log / getClipsLogic NO existeixen com a globals → si s'usen
    // directament peta amb "callJSX is not defined".
    function U() { return window.FASTPASS_UI.Utils; }
    function L(msg, lvl) {
        try { U().log(msg, lvl || 'DEBUG'); }
        catch (e) { try { console.log(msg); } catch (e2) { } }
    }
    function callJSX(script) { return U().callJSX(script); }
    function getClipsLogic() { return window.FASTPASS_UI.Logic.Clips; }
    function stripExt(name) { return String(name || '').replace(/\.[^.]+$/, ''); }

    W.Mapa = {

        // ═══════════════════════════════════════════════════════════════
        // ENTRADA: comportament únic = OPCIÓ 3 (decidida amb l'usuari 18/09)
        //   Automàtic per coincidència de nom amb l'ítem del cabezal i, si no
        //   n'hi ha cap, obrir el navegador de fitxers. Sense cap finestra prèvia.
        // ═══════════════════════════════════════════════════════════════
        run: async function () {
            try {
                if (U() && U().validateActiveSequence && !(await U().validateActiveSequence())) return;
            } catch (e) { }
            await this._flow();
        },

        // ═══════════════════════════════════════════════════════════════
        // (2026-09-23) ENTRADA AUTOMÀTICA PER MARCADORS GROCS (F6·GF)
        // Repassa els marcadors GRÀFICS (color 4) del timeline, tria els que porten
        // GRAFISME ASSOCIAT (paraula clau al títol) i col·loca el fitxer corresponent de
        // la carpeta del dia AL TC DEL MATEIX MARCADOR (mateix criteri que el botó 🎨).
        // Si no hi ha coincidència de nom, obre el navegador de fitxers.
        // S'executa al FINAL del botó COLOCAR (després dels chyrons i de l'IPD).
        // ═══════════════════════════════════════════════════════════════

        /**
         * GRAF_KEYWORDS: paraules clau del títol del marcador que indiquen que aquell
         * marcador GROC porta un GRAFISME associat a la carpeta ZZZ_GRAFISME del dia.
         * (2026-09-23) Ampliable: afegir aquí els casos nous (p. ex. 'GF', 'INFOGRAFIA',
         * 'EVOLUCIO', 'PANORAMICA'…). La comparació és sense accents i en majúscules.
         */
        GRAF_KEYWORDS: ['MAPA'],

        runFromMarkers: async function () {
            try {
                if (U() && U().validateActiveSequence && !(await U().validateActiveSequence())) return;
            } catch (e) { }

            var cand = await this._grafCandidates();
            if (!cand.length) {
                L('➖ [MAPA·MARKS] Cap marcador amb grafisme associat (paraula clau: ' +
                    this.GRAF_KEYWORDS.join(', ') + ') → res a fer.');
                return;
            }
            L('🎨 [MAPA·MARKS] ' + cand.length + ' marcador(s) amb grafisme associat: ' +
                cand.map(function (c) { return c.num + '@' + c.time.toFixed(2) + 's'; }).join(', '));

            var folder = this._folderForDate(this._resolveDateDir());
            if (!folder) {
                L('⚠️ [MAPA·MARKS] No puc resoldre la carpeta del dia', 'WARN');
                U().status('MAPA: carpeta del dia no resolta', 'error');
                return;
            }
            this._applyTrackConfig();
            var files = await this._filesIn(folder);
            L('🎨 [MAPA·MARKS] Carpeta: ' + folder + ' · ' + files.length + ' fitxer(s) de vídeo');
            await this._runCandidates(cand, folder, files);
        },

        /**
         * _runCandidates: bucle de col·locació per a cada marcador candidat.
         * @param {Array}  cand   - [{ num, nombre, time, kw }]
         * @param {string} folder - carpeta del dia
         * @param {Array}  files  - fitxers de vídeo de la carpeta del dia
         */
        _runCandidates: async function (cand, folder, files) {
            var ok = 0, ko = 0;
            for (var i = 0; i < cand.length; i++) {
                var c = cand[i];
                try {
                    L('🎨 [MAPA·MARKS] ' + (i + 1) + '/' + cand.length + ' · ' + c.num + ' @ ' +
                        c.time.toFixed(2) + 's · "' + c.nombre + '" (clau ' + c.kw + ')');
                    var picked = this._match({ num: c.num, nombre: c.nombre }, files);
                    if (picked.length) {
                        L('   🎨 [MAPA·MARKS] Coincidències (' + picked.length + '): ' +
                            picked.map(function (f) { return f.name; }).join(', '));
                    } else {
                        L('   ⚠️ [MAPA·MARKS] Cap coincidència de nom → navegador de fitxers', 'WARN');
                        U().status('MAPA: tria el grafisme de ' + c.num, 'warn');
                        picked = await this._askFiles(folder);
                    }
                    if (!picked.length) { L('   ⏭️ [MAPA·MARKS] ' + c.num + ': sense fitxer → saltat', 'WARN'); ko++; continue; }

                    var items = await this._import(picked);
                    if (!items.length) { L('   ⏭️ [MAPA·MARKS] ' + c.num + ': importació fallida', 'ERROR'); ko++; continue; }

                    var ref = await this._refClipAt(c.time);
                    var freeze = await this._freezeUnderCti(c.time);
                    await this._placeClips(items, c.time, freeze, ref);
                    ok++;
                } catch (eC) {
                    L('   ⚠️ [MAPA·MARKS] ' + c.num + ' ha llançat: ' + eC.message, 'ERROR');
                    ko++;
                }
                await U().delay(200);
            }
            U().status('MAPA: ' + ok + ' grafisme(s) col·locat(s)' + (ko ? ' · ' + ko + ' sense fitxer' : ''),
                ok ? 'exito' : 'warn');
            try { await U().targetOnlyV1('MAPA·MARKS'); await U().focusV1('MAPA·MARKS'); } catch (eF) { }
        },

        /**
         * _grafCandidates: marcadors GROCS (color 4) amb paraula clau de grafisme al títol.
         * @returns {Promise<Array>} [{ num, nombre, time, kw, comments }]
         */
        _grafCandidates: async function () {
            var out = [];
            var mk = [];
            try {
                var raw = await callJSX('Markers.get()');
                mk = raw ? JSON.parse(raw) : [];
            } catch (eM) {
                L('⚠️ [MAPA·MARKS] No puc llegir els marcadors: ' + eM.message, 'WARN');
                return out;
            }
            for (var i = 0; i < mk.length; i++) {
                var m = mk[i];
                var cmt = String(m.comments || m.comment || '');
                var idx = cmt.indexOf(' -');
                if (idx <= 0) continue;                       // només "NN - Nom"
                var kw = this._keywordOf(cmt);
                if (!kw) continue;                            // sense paraula clau → no porta grafisme
                var t = (typeof m.time === 'number') ? m.time : parseFloat(m.time);
                if (!isFinite(t)) continue;
                // (2026-09-23) El COLOR NO és fiable al llegir-lo: en aquesta versió de
                // Premiere, Markers.get() retorna color = -1 (v. 8_Markers.jsx: `current.color`
                // peta i queda -1) tot i que el marcador s'hagi creat amb color=4. Per això el
                // filtre REAL és la PARAULA CLAU; el color només s'informa al log. Només es
                // descarta si el color és CONEGUT i no és el groc (4).
                if (m.color !== 4 && m.color !== -1 && m.color !== undefined && m.color !== null) {
                    L('   ⏭️ [MAPA·MARKS] "' + cmt.substring(0, 60) + '": clau ' + kw +
                        ' però color=' + m.color + ' (no GROC) → saltat', 'WARN');
                    continue;
                }
                if (m.color !== 4) {
                    L('   ℹ️ [MAPA·MARKS] "' + cmt.substring(0, 60) + '": color no disponible (' +
                        m.color + ') → es fa servir la paraula clau ' + kw);
                }
                out.push({
                    num: cmt.substring(0, idx).replace(/^\s+|\s+$/g, ''),
                    nombre: stripExt(cmt.substring(idx + 2).replace(/^\s+|\s+$/g, '')),
                    time: t, kw: kw, comments: cmt
                });
            }
            return out;
        },

        /**
         * _keywordOf: primera paraula clau de GRAF_KEYWORDS present al text (normalitzat).
         * @returns {string|null}
         */
        _keywordOf: function (text) {
            var norm = this._norm(text);
            for (var k = 0; k < this.GRAF_KEYWORDS.length; k++) {
                if (norm.indexOf(this.GRAF_KEYWORDS[k]) !== -1) return this.GRAF_KEYWORDS[k];
            }
            return null;
        },

        /**
         * _applyTrackConfig: llegeix de la CONFIG les pistes de grafismes i de congelat
         * i actualitza les variables del mòdul (TRACK_GRAF / TRACK_FREEZE).
         */
        _applyTrackConfig: function () {
            try {
                var cv = window.FASTPASS_UI.Config.get().tracks.video;
                if (cv && cv.graficos) TRACK_GRAF = cv.graficos;
                else if (cv && cv.graf) TRACK_GRAF = cv.graf;
                if (cv && cv.tematitol) TRACK_FREEZE = cv.tematitol;
                L('🗺️ [MAPA] Pistes de la config → GRAF=V' + TRACK_GRAF + ' · congelat=V' + TRACK_FREEZE);
            } catch (eCfg) {
                L('⚠️ [MAPA] no s\'ha pogut llegir la config de pistes: ' + eCfg.message, 'WARN');
            }
        },


        // (2026-09-18) _menu eliminat: comportament únic = OPCIÓ 3 (automàtic → navegador).

        // ═══════════════════════════════════════════════════════════════
        // FLUX PRINCIPAL
        // ═══════════════════════════════════════════════════════════════
        _flow: async function () {
            try {
                var cti = parseFloat(await callJSX('Timeline.get()') || '0');
                L('🗺️ [MAPA] Inici · CTI=' + cti.toFixed(2) + 's');

                // (2026-09-23) REFERÈNCIA = el MARCADOR: el seu TC és el PUNT D'ENTRADA del
                // grafisme. ABANS era el clip seleccionat (el material entrava al seu IN), cosa
                // que desalineava el grafisme respecte al marcador de l'ítem (petició d'usuari).
                // Marcador triat: l'últim amb time <= CTI (mateix criteri que _itemAtCti); si el
                // cabezal està damunt del marcador, és aquell. Fallback: sense marcadors es
                // manté el comportament antic (clip seleccionat).
                var mkRef = await this._itemAtCti(cti);
                var ref = null, refSec = null;
                if (mkRef) {
                    refSec = mkRef.time;
                    ref = await this._refClipAt(refSec);
                    L('🗺️ [MAPA] Referència = MARCADOR ' + mkRef.num + ' @ ' + refSec.toFixed(2) +
                        's ("' + mkRef.nombre + '")' +
                        (ref ? ' · espai hàbil fins ' + ref.end.toFixed(2) + 's (clip V' + ref.track + '[' + ref.index + '])' : ' · cap clip a V1 en aquest TC → espai hàbil desconegut'));
                } else {
                    ref = await this._resolveRefClip(cti);
                    if (!ref) {
                        L('⚠️ [MAPA] Ni marcador proper ni clip de referència → no es col·loca res. Posa el cabezal sobre un marcador o selecciona el clip a substituir.', 'WARN');
                        U().status('MAPA: posa el cabezal en un marcador', 'warn');
                        return;
                    }
                    refSec = ref.start;
                    L('🗺️ [MAPA] Cap marcador: referència = ' + ref.src + ' V' + ref.track + '[' + ref.index +
                        '] "' + ref.name + '" ' + ref.start.toFixed(2) + 's→' + ref.end.toFixed(2) + 's', 'WARN');
                }

                var dateDir = this._resolveDateDir();
                var folder = this._folderForDate(dateDir);
                if (!folder) {
                    L('⚠️ [MAPA] No puc resoldre la carpeta del dia (data projecte: "' + dateDir + '")', 'WARN');
                    U().status('MAPA: carpeta del dia no resolta', 'error');
                    return;
                }
                L('🗺️ [MAPA] Carpeta: ' + folder);

                // (2026-09-23) Pistes segons la CONFIG activa (mapa final de pistes):
                // grafismes → tracks.video.graficos (V3) · congelat → tracks.video.tematitol (V6).
                this._applyTrackConfig();

                // Ítem d'escaleta = el DEL MARCADOR de referència (ja resolt a mkRef); sense
                // marcador es fa servir l'ítem del marcador anterior a la posició de referència.
                var item = mkRef || await this._itemAtCti(refSec);
                if (!item || !item.nombre) {
                    L('⚠️ [MAPA] Cap ítem d\'escaleta associat al punt de referència', 'WARN');
                } else {
                    L('🗺️ [MAPA] Ítem de referència: "' + item.num + ' - ' + item.nombre + '"');
                }

                var files = await this._filesIn(folder);
                L('🗺️ [MAPA] ' + files.length + ' fitxer(s) de vídeo a la carpeta');

                // OPCIÓ 3 (única): automàtic i, si no hi ha cap coincidència, navegador.
                var picked = this._match(item, files);
                if (picked.length) {
                    L('🗺️ [MAPA] Coincidències (' + picked.length + '): ' +
                        picked.map(function (f) { return f.name; }).join(', '));
                } else {
                    L('🗺️ [MAPA] Cap coincidència de nom amb l\'ítem → navegador de fitxers', 'WARN');
                    picked = await this._askFiles(folder);
                }
                if (!picked.length) {
                    U().status('MAPA: res a importar', 'warn');
                    return;
                }

                var items = await this._import(picked);
                if (!items.length) { U().status('MAPA: importació fallida', 'error'); return; }

                // (18/09) ABANS de tocar la pista de grafismes: capturar el CONGELAT (PNG del
                // tema-títol) que hi ha sota el clip de referència. Després es replica a la
                // pista de congelat fins al final d'aquest clip.
                var freeze = await this._freezeUnderCti(refSec);

                await this._placeClips(items, refSec, freeze, ref);
                U().status('MAPA: ' + items.length + ' clip(s) a V' + TRACK_GRAF, 'exito');

                // (2026-09-21) Tornar la auto-selecció a V1: targeting només V1/A1 + clip de V1.
                try {
                    await U().targetOnlyV1('MAPA-GRAF');
                    await U().focusV1('MAPA-GRAF');
                } catch (eF) { L('⚠️ [MAPA] focus V1: ' + eF.message, 'WARN'); }
            } catch (e) {
                L('💥 [MAPA] ' + e.message, 'ERROR');
                try { U().handleError(e, 'Mapa'); } catch (e2) { }
            }
        },

        /**
         * _resolveDateDir: Data de treball (YYYY_MM_DD) amb fallbacks.
         * State.projectDateDir pot estar BUIT just després d'obrir el projecte (el poll
         * d'estat l'omple uns segons més tard) → si només s'hi confia, cal clicar 2 cops.
         *   1) State.projectDateDir (projecte obert)
         *   2) path del manifest carregat (…/<AAAA_MM_DD>/<fitxer>.fastpass.json)
         *   3) State.workTarget === 'yesterday' → dia natural anterior
         *   4) avui
         */
        _resolveDateDir: function () {
            var St = (window.FASTPASS_UI && window.FASTPASS_UI.State) ? window.FASTPASS_UI.State : null;
            if (St && St.projectDateDir) return St.projectDateDir;
            try {
                var cache = (window.FASTPASS_UI.SessionManifest && window.FASTPASS_UI.SessionManifest._cache) || {};
                var keys = Object.keys(cache);
                for (var i = 0; i < keys.length; i++) {
                    var m = String(keys[i]).match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
                    if (m) { L('🗺️ [MAPA] Data del projecte (via manifest): ' + m[0]); return m[0]; }
                }
            } catch (e) { }
            var d = new Date();
            if (St && St.workTarget === 'yesterday') d.setDate(d.getDate() - 1);
            var dd = ('0' + d.getDate()).slice(-2);
            var mm = ('0' + (d.getMonth() + 1)).slice(-2);
            var fb = d.getFullYear() + '_' + mm + '_' + dd;
            L('🗺️ [MAPA] Data del projecte (fallback): ' + fb, 'WARN');
            return fb;
        },

        // ═══════════════════════════════════════════════════════════════
        // CARPETA DEL DIA: 2026_09_17 → "17 SETEMBRE"
        // ═══════════════════════════════════════════════════════════════
        _folderForDate: function (dateDir) {
            var m = String(dateDir || '').match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
            if (!m) return null;
            var day = parseInt(m[3], 10);
            var month = parseInt(m[2], 10);
            if (day < 1 || day > 31 || month < 1 || month > 12) return null;
            return GRAF_ROOT + '\\' + day + ' ' + MESOS[month - 1];
        },

        // ═══════════════════════════════════════════════════════════════
        // CLIP DE REFERÈNCIA: el clip a SUBSTITUIR pel grafisme
        // (2026-09-22) El grafisme substitueix AQUEST clip: comença a la seva IN i ocupa
        // tot el seu rang. El cabezal sol (CTI) NO és la referència (era erroni).
        // ═══════════════════════════════════════════════════════════════
        /**
         * _selectedClip: Clip de VÍDEO seleccionat al timeline (àtom Clips.getSelectedVideo).
         * @returns {Promise<Object|null>} { track, index, name, start, end } o null
         */
        _selectedClip: async function () {
            try {
                var raw = await callJSX('Clips.getSelectedVideo()');
                if (!raw || raw === 'null' || String(raw).indexOf('ERR') === 0) return null;
                var s = JSON.parse(raw);
                if (typeof s.start !== 'number' || typeof s.end !== 'number') return null;
                return s;
            } catch (e) {
                L('⚠️ [MAPA] No puc llegir el clip seleccionat: ' + e.message, 'WARN');
                return null;
            }
        },

        /**
         * _resolveRefClip: resol el CLIP DE REFERÈNCIA (el que el grafisme substitueix).
         * (2026-09-22) Ordre de prioritat:
         *   1. Clip SELECCIONAT a la pista MP4 (`tracks.video.mp4`, V1) — el cas habitual:
         *      és el clip que l'operador té seleccionat a la posició del cabezal.
         *   2. Clip de la pista MP4 (V1) que CONTÉ el cabezal (si la selecció s'ha perdut).
         *   3. Qualsevol altre clip de vídeo seleccionat (altres pistes).
         * @param {number} cti - Posició del cabezal (s)
         * @returns {Promise<Object|null>} { track, index, name, start, end, src } o null
         */
        _resolveRefClip: async function (cti) {
            var tMp4 = 1;
            try { tMp4 = window.FASTPASS_UI.Config.get().tracks.video.mp4 || 1; } catch (eCfg) { }
            var sel = await this._selectedClip();

            // 1. Seleccionat a V1 (pista MP4)
            if (sel && sel.track === tMp4) { sel.src = 'clip SELECCIONAT a V' + tMp4; return sel; }

            // 2. Clip de V1 que conté el cabezal
            try {
                var clips = await getClipsLogic().getTrackClips(tMp4, 'video');
                for (var i = 0; i < clips.length; i++) {
                    var c = clips[i];
                    if (cti >= c.start - 0.001 && cti < c.end - 0.001) {
                        return {
                            track: tMp4, index: c.index, name: c.name, start: c.start, end: c.end,
                            src: 'V' + tMp4 + ' a la posició del cabezal (' + cti.toFixed(2) + 's)'
                        };
                    }
                }
                L('⚠️ [MAPA] Cap clip a V' + tMp4 + ' a la posició del cabezal (' + cti.toFixed(2) + 's)', 'WARN');
            } catch (e) {
                L('⚠️ [MAPA] No puc llegir V' + tMp4 + ': ' + e.message, 'WARN');
            }

            // 3. Qualsevol altra selecció de vídeo
            if (sel) { sel.src = 'clip SELECCIONAT a V' + sel.track + ' (no V' + tMp4 + ')'; return sel; }

            return null;
        },

        /**
         * _refClipAt: Clip de V1 (pista MP4) que CONTÉ la posició donada. Serveix per saber
         * el final de l'espai disponible del grafisme (no ha d'invair el clip següent) i
         * per limitar el congelat final.
         * @param {number} sec - posició al timeline (s)
         * @returns {Promise<Object|null>} { track, index, name, start, end, src } o null
         */
        _refClipAt: async function (sec) {
            var tMp4 = 1;
            try { tMp4 = window.FASTPASS_UI.Config.get().tracks.video.mp4 || 1; } catch (eCfg) { }
            try {
                var clips = await getClipsLogic().getTrackClips(tMp4, 'video');
                for (var i = 0; i < clips.length; i++) {
                    var c = clips[i];
                    if (sec >= c.start - 0.001 && sec < c.end - 0.001) {
                        return {
                            track: tMp4, index: c.index, name: c.name, start: c.start, end: c.end,
                            src: 'V' + tMp4 + ' a ' + sec.toFixed(2) + 's'
                        };
                    }
                }
                L('⚠️ [MAPA] Cap clip a V' + tMp4 + ' a ' + sec.toFixed(2) + 's', 'WARN');
            } catch (e) {
                L('⚠️ [MAPA] No puc llegir V' + tMp4 + ': ' + e.message, 'WARN');
            }
            return null;
        },

        // ═══════════════════════════════════════════════════════════════
        // ÍTEM D'ESCALETA A LA POSICIÓ DE REFERÈNCIA (marcador anterior o la posició)
        // ═══════════════════════════════════════════════════════════════
        _itemAtCti: async function (refSec) {
            var raw = await callJSX('Markers.get()');
            var markers = [];
            try { markers = raw ? JSON.parse(raw) : []; } catch (e) { }
            var best = null;
            for (var i = 0; i < markers.length; i++) {
                var m = markers[i];
                var t = (typeof m.time === 'number') ? m.time : parseFloat(m.time);
                if (!isFinite(t)) continue;
                var cmt = String(m.comments || '');
                var idx = cmt.indexOf(' -');
                if (idx <= 0) continue;                        // només "NN - Nom"
                var prefix = cmt.substring(0, idx).replace(/^\s+|\s+$/g, '');
                if (!/^\d/.test(prefix)) continue;
                if (t > refSec + 0.001) continue;              // només anteriors o a la posició de referència
                if (!best || t > best.time) {
                    best = { num: prefix, nombre: cmt.substring(idx + 2).replace(/^\s+|\s+$/g, ''), time: t };
                }
            }
            if (!best) return null;
            best.nombre = stripExt(best.nombre);
            return best;
        },

        // ═══════════════════════════════════════════════════════════════
        // NORMALITZACIÓ I COINCIDÈNCIA DE NOMS
        // ═══════════════════════════════════════════════════════════════
        _norm: function (s) {
            return String(s || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sense accents
                .toUpperCase()
                .replace(/\.[a-z0-9]{2,4}$/i, '')                    // sense extensió
                .replace(/[^A-Z0-9]+/g, ' ')                         // separadors → espai
                .replace(/^\s+|\s+$/g, '');
        },

        _filesIn: async function (folder) {
            var out = [];
            try {
                var utils = U();
                var list = await utils.readFolder(folder);            // UNC → via JSX
                for (var i = 0; i < list.length; i++) {
                    var n = list[i].name;
                    if (/^\./.test(n)) continue;                      // ocults
                    var ext = (n.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
                    if (VIDEO_EXT.indexOf(ext) === -1) continue;
                    out.push({ name: n, full: folder.replace(/[\\/]+$/, '') + '\\' + n, norm: this._norm(n) });
                }
            } catch (e) {
                L('⚠️ [MAPA] Error llegint la carpeta: ' + e.message, 'WARN');
            }
            return out;
        },

        /**
         * _match: files coincidents amb l'ítem del cabezal, en ordre d'escaleta.
         * Coincidència per contenció de tokens normalitzats (en tots dos sentits).
         */
        _match: function (item, files) {
            if (!item || !item.nombre || !files || !files.length) return [];
            var itemNorm = this._norm(item.nombre);
            if (itemNorm.length < 3) return [];
            var itemTokens = itemNorm.split(' ').filter(function (t) { return t.length > 2; });

            var hits = [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var hit = false;
                if (f.norm.indexOf(itemNorm) !== -1 || itemNorm.indexOf(f.norm) !== -1) {
                    hit = true;
                } else if (itemTokens.length) {
                    // tots els tokens significatius de l'ítem són al nom del fitxer
                    var all = true;
                    for (var t = 0; t < itemTokens.length; t++) {
                        if (f.norm.indexOf(itemTokens[t]) === -1) { all = false; break; }
                    }
                    hit = all;
                }
                if (hit) hits.push(f);
            }
            return hits;
        },

        /**
         * _askFiles: navegador de fitxers (CEP) apuntant a la carpeta del dia.
         */
        _askFiles: async function (folder) {
            var picked = [];
            try {
                if (!(window.cep && window.cep.fs && window.cep.fs.showOpenDialog)) {
                    L('⚠️ [MAPA] showOpenDialog no disponible', 'WARN');
                    return picked;
                }
                var r = window.cep.fs.showOpenDialog(true, false, 'MAPA — tria fitxers per importar',
                    folder, VIDEO_EXT);
                if (!r || r.err !== 0 || !r.data || !r.data.length) {
                    L('🗺️ [MAPA] Selecció cancel·lada');
                    return picked;
                }
                for (var i = 0; i < r.data.length; i++) {
                    var full = r.data[i];
                    var name = full.replace(/^.*[\\/]/, '');
                    picked.push({ name: name, full: full, norm: this._norm(name) });
                }
                L('🗺️ [MAPA] Triats manualment: ' + picked.length);
            } catch (e) {
                L('⚠️ [MAPA] Error al navegador de fitxers: ' + e.message, 'WARN');
            }
            return picked;
        },

        /**
         * _freezeUnderCti: CONGELAT que hi ha sota el CLIP DE REFERÈNCIA (el PNG/frame del
         * tema-títol de la pista de grafismes). Retorna { name, start, end } o null.
         * S'ha de llegir ABANS d'insertar el gràfic (després el clip que hi hauria sota la
         * referència seria el gràfic inserit).
         * El PNG de congelat s'ha d'estirar fins al FINAL D'AQUEST clip (no fins al final del
         * gràfic ni del clip del programa).
         */
        _freezeUnderCti: async function (refSec) {
            try {
                var clips = await getClipsLogic().getTrackClips(TRACK_GRAF, 'video');
                for (var i = 0; i < clips.length; i++) {
                    var c = clips[i];
                    if (refSec >= c.start - 0.001 && refSec < c.end - 0.001) {
                        var nm = c.name || c.mediaName || stripExt(c.mediaPath || '');
                        L('🗺️ [MAPA] Congelat a V' + TRACK_GRAF + ': "' + nm + '" @ ' +
                            c.start.toFixed(2) + '-' + c.end.toFixed(2) + 's');
                        return { name: nm, start: c.start, end: c.end };
                    }
                }
                L('⚠️ [MAPA] Cap clip a V' + TRACK_GRAF + ' sota el clip de referència → sense congelat a V' + TRACK_FREEZE, 'WARN');
            } catch (e) {
                L('⚠️ [MAPA] No puc llegir V' + TRACK_GRAF + ': ' + e.message, 'WARN');
            }
            return null;
        },

        // ═══════════════════════════════════════════════════════════════
        // IMPORTAR AL BIN "GRAF"
        // ═══════════════════════════════════════════════════════════════
        /**
         * _freezeGrafEnd: (2026-09-23) CONGELAT al final del clip de grafisme, amb la
         * mateixa mecànica que el congelat del Tema-Títol (_freezeTemaTitol, flow_chyrons.js):
         *   1. Insereix el grafisme en un TC temporal buit (10:00) per fer un snapshot NET.
         *   2. Mesura la seva durada i captura el SEU ÚLTIM FRAME (Render.snapshot).
         *   3. Esborra el clip temporal, importa el PNG al bin GRAF i l'insereix estirat des
         *      del final del grafisme: 3 s com a màxim, o menys si el clip de V1 acaba abans.
         * Així l'usuari pot estirar/retallar el congelat còmodament al timeline.
         * @param {string} gName - Nom del media del grafisme (al projecte)
         * @param {number} grafEnd - Final real del grafisme col·locat (s)
         * @param {number|null} endLimit - Final de l'espai hàbil (final del clip de V1) o null
         * @returns {Promise<Object>} { success, duration }
         */
        _freezeGrafEnd: async function (gName, grafEnd, endLimit) {
            var TEMP_TC = 600;        // 10:00:00 (mateixa tècnica que _freezeTemaTitol)
            var MAX_DUR = 3.0;        // (2026-09-23) congelat de 3 s per defecte
            var FRAME = 1 / 25;
            var utils = U();
            // (2026-09-23) Cabezal original: el snapshot del frame l'ha de moure al TC temporal
            // del grafisme, i al final s'ha de tornar exactament on era (petició d'usuari).
            var ctiOriginal = null;
            try {
                ctiOriginal = parseFloat(await callJSX('Timeline.get()') || '0');
            } catch (eCti) { L('⚠️ [MAPA·freeze] No puc llegir el cabezal: ' + eCti.message, 'WARN'); }
            try {
                // Durada: 3 s, o menys si el clip de V1 s'acaba abans.
                var dur = MAX_DUR;
                if (endLimit !== null && endLimit !== undefined) dur = Math.min(dur, endLimit - grafEnd);
                if (dur < 0.5) {
                    L('🗺️ [MAPA·freeze] Sense espai per al congelat (' + grafEnd.toFixed(2) + 's → ' +
                        (endLimit === null || endLimit === undefined ? '?' : endLimit.toFixed(2)) + 's) → no es col·loca');
                    return { success: false, duration: 0 };
                }

                // 1. Grafisme temporal a TC 10:00 (zona buida) per fer el snapshot net
                await callJSX("Clips.insert('" + utils.escape(gName) + "', " + TRACK_GRAF + ", " + TEMP_TC + ", null, 'video')");
                await utils.delay(300);

                // 2. Últim frame del grafisme (final real del clip temporal − 1 frame)
                var tmpEnd = await this._clipEndAt(TRACK_GRAF, TEMP_TC);
                if (tmpEnd === null) {
                    L('⚠️ [MAPA·freeze] No puc mesurar el grafisme temporal → sense congelat', 'WARN');
                    return { success: false, duration: 0 };
                }
                var snapTC = Math.max(TEMP_TC, tmpEnd - FRAME);
                await callJSX('Timeline.set(' + snapTC.toFixed(4) + ')');
                await utils.delay(400);

                var folder = await callJSX('Context.folder()');
                var snapPath = folder + '\\Snapshots\\freeze_graf_' + Date.now() + '.png';
                var snapRes = await callJSX("Render.snapshot('" + utils.escape(snapPath.replace(/\.png$/i, '')) + "', " + snapTC.toFixed(4) + ")");
                L('   📸 [MAPA·freeze] Render.snapshot → ' + snapRes);

                // 3. Treure el clip temporal de la pista de grafismes
                try {
                    var clipsT = await getClipsLogic().getTrackClips(TRACK_GRAF, 'video');
                    for (var i = 0; i < clipsT.length; i++) {
                        if (Math.abs(clipsT[i].start - TEMP_TC) < 0.5) {
                            await callJSX("Clips.removeAt(" + TRACK_GRAF + ", " + clipsT[i].start.toFixed(4) + ", 'video')");
                            L('   🗑️ [MAPA·freeze] Grafisme temporal eliminat (start=' + clipsT[i].start.toFixed(2) + 's)');
                            break;
                        }
                    }
                } catch (eRT) {
                    L('   ⚠️ [MAPA·freeze] No he pogut treure el temporal: ' + eRT.message, 'WARN');
                }

                if (!snapRes || String(snapRes).indexOf('OK') !== 0) {
                    L('   ❌ [MAPA·freeze] Snapshot fallit: ' + snapRes, 'ERROR');
                    return { success: false, duration: 0 };
                }

                // 4. Importar el PNG (al bin GRAF) i inserir-lo estirat des del final del grafisme.
                //    Premiere pot conservar o canviar l'extensió al nom de l'ítem → s'empareja
                //    pel nom normalitzat a la raïl del bin (mateix criteri que _import).
                var fileName = snapPath.split('\\').pop();
                await callJSX("IO.importFiles('" + utils.escape(JSON.stringify([snapPath])) + "', '" + GRAF_BIN + "')");
                var pngName = fileName;
                try {
                    var rawG = await callJSX("FASTPASS.Project.items('" + GRAF_BIN + "')");
                    var listG = rawG ? JSON.parse(rawG) : [];
                    var wantN = this._norm(stripExt(fileName));
                    for (var g2 = 0; g2 < listG.length; g2++) {
                        if (this._norm(listG[g2].name) === wantN) { pngName = listG[g2].name; break; }
                    }
                } catch (eG2) { }
                L('   📥 [MAPA·freeze] PNG al bin ' + GRAF_BIN + ': "' + pngName + '"');
                var fzEsc = utils.escape(pngName);
                await callJSX("Clips.insert('" + fzEsc + "', " + TRACK_GRAF + ", " + grafEnd.toFixed(4) + ", " + (grafEnd + dur).toFixed(4) + ", 'video')");
                // Clips.insert aplica l'endSec al darrer clip de la pista → fixar-lo per temps.
                await callJSX("Clips.endAt(" + TRACK_GRAF + ", " + grafEnd.toFixed(4) + ", " + (grafEnd + dur).toFixed(4) + ", 'video')");
                L('   🧊 [MAPA·freeze] Congelat "' + pngName + '" a V' + TRACK_GRAF + ' @ ' + grafEnd.toFixed(2) +
                    's → ' + (grafEnd + dur).toFixed(2) + 's (dur ' + dur.toFixed(2) + 's' +
                    (dur < MAX_DUR ? ' · limitat pel clip de V1' : '') + ')');
                return { success: true, duration: dur };
            } catch (eFz) {
                L('⚠️ [MAPA·freeze] ' + eFz.message, 'WARN');
                return { success: false, duration: 0 };
            } finally {
                // (2026-09-23) Retornar el cabezal a la seua posició ORIGINAL: el snapshot l'ha
                // hagut de moure al TC temporal del grafisme (10:00). Es fa sempre, també si el
                // congelat ha fallat, perquè l'usuari no perdi la vista on treballava.
                if (ctiOriginal !== null && isFinite(ctiOriginal)) {
                    try {
                        await callJSX('Timeline.set(' + ctiOriginal.toFixed(4) + ')');
                        L('   📍 [MAPA·freeze] Cabezal retornat a ' + ctiOriginal.toFixed(2) + 's');
                    } catch (eRC) {
                        L('   ⚠️ [MAPA·freeze] No he pogut tornar el cabezal: ' + eRC.message, 'WARN');
                    }
                }
            }
        },
        _import: async function (picked) {
            var out = [];   // [{ name: nom real al projecte, dur: segons (0 = desconegut) }]
            try {
                var utils = U();
                var paths = picked.map(function (f) { return f.full; });
                // 1. Bin GRAF (el crea si no existeix)
                await callJSX("FASTPASS.Project.bin('" + GRAF_BIN + "')");
                // 2. Ingesta amb el helper del projecte: escapa el payload i crida
                //    FASTPASS.IO.importFiles (el namespace correcte; NO és Project.*).
                await utils.importList(paths, GRAF_BIN);
                // 3. importFiles importa a l'ARREL del projecte. Premiere pot conservar
                //    l'extensió al nom de l'ítem, així que NO es pot suposar el nom:
                //    cal llegir la raíl i emparellar pel nom normalitzat.
                var rootItems = [];
                try {
                    var rawRoot = await callJSX("FASTPASS.Project.items('')");
                    rootItems = rawRoot ? JSON.parse(rawRoot) : [];
                } catch (eR) { rootItems = []; }
                for (var i = 0; i < picked.length; i++) {
                    var want = this._norm(stripExt(picked[i].name));
                    var real = null;
                    for (var k = 0; k < rootItems.length; k++) {
                        if (this._norm(rootItems[k].name) === want) { real = rootItems[k]; break; }
                    }
                    var realName = real ? real.name : stripExt(picked[i].name);
                    var dur = (real && real.duration > 0) ? real.duration : 0;
                    var mv = await callJSX("FASTPASS.Project.move('" + encodeURIComponent(realName) +
                        "', '" + encodeURIComponent(GRAF_BIN) + "')");
                    L('🗺️ [MAPA] "' + realName + '" → bin ' + GRAF_BIN + ' · ' + mv +
                        ' · dur=' + dur.toFixed(2) + 's');
                    out.push({ name: realName, dur: dur });
                }
            } catch (e) {
                L('⚠️ [MAPA] Error important: ' + e.message, 'WARN');
            }
            return out;
        },

        // ═══════════════════════════════════════════════════════════════
        // COL·LOCAR A V6 DES DEL CTI (amb retall proporcional si cal)
        // ═══════════════════════════════════════════════════════════════
        /**
         * _cleanupTrack: Elimina de una pista els clips el media dels quals coincideixi amb
         * algun dels noms donats (normalitzats). Imprescindible perquè cada execució del MAPA
         * hi deixava un joc nou de clips → al timeline es veiem "2 estats" alhora.
         */
        _cleanupTrack: async function (trackIdx, names) {
            var set = {};
            var n = 0;
            for (var i = 0; i < (names || []).length; i++) {
                if (names[i]) { set[this._norm(names[i])] = true; n++; }
            }
            if (n === 0) return 0;
            var removed = 0;
            try {
                var clips = await getClipsLogic().getTrackClips(trackIdx, 'video');
                for (var k = clips.length - 1; k >= 0; k--) {   // enrere → no renumerar
                    var c = clips[k];
                    var cn = c.name || c.mediaName || stripExt(c.mediaPath || '');
                    if (!set[this._norm(cn)]) continue;
                    var r = await callJSX("Clips.removeAt(" + trackIdx + ", " + c.start.toFixed(4) + ", 'video')");
                    L('🗺️ [MAPA] Neteja V' + trackIdx + ': "' + cn + '" @ ' + c.start.toFixed(2) + 's · ' + r);
                    removed++;
                }
            } catch (e) {
                L('⚠️ [MAPA] Error netejant V' + trackIdx + ': ' + e.message, 'WARN');
            }
            return removed;
        },

        /**
         * _clipEndAt: Final real (segons) del clip de la pista que comença a startSec.
         * Serveix per mesurar la durada natural del media inserit, perquè Premiere no
         * sempre reporta la durada mentre està ingesta.
         */
        _clipEndAt: async function (trackIdx, startSec) {
            try {
                var clips = await getClipsLogic().getTrackClips(trackIdx, 'video');
                for (var i = 0; i < clips.length; i++) {
                    if (Math.abs(clips[i].start - startSec) < 0.05) return clips[i].end;
                }
            } catch (e) { }
            return null;
        },

        /**
         * _placeClips: Insereix els grafismes a la pista GRAF des de la posició de referència.
         * (2026-09-22) La referència és el CLIP SELECCIONAT (`sel`): el material s'insereix
         * al seu IN i l'espai hàbil és el seu rang [start, end] (abans s'usava el cabezal
         * i el final del clip de V1 sota el CTI).
         *
         * @param {Array}  items  - [{ name, dur }] grafismes importats
         * @param {number} refSec - IN del clip de referència (s)
         * @param {Object} freeze - congelat { name, start, end } o null
         * @param {Object} ref    - clip de referència { track, index, name, start, end } o null
         */
        _placeClips: async function (items, refSec, freeze, ref) {
            // 1. Espai hàbil: el rang del CLIP DE REFERÈNCIA (o, si no n'hi ha, del clip de la
            //    pista MP4 que conté la posició de referència — comportament antic).
            var endLimit = null;
            if (ref && typeof ref.end === 'number') {
                endLimit = ref.end;
                L('🗺️ [MAPA] Espai hàbil = clip de referència V' + ref.track + '[' + ref.index + '] → ' +
                    refSec.toFixed(2) + 's→' + endLimit.toFixed(2) + 's');
            } else {
                try {
                    var clips = await getClipsLogic().getTrackClips(1, 'video');
                    for (var c = 0; c < clips.length; c++) {
                        if (refSec >= clips[c].start - 0.001 && refSec < clips[c].end - 0.001) { endLimit = clips[c].end; break; }
                    }
                } catch (e) { }
            }
            var space = (endLimit !== null) ? Math.max(0, endLimit - refSec) : null;
            L('🗺️ [MAPA] Espai hàbil: ' + (space === null ? 'desconegut' : space.toFixed(2) + 's'));

            // 2. Netejar restes d'execucions anteriors: cada clic hi deixava un joc nou de
            //    clips i al timeline es veien "2 estats" alhora (gràfic i PNG duplicats).
            var gNums = [];
            for (var g = 0; g < items.length; g++) gNums.push(items[g].name);
            await this._cleanupTrack(TRACK_GRAF, gNums);
            if (freeze && freeze.name) await this._cleanupTrack(TRACK_FREEZE, [freeze.name]);

            // 3. Inserir en ordre des del IN DEL CLIP DE REFERÈNCIA A DURADA NATURAL del
            //    media: NO forcem un endSec calculat (estirar-lo més enllà de la durada real
            //    dona clips falsos). Es mesura el clip inserit i, només si no cap a l'espai
            //    hàbil (el rang del clip seleccionat), es retalla.
            var t = refSec;
            var grafEnd = refSec;
            for (var p = 0; p < items.length; p++) {
                // (2026-09-22) insert NO-AUDIO: els grafismes (.mov/.mp4) porten pista
                // d'àudio i Premiere la col·locava enllaçada → sonava damunt del programa.
                var ins = await getClipsLogic().insertNoAudio(items[p].name, TRACK_GRAF, t, null);
                var res = ins.res;
                var realEnd = await this._clipEndAt(TRACK_GRAF, t);
                if (realEnd === null) {
                    L('⚠️ [MAPA] No puc mesurar el clip inserit a V' + TRACK_GRAF + ' → aturo', 'WARN');
                    break;
                }
                var clamped = false;
                if (space !== null && endLimit !== null && realEnd > endLimit + 0.01) {
                    var rE = await callJSX("Clips.endAt(" + TRACK_GRAF + ", " + t.toFixed(4) + ", " +
                        endLimit.toFixed(4) + ", 'video')");
                    L('🗺️ [MAPA] V' + TRACK_GRAF + ' retallat a l\'espai hàbil (' + realEnd.toFixed(2) +
                        ' → ' + endLimit.toFixed(2) + 's) [' + rE + ']');
                    realEnd = endLimit;
                    clamped = true;
                }
                L('🗺️ [MAPA] V' + TRACK_GRAF + ': "' + items[p].name + '" @ ' + t.toFixed(2) + 's → ' +
                    realEnd.toFixed(2) + 's (dur ' + (realEnd - t).toFixed(2) + 's)' +
                    (clamped ? ' [retallat]' : '') + ' [' + res + ']');
                t = realEnd;
                grafEnd = realEnd;
            }

            if (grafEnd <= refSec + 0.01) {
                L('⚠️ [MAPA] No s\'ha pogut inserir cap gràfic → no col·loco congelat', 'WARN');
                return;
            }

            // 4. CONGELAT (PNG del tema-títol) a la pista de congelat, entre l'inici del clip
            //    de referència i el final del GRÀFIC real inserit (no fins al final del clip
            //    del gràfic ni del clip del programa).
            if (freeze && freeze.name) {
                var fzEsc = U().escape(freeze.name);
                var fzEnd = grafEnd;
                var resF = await callJSX("Clips.insert('" + fzEsc + "', " + TRACK_FREEZE + ", " +
                    refSec.toFixed(4) + ", null, 'video')");
                // Clips.insert aplica l'endSec al darrer clip de la pista → fixar-lo per temps.
                var resFE = await callJSX("Clips.endAt(" + TRACK_FREEZE + ", " + refSec.toFixed(4) +
                    ", " + fzEnd.toFixed(4) + ", 'video')");
                L('🗺️ [MAPA] V' + TRACK_FREEZE + ' (congelat): "' + freeze.name + '" @ ' +
                    refSec.toFixed(2) + 's → ' + fzEnd.toFixed(2) + 's (final del gràfic de V' +
                    TRACK_GRAF + ') [insert=' + resF + ' · endAt=' + resFE + ']');
            } else if (!freeze) {
                L('⚠️ [MAPA] Sense congelat de referència → V' + TRACK_FREEZE + ' no es replica', 'WARN');
            }

            // 5. (2026-09-23) CONGELAT AL FINAL DEL GRAFISME: PNG de l'últim frame del
            //    grafisme (màxim 3 s, o menys si el clip de V1 acaba abans) perquè l'usuari
            //    el pugui estirar/retallar còmodament. Mateixa mecànica que el congelat del
            //    Tema-Títol (_freezeTemaTitol a flow_chyrons.js).
            try {
                var lastItem = items[items.length - 1];
                if (lastItem && lastItem.name) {
                    await this._freezeGrafEnd(lastItem.name, grafEnd, endLimit);
                }
            } catch (eFz) {
                L('⚠️ [MAPA] Congelat final del grafisme: ' + eFz.message, 'WARN');
            }
        }
    };

    L('🗺️ [Mapa] Mòdul inicialitzat (importador GRAF → pista de grafismes)');
})();



