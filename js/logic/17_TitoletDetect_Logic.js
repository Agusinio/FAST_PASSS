/**
 * ============================================================================
 * LOGIC: TITOLET DETECT - v1.1.0 (2026-10-06)
 * Detecció del grafisme cremat (rètol mosquit) al MP4 cleanFeed
 * ============================================================================
 * Llegeix el MP4 cleanFeed, mesura QUAN surt el rètol TITOLET (color #F25F13)
 * i QUANT dura, i en llegeix el text per OCR per saber QUIN wott és.
 *
 * Receta validada a l'ítem 16 (12/12 wotts trobats):
 *   - ROI: X = tot l'ample, Y = 0,60-0,85 (mosquit de la part baixa).
 *   - Màscara de color #F25F13 ±25 per canal sobre el ROI escalat (rgb24).
 *   - Cobertura >= minCov (%) i bbox de la taca que NO toqui les vores del ROI
 *     (una taca que toca la vora = fons de grafisme, no text cremat).
 *   - Intervals agrupats per buit <= gapMergeSec, mínims minOn/minFrames.
 *   - OCR: UNA captura per interval, al frame de MÉS cobertura; si l'OCR no en
 *     treu res (o el text no casa amb cap wott pendent), es reintenta cap
 *     ENDAVANT dins de l'interval fins a `ocrTries` cops.
 *   - Match difús del text OCR contra el nom del wott (els accents poden fallar).
 *
 * 🔴 ESCANEIG ENDAVANT (2026-10-06, 3a passada; petició d'usuari):
 *   `planForItem` NO escaneja tota la finestra d'un cop: va per TRAMS
 *   (`scanChunkSec`) amb un cursor que NOMÉS AVANÇA. Quan un tram s'ha processat
 *   la cerca continua DES D'ALLÀ (mai es torna a rastrejar el que ja ha passat) i,
 *   si tots els wott ja estan assignats, S'ATURA (no escaneja la resta de l'ítem).
 *   L'escaneig i les captures fan servir `-ss` ABANS de `-i` (seek d'entrada):
 *   MESURAT 0,25-0,33 s per captura en comptes de 2,7-12,9 s (frame IDÈNTIC).
 *   El pla es desa en caché a `C:\temp\titolet_plan_<hash>.json` (`cfg.cache`).
 *
 * ZERO JSX nou: s'orquestra amb `Logic.FFmpeg` (ffmpeg/ffprobe) + IO.executeShell
 * + IO.readTxt + bin\ocr.ps1. Les decisions de negoci (llindars, intervals, WHICH)
 * viuen AQUÍ; el muscle (ffmpeg, OCR) només produeix dades.
 *
 * Les funcions de càlcul són PURES (accepten la sèrie de frames ja llegida) per
 * poder-les testejar headless amb `fp_titolet_test.html`.
 * ============================================================================
 */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s, o) => window.FASTPASS_UI.Utils.callJSX(s, o),
        log: (m, l) => window.FASTPASS_UI.Utils.log(m, l || 'INFO'),
        delay: (ms) => window.FASTPASS_UI.Utils.delay(ms)
    };

    /** _hexToRgb: '#F25F13' → {r,g,b} */
    function _hexToRgb(hex) {
        const h = String(hex || '').replace('#', '').trim();
        if (h.length !== 6) return { r: 242, g: 95, b: 19 };
        return {
            r: parseInt(h.substring(0, 2), 16),
            g: parseInt(h.substring(2, 4), 16),
            b: parseInt(h.substring(4, 6), 16)
        };
    }

    /**
     * _byteAt: accés uniforme al buffer de píxels. Accepta una string binària
     * (el que retorna `window.cep.fs.readFile`) o un Uint8Array (tests headless).
     */
    function _byteAt(buf, i) {
        return (typeof buf === 'string') ? (buf.charCodeAt(i) & 0xff) : buf[i];
    }

    /**
     * _analyzeFrame: mesura UN frame RGB24 del ROI.
     * cov = % de píxels que casen amb el color (±tol per canal) sobre el total del ROI.
     * edge = la taca toca alguna vora del ROI (marge minEdgeFrac) → es descarta.
     */
    function _analyzeFrame(buf, off, w, h, rgb, tol, minEdgeFrac, axes) {
        let count = 0;
        let x0 = w, x1 = -1, y0 = h, y1 = -1;
        for (let y = 0; y < h; y++) {
            const row = off + y * w * 3;
            for (let x = 0; x < w; x++) {
                const p = row + x * 3;
                const r = _byteAt(buf, p), g = _byteAt(buf, p + 1), b = _byteAt(buf, p + 2);
                if (Math.abs(r - rgb.r) <= tol && Math.abs(g - rgb.g) <= tol && Math.abs(b - rgb.b) <= tol) {
                    count++;
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }
        const cov = (count * 100) / (w * h);
        // `axes` diu QUINES vores desqualifiquen la taca:
        //   'y' (per defecte) = només dalt/baix. MESURAT amb dades reals (TN Migdia
        //     2026-10-05, roi_real.raw): el rètol TITOLET és una xinxeta ancorada a
        //     l'ESQUERRA del frame (x0 = 0 SEMPRE) → comprovar les vores X el descartava
        //     TOT (0 intervals). El que sí que delata un FONS de grafisme és que la taca
        //     ompli el ROI de dalt a baix.
        //   'xy' = les quatre vores (comportament estricte original) · 'none' = cap.
        const ax = axes || 'y';
        let edge = false;
        if (count > 0) {
            const mx = Math.max(1, Math.round(w * minEdgeFrac));
            const my = Math.max(1, Math.round(h * minEdgeFrac));
            const eX = (ax.indexOf('x') !== -1) && ((x0 < mx) || (x1 >= w - mx));
            const eY = (ax.indexOf('y') !== -1) && ((y0 < my) || (y1 >= h - my));
            edge = eX || eY;
        }
        return { cov: cov, x0: x0, x1: x1, y0: y0, y1: y1, edge: edge };
    }

    /**
     * analyzeFrameAt: mesura UN frame concret d'una sèrie rgb24 (cobertura, bbox i si
     * toca les vores). És l'eina per AJUSTAR la ROI amb dades reals (dry-run/log).
     */
    function analyzeFrameAt(buf, w, h, i, cfg) {
        const rgb = _hexToRgb(cfg.color);
        return _analyzeFrame(buf, i * w * h * 3, w, h, rgb,
            (cfg.tol != null) ? cfg.tol : 25,
            (cfg.minEdgeFrac != null) ? cfg.minEdgeFrac : 0.04,
            cfg.edgeAxes);
    }

    /**
     * analyzeSeries: recorre TOTS els frames del .raw (rgb24 encadenat) i en treu la
     * mètrica de cada mostra.
     * @param {string|Uint8Array} buf - buffer de tota la sèrie (frames seguits)
     * @param {number} w · @param {number} h - dimensions del ROI de cada frame
     * @param {Object} cfg - { color, tol, scanFps, minEdgeFrac, tStart }
     * @returns {Array<{i:number,t:number,cov:number,edge:boolean}>}
     */
    function analyzeSeries(buf, w, h, cfg) {
        const rgb = _hexToRgb(cfg.color);
        const tol = (cfg.tol != null) ? cfg.tol : 25;
        const fps = cfg.scanFps || 1;
        const tStart = (cfg.tStart != null) ? cfg.tStart : 0;
        const minEdgeFrac = (cfg.minEdgeFrac != null) ? cfg.minEdgeFrac : 0.04;
        const frameBytes = w * h * 3;
        const total = Math.floor((buf.length || 0) / frameBytes);
        const out = [];
        for (let i = 0; i < total; i++) {
            const m = _analyzeFrame(buf, i * frameBytes, w, h, rgb, tol, minEdgeFrac, cfg.edgeAxes);
            out.push({ i: i, t: tStart + i / fps, cov: Math.round(m.cov * 1000) / 1000, edge: m.edge });
        }
        return out;
    }

    /**
     * groupIntervals: converteix la sèrie de mostres en intervals ON (rètol visible).
     * Un frame és ON si cov >= minCov i !edge. S'hi fusiona tot buit <= (minOff+gapMergeSec)
     * i es descarten els intervals més curts que minOn o amb menys de `minFrames`
     * mostres ON (una sola mostra a 1 fps és soroll de rètol, no un rètol).
     * El rètol es considera viu fins a 1/scanFps després de l'última mostra ON.
     *
     * Cada interval porta `bestT`: l'instant de la mostra amb MÉS cobertura = el
     * frame on el rètol està més format (és el que s'envia a l'OCR; MESURAT: la
     * mostra d'entrada sovint encara té el mosquit a mig animar).
     * @returns {Array<{tIn:number,tOut:number,dur:number,maxCov:number,nFrames:number,bestT:number}>}
     */
    function groupIntervals(frames, cfg) {
        const minCov = (cfg.minCov != null) ? cfg.minCov : 2.0;
        const minOn = (cfg.minOn != null) ? cfg.minOn : 0.4;
        const minOff = (cfg.minOff != null) ? cfg.minOff : 1.0;
        const gapMerge = (cfg.gapMergeSec != null) ? cfg.gapMergeSec : 2.0;
        const maxCov = (cfg.maxCov != null) ? cfg.maxCov : 60;
        const minFrames = (cfg.minFrames != null) ? cfg.minFrames : 2;
        const fps = cfg.scanFps || 1;
        // 🔴 (2026-10-06) La finestra de fusió ha de ser MÉS GRAN que el període de mostreig:
        // si no, dues mostres ON CONSECUTIVES (a 1/fps) es consideraven «separades» i cada
        // mostra quedava com un interval d'1 sola mostra → `minFrames` els descartava tots
        // (cas detectat per l'arnés amb scanFps=1: 0 intervals amb 4 mostres ON seguides).
        const gapSplit = Math.max(minOff + gapMerge, (1 / fps) * 1.01);
        const raw = [];
        let cur = null, lastOn = null;
        for (let i = 0; i < frames.length; i++) {
            const f = frames[i];
            if (!((f.cov >= minCov) && (f.cov < maxCov) && !f.edge)) continue;
            if (cur && lastOn !== null && (f.t - lastOn) > gapSplit) { raw.push(cur); cur = null; }
            if (!cur) cur = { tIn: f.t, tOut: f.t, maxCov: f.cov, nFrames: 0, bestT: f.t };
            cur.tOut = f.t;
            cur.nFrames++;
            if (f.cov > cur.maxCov) { cur.maxCov = f.cov; cur.bestT = f.t; }
            lastOn = f.t;
        }
        if (cur) raw.push(cur);
        const kept = [];
        for (const iv of raw) {
            iv.tOut = Math.round((iv.tOut + 1 / fps) * 1000) / 1000;
            iv.dur = Math.round((iv.tOut - iv.tIn) * 1000) / 1000;
            iv.maxCov = Math.round(iv.maxCov * 100) / 100;
            if (iv.dur + 1e-9 >= minOn && iv.nFrames >= minFrames) kept.push(iv);
        }
        return kept;
    }

    // ─── PUR: text OCR → WHICH wott ─────────────────────────────────────────
    /** _normText: minúscules, sense accents ni signes, espais col·lapsats. */
    function _normText(s) {
        let t = String(s == null ? '' : s).toLowerCase();
        try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { }
        t = t.replace(/&/g, ' i ').replace(/[^a-z0-9]+/g, ' ');
        return t.replace(/\s+/g, ' ').trim();
    }

    /** _levRatio: similitud 0-1 (1 = iguals) basada en la distància de Levenshtein. */
    function _levRatio(a, b) {
        a = a || ''; b = b || '';
        if (a === b) return 1;
        if (!a.length || !b.length) return 0;
        const m = a.length, n = b.length;
        let prev = new Array(n + 1), cur = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            cur[0] = i;
            for (let j = 1; j <= n; j++) {
                const cost = (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            }
            const tmp = prev; prev = cur; cur = tmp;
        }
        return 1 - (prev[n] / Math.max(m, n));
    }

    /**
     * _wottTokens: parts "útils" del nom d'un wott per al match amb l'OCR (les que
     * poden ser el nom de la persona o del lloc del rètol). Descarta l'extensió, els
     * números purs i les parts de menys de 4 caràcters.
     */
    function _wottTokens(name) {
        const parts = String(name || '').replace(/\.[a-z0-9]+$/i, '').split(/[_\-]+/);
        const out = [];
        for (const p of parts) {
            const n = _normText(p);
            if (n.length >= 4 && !/^\d+$/.test(n) && out.indexOf(n) === -1) out.push(n);
        }
        return out;
    }

    /**
     * _scoreText: millor similitud d'un text OCR (per línies i sencer) contra un token.
     * @returns {{score:number, how:string}}  how: 'sub' (subcadena) | 'lev' (similitud)
     */
    function _scoreText(ocrText, token) {
        const lines = String(ocrText || '').split(/\r?\n/).map(_normText).filter(l => l.length > 1);
        const whole = _normText(ocrText);
        let best = 0, how = 'lev';
        for (const l of lines.concat([whole])) {
            if (l.indexOf(token) !== -1) return { score: 1, how: 'sub' };
            const sc = _levRatio(l, token);
            if (sc > best) { best = sc; how = 'lev'; }
        }
        return { score: best, how: how };
    }

    /**
     * pickWott: millor wott per a UN text OCR (diagnòstic; el pla usa assignIntervals).
     * @param {string} ocrText
     * @param {Array<string>} names
     * @param {Object} cfg
     * @param {Object|Array} [taken] - wotts JA assignats (map per índex o array): es
     *   descarten. Ho fa servir l'escaneig endavant per no repetir un wott.
     * @returns {{index:number, score:number, token:string, how:string}}
     */
    function pickWott(ocrText, names, cfg, taken) {
        const fuzz = (cfg && cfg.ocrFuzz != null) ? cfg.ocrFuzz : 0.55;
        const isTaken = (i) => !!(taken && (taken[i] === true || taken[i] === i + 1));
        let best = { index: -1, score: 0, token: '', how: 'sense-text' };
        if (_normText(ocrText).length < 3) return best;
        for (let i = 0; i < names.length; i++) {
            if (isTaken(i)) continue;
            for (const tk of _wottTokens(names[i])) {
                const s = _scoreText(ocrText, tk);
                if (s.score > best.score) best = { index: i, score: Math.round(s.score * 1000) / 1000, token: tk, how: s.how };
            }
        }
        if (best.score < fuzz) return { index: -1, score: best.score, token: best.token, how: best.how + '/sota-llindar' };
        return best;
    }

    /**
     * assignIntervals: assignació 1-a-1 interval ↔ wott (voraç per puntuació). Amb
     * empat guanya el més proper a la diagonal (els wotts i els intervals estan tots
     * dos en ordre cronològic/natural).
     * @returns {Array<{i:number,w:number,score:number,token:string,how:string}>}
     */
    /**
     * assignIntervals: assignació 1-a-1 interval ↔ wott (voraç per puntuació). Amb
     * empat guanya el més proper a la diagonal (els wotts i els intervals estan tots
     * dos en ordre cronològic/natural).
     *
     * 🔴 (2026-10-06, 5a passada) MATCH FEBLE AMB TEXT ALIÈ: si un interval té un text que
     * «és» d'un altre wott (millor puntuació), una parella FEBLE (score < `cfg.ocrWeak`) amb
     * un wott diferent NO s'accepta: el text és una RE-EMISSIÓ del rètol d'aquell altre wott.
     * Cas real (TNM V1 ítem 16, 06/10): l'interval de relIn 111 s deia «jung 2025 LEIRE DÍEZ»
     * (0,889 amb un altre wott) i el wott orfe «maig 2026 José Luis» — el ZAPATERO — s'hi va
     * emparellar amb 0,556 → la targeta va anar 10,5 s ABANS del seu lloc (l'interval bo, de
     * relIn 121,5 s, s'havia quedat sense OCR = sense wott).
     * @returns {Array<{i:number,w:number,score:number,token:string,how:string}>}
     */
    function assignIntervals(intervals, ocrTexts, names, cfg) {
        const fuzz = (cfg && cfg.ocrFuzz != null) ? cfg.ocrFuzz : 0.55;
        const weak = (cfg && cfg.ocrWeak != null) ? cfg.ocrWeak : 0.7;
        const cand = [];
        for (let i = 0; i < intervals.length; i++) {
            const txt = ocrTexts[i] || '';
            if (_normText(txt).length < 3) continue;
            const per = [];
            let bestW = -1, bestS = 0;
            for (let w = 0; w < names.length; w++) {
                let bs = 0, btok = '', bhow = 'lev';
                for (const tk of _wottTokens(names[w])) {
                    const s = _scoreText(txt, tk);
                    if (s.score > bs) { bs = s.score; btok = tk; bhow = s.how; }
                }
                per.push({ w: w, score: bs, token: btok, how: bhow });
                if (bs > bestS) { bestS = bs; bestW = w; }
            }
            for (const c of per) {
                if (c.score < fuzz) continue;
                if (c.w !== bestW && c.score < weak && bestS >= c.score + 0.1) continue;   // text d'un altre rètol
                cand.push({ i: i, w: c.w, score: c.score, token: c.token, how: c.how });
            }
        }
        // Desempat: (2026-10-06, 5a passada) ABANS guanyava el més proper a la diagonal
        // (|i−w|), que assumia que l'ordre dels wott és el de l'aire. Al cas real de l'ítem 16
        // l'ordre de l'aire és una ROTACIÓ de l'ordre dels wott → la diagonal emparellava
        // «octubre 2024 ÁLVARO» amb el wott de Carlos. Ara, amb la mateixa puntuació, mana el
        // wott MÉS ANTIC i, després, l'interval MÉS ANTIC: emparellament 1-a-1 en ordre
        // natural (mateix criteri que `pickWott`, que agafa el primer índex amb la millor
        // puntuació).
        cand.sort((a, b) => (b.score - a.score) || (a.w - b.w) || (a.i - b.i));
        const usedI = {}, usedW = {}, out = [];
        for (const c of cand) {
            if (usedI[c.i] || usedW[c.w]) continue;
            usedI[c.i] = true; usedW[c.w] = true;
            out.push(c);
        }
        return out;
    }

    /**
     * resolveOrphans: emparellar els wott que s'han quedat SENSE interval amb els intervals
     * que s'han quedat SENSE wott, PER ORDRE.
     *
     * (2026-10-06, 5a passada) L'OCR pot fallar en un interval (text buit) i el wott es queda
     * orfe → la cadena el posava al fallback (⛓️ encadenat al final) quan el seu interval era
     * deduïble: el wott NOMÉS pot caure entre els intervals dels wott veïns (l'ordre de
     * `names` és l'ordre de generació dels wott i, al cas real, coincideix amb el de l'aire).
     * Regles:
     *   · L'interval ha de ser DINS de la banda (després de l'interval del wott anterior
     *     assignat i abans del del posterior assignat).
     *   · Es descarten els intervals que són un TROS de la mateixa emissió que un interval ja
     *     assignat (contigus: tIn == tOut) i els que REPETEIXEN el seu text (re-emissió).
     *   · Si a la banda hi queda 1 candidat → assignat. Si n'hi ha uns quants, només s'accepta
     *     si EXACTAMENT UN no té text llegible (sense text = cap contradicció).
     * @param {Array} found - [{w, iv, text, score, token, how, tOcr}]
     * @param {Array} intervals - tots els intervals detectats
     * @param {Array<string>} names
     * @param {Array<string>} texts - text OCR de CADA interval (índex = interval)
     * @returns {{found:Array, notes:Array}} notes = [{w, ok, i?, cands?, prevI?, nextI?}]
     */
    function resolveOrphans(found, intervals, names, texts, cfg) {
        const usedI = {}, usedW = {}, wIv = {};
        const ivList = intervals || [], txtList = texts || [];
        for (const f of (found || [])) {
            const i = ivList.indexOf(f.iv);
            if (i >= 0) usedI[i] = true;
            usedW[f.w] = true;
            wIv[f.w] = i;
        }
        // Intervals NO assignables: trossos de la mateixa emissió i re-emissions (text repetit)
        const blocked = {};
        for (const k in usedI) {
            const iv0 = ivList[k], t0 = _normText(txtList[k] || '');
            for (let j = 0; j < ivList.length; j++) {
                if (usedI[j] || blocked[j]) continue;
                const iv = ivList[j];
                if (Math.abs(iv.tIn - iv0.tOut) < 0.05 || Math.abs(iv0.tIn - iv.tOut) < 0.05) { blocked[j] = 'tros'; continue; }
                if (t0.length >= 3 && _normText(txtList[j] || '') === t0) blocked[j] = 'reemissio';
            }
        }
        const out = (found || []).slice(), notes = [];
        for (let w = 0; w < (names || []).length; w++) {
            if (usedW[w]) continue;
            let prevI = -1, nextI = Infinity;
            for (let k = w - 1; k >= 0; k--) { if (wIv[k] != null && wIv[k] >= 0) { prevI = wIv[k]; break; } }
            for (let k = w + 1; k < names.length; k++) { if (wIv[k] != null && wIv[k] >= 0) { nextI = wIv[k]; break; } }
            const cands = [];
            for (let j = 0; j < ivList.length; j++) {
                if (usedI[j] || blocked[j]) continue;
                if (j <= prevI || j >= nextI) continue;
                cands.push(j);
            }
            const noTxt = cands.filter(j => _normText(txtList[j] || '').length < 3);
            let pick = null;
            if (cands.length === 1) pick = cands[0];
            else if (noTxt.length === 1) pick = noTxt[0];
            if (pick === null) { notes.push({ w: w, ok: false, cands: cands, prevI: prevI, nextI: (nextI === Infinity ? null : nextI) }); continue; }
            usedI[pick] = true; usedW[w] = true; wIv[w] = pick;
            out.push({
                w: w, iv: ivList[pick], text: txtList[pick] || '', score: 0,
                token: '', how: 'ordre', tOcr: ivList[pick].bestT
            });
            notes.push({ w: w, ok: true, i: pick });
        }
        return { found: out, notes: notes };
    }

    /**
     * buildPlan: pla de la cadena TITOLET a partir dels intervals detectats + l'OCR.
     * @param {Object} p - { intervals, ocrTexts, names, tItemStart, cfg }
     * @returns {{cards:Array, assign:Array, stats:Object}}
     *   cards[k] (k = posició del wott dins de `names`):
     *     { wott, found, on, relIn, relOut, kind, score, token, maxCov, how, txt }
     *     kind = 'short' (on <= longOnSec) · 'long' (> longOnSec) · 'none' (sense detecció).
     */
    function buildPlan(p) {
        const cfg = p.cfg || {};
        const names = p.names || [];
        const intervals = p.intervals || [];
        const ocrTexts = p.ocrTexts || [];
        const t0 = p.tItemStart || 0;
        const assign = assignIntervals(intervals, ocrTexts, names, cfg);
        const found = assign.map(a => ({
            w: a.w, iv: intervals[a.i], text: ocrTexts[a.i] || '',
            score: a.score, token: a.token, how: a.how, tOcr: intervals[a.i].bestT
        }));
        // (5a passada) Els wott orfes s'emparellen amb els intervals que han quedat sense
        // wott (PER ORDRE) abans de muntar les targetes — vegeu `resolveOrphans`.
        const ro = resolveOrphans(found, intervals, names, ocrTexts, cfg);
        return composePlan(ro.found, intervals, names, t0, cfg, ocrTexts, ro.notes);
    }

    // ─── Muscle: ffmpeg + OCR (orquestració; aquí SÍ que hi ha IO) ──────────

    /**
     * _readBinary: llegeix un fitxer binari pur (.raw rgb24) des del costat JS i en
     * retorna els BYTES EXACTES.
     *
     * ⚠️ (2026-10-06, FIX) `cep.fs.readFile(path)` SENSE encoding descodifica el fitxer
     * com a UTF-8 i el destrueix: els bytes >= 0x80 es fusionen en U+FFFD. MESURAT amb
     * el clip real (TNM V1 2026-10-05, sèrie 160x45, 12 s):
     *     259.200 bytes → 256.050 caràcters (el JS veia 11 mostres en lloc de 12) i la
     *     cobertura del rètol passava de 17,44 % (real) a 7,97 / 10,69 / 4,25 / 14,08 %
     *     → intervals falsos o perduts.
     * Solució: demanar Base64 i decodificar amb `atob` (mateix patró que
     * `WaveformGenerator.loadPeaksFromBin` de 10_Srt_Logic.js).
     *
     * @param {string} path
     * @returns {Uint8Array|null} bytes exactes, o null si no s'ha pogut llegir
     */
    function _readBinary(path) {
        try {
            const fs = window.cep && window.cep.fs;
            if (!fs || !fs.readFile) return null;

            // 1) VIA BONA: Base64 → atob → Uint8Array (bytes intactes)
            const enc = (window.cep.encoding && window.cep.encoding.Base64) ? window.cep.encoding.Base64 : 'Base64';
            let r = null;
            try { r = fs.readFile(path, enc); } catch (eB) { r = null; }
            if (r && r.err === 0 && r.data) {
                const b64 = String(r.data).replace(/\s/g, '');
                if (b64.length > 4) {
                    try {
                        const bin = atob(b64);
                        if (bin.length > 4) {
                            const u = new Uint8Array(bin.length);
                            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                            return u;
                        }
                    } catch (eA) { /* no era Base64 → es prova la lectura crua */ }
                }
            }

            // 2) FALLBACK (últim recurs): lectura crua. POT estar corrupta → s'avisa.
            r = fs.readFile(path);
            if (!r || r.err !== 0 || !r.data) return null;
            const d = String(r.data);
            const u = new Uint8Array(d.length);
            for (let i = 0; i < d.length; i++) u[i] = d.charCodeAt(i) & 0xff;
            utils.log('⚠️ [titolet] _readBinary: la lectura Base64 ha fallat a ' + path +
                ' → bytes POTser corromputs (' + u.length + ' B); la cobertura no és fiable', 'high');
            return u;
        } catch (e) { return null; }
    }

    /**
     * _waitForPath: espera (asíncrona, sense bloquejar el motor) que un fitxer existeixi.
     * Necessari perquè `IO.executeShell` és ASÍNCRON: llança el .bat i torna de seguida.
     * MESURAT (2026-10-06): `bin\ocr.ps1` triga ~1.900 ms a escriure el .txt.
     * @param {string} path · @param {number} intervalMs · @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    async function _waitForPath(path, intervalMs, timeoutMs) {
        const iv = intervalMs || 250;
        const to = timeoutMs || 60000;
        const t0 = Date.now();
        const exists = () => {
            try {
                const fs = window.cep && window.cep.fs;
                if (fs && fs.stat) return !!(fs.stat(path) && fs.stat(path).err === 0);
            } catch (e) { }
            return false;
        };
        while (true) {
            if (exists()) return true;
            // Fallback sense cep.fs.stat: el pont JSX (IO.exists) és l'únic recurs.
            if (!(window.cep && window.cep.fs && window.cep.fs.stat)) {
                try {
                    const s = String(await utils.callJSX('IO.exists(' + JSON.stringify(path) + ')') || '');
                    if (s.indexOf('true') === 0) return true;
                } catch (eJ) { }
            }
            if (Date.now() - t0 >= to) return false;
            await new Promise((res) => setTimeout(res, iv));
        }
    }

    /** _readText: llegeix un .txt UTF-8 des de JS (amb _fromMojibake si cal). */
    async function _readText(path) {
        let s = '';
        try {
            const fs = window.cep && window.cep.fs;
            if (fs && fs.readFile) {
                const r = fs.readFile(path);
                if (r && r.err === 0 && r.data) s = r.data;
            }
        } catch (e) { }
        if (!s) {
            try { s = await utils.callJSX('IO.readTxt(' + JSON.stringify(path) + ')', { rawError: true }); } catch (e2) { s = ''; }
        }
        if (typeof s !== 'string' || s.indexOf('ERR') === 0) return '';
        try {
            const U = window.FASTPASS_UI.Utils;
            if (U && U._fromMojibake) s = U._fromMojibake(s, 'ocr');
        } catch (e3) { }
        return s;
    }

    /**
     * ocrText: aplica bin\ocr.ps1 a un PNG i en retorna el text ('' si falla o si no hi
     * ha text).
     *
     * 🔴 (2026-10-06, 3a passada) TOTS els idiomes de `cfg.ocrLangs` es proven en UNA
     * SOLA execució (`-Langs "es-ES,en-US"`, vegeu bin\ocr.ps1): abans cada idioma
     * arrencava el seu propi PowerShell (~1,5 s d'arrencada + ~1,9 s fins al .txt) i
     * amb 33 intervals eren ~70 arrencades de procés en va.
     */
    async function ocrText(pngPath, cfg) {
        const langs = (cfg && cfg.ocrLangs && cfg.ocrLangs.length) ? cfg.ocrLangs : ['es-ES', 'en-US'];
        const outTxt = pngPath.replace(/\.png$/i, '') + '.txt';
        let extRoot = '';
        try { extRoot = String(await utils.callJSX('System.getExtPath()') || ''); } catch (e0) { }
        const ocrScript = extRoot.replace(/\//g, '\\') + '\\bin\\ocr.ps1';
        // ⚠️ `IO.executeShell` llança el .bat i TORNA DE SEGUIT (asíncron, obre una
        // finestra de CMD): llegir `outTxt` tot just després donava '' SEMPRE, perquè el
        // .txt encara no existia. MESURAT: `ocr.ps1` triga ~1.900 ms a escriure'l.
        // Ara: s'esborra la sortida prèvia (per no llegir-ne una d'antiga) i s'espera
        // que ocr.ps1 l'escrigui amb `_waitForPath` (polling, no bloqueja el motor).
        try { await utils.callJSX('IO.remove(' + JSON.stringify(outTxt) + ')'); } catch (eR0) { }
        const langArg = (langs.length > 1)
            ? ' -Langs "' + langs.join(',') + '"'
            : ' -Lang "' + langs[0] + '"';
        const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + ocrScript +
            '" -In "' + pngPath + '" -Out "' + outTxt + '"' + langArg;
        try { await utils.callJSX('IO.executeShell(' + JSON.stringify(cmd) + ')'); } catch (eS) { return ''; }
        const ready = await _waitForPath(outTxt, 250, 45000);
        if (!ready) {
            utils.log('⚠️ [titolet] OCR (' + langs.join('/') + '): sense resultat en 45 s → ' + outTxt, 'high');
            return '';
        }
        const s = (await _readText(outTxt)).trim();
        try { await utils.callJSX('IO.remove(' + JSON.stringify(outTxt) + ')'); } catch (eR) { }
        // ocr.ps1 SEMPRE escriu el fitxer: 'ERR: <motiu>' si ha fallat (exit 1-4)
        if (s && s.indexOf('ERR:') === 0) {
            utils.log('⚠️ [titolet] OCR (' + langs.join('/') + '): ' + s.substring(0, 120), 'high');
            return '';
        }
        if (s) return s;
        utils.log('ℹ️ [titolet] OCR (' + langs.join('/') + '): sense text al PNG (' + pngPath + ')');
        return '';
    }

    /**
     * _attemptInstants: instants a provar dins d'un interval, SEMPRE cap ENDAVANT
     * (mai abans del primer: el rètol hi acaba d'entrar).
     *
     * El 1r intent és `bestT` (la mostra de MÉS cobertura, la del rètol més format);
     * els següents avancen `ocrRetryStepSec` fins a un màxim de `ocrTries` intents i
     * sense passar mai del final de l'interval.
     * @returns {Array<number>} segons (dins del fitxer)
     */
    function _attemptInstants(iv, cfg) {
        const tries = Math.max(1, (cfg && cfg.ocrTries) ? cfg.ocrTries : 3);
        const step = (cfg && cfg.ocrRetryStepSec != null) ? cfg.ocrRetryStepSec : 0.75;
        const t0 = (iv && isFinite(iv.bestT)) ? iv.bestT : ((iv ? iv.tIn : 0) + 0.5);
        const out = [t0];
        for (let k = 1; k < tries; k++) {
            const t = Math.round((t0 + k * step) * 1000) / 1000;
            if (iv && isFinite(iv.tOut) && t >= iv.tOut - 0.05) break;
            out.push(t);
        }
        return out;
    }

    /**
     * ocrAtInstant: UNA captura del MP4 en un instant + OCR. Retorna el text ('' si res).
     * La captura porta la ROI d'OCR de `cfg.ocrRoiX` (si hi és) per no llegir text aliè
     * que hi hagi al costat del rètol (MESURAT: llegia el marcador de votacions del fons).
     */
    async function ocrAtInstant(mp4, t, cfg, tag, k) {
        const F = FASTPASS_UI.Logic.FFmpeg;
        const flatTag = String(tag || 'it').replace(/[^a-z0-9]/gi, '');
        const png = 'C:\\temp\\titolet_' + flatTag + '_' + k + '.png';
        const r = await F.extractFramePng(mp4, t, png, { roiY: cfg.roiY, roiX: cfg.ocrRoiX });
        if (!r || !r.ok) return '';
        const txt = await ocrText(png, cfg);
        try { await utils.callJSX('IO.remove(' + JSON.stringify(png) + ')'); } catch (eR) { }
        return txt;
    }

    /**
     * scanMp4: ROI del cleanFeed → sèrie de mostres (ffmpeg) → mètriques de color (JS).
     * @returns {Promise<{ok:boolean, series?:Array, w?:number, h?:number, error?:string}>}
     */
    async function scanMp4(mp4, tStart, tDur, cfg) {
        const F = FASTPASS_UI.Logic.FFmpeg;
        const w = (cfg && cfg.roiW) ? cfg.roiW : 160;
        const h = (cfg && cfg.roiH) ? cfg.roiH : 45;
        const sc = await F.extractRoiSeries(mp4, {
            tStart: tStart, tDur: tDur, roiY: (cfg && cfg.roiY) || [0.60, 0.85],
            w: w, h: h, fps: (cfg && cfg.scanFps) || 1
        });
        if (!sc.ok) return { ok: false, error: sc.error };
        const buf = _readBinary(sc.path);
        if (!buf) return { ok: false, error: 'no s\'ha pogut llegir el .raw (' + sc.path + ')' };
        const series = analyzeSeries(buf, sc.w, sc.h, {
            color: cfg.color, tol: cfg.tol, scanFps: sc.fps, minEdgeFrac: cfg.minEdgeFrac, tStart: tStart
        });
        try { await utils.callJSX('IO.remove(' + JSON.stringify(sc.path) + ')'); } catch (eR) { }
        return { ok: true, series: series, w: sc.w, h: sc.h, error: null };
    }

    /**
     * _refineFromSeries: (PURA) estima l'instant REAL d'entrada d'un rètol a partir d'una
     * sèrie FI escanejada al voltant de la seva entrada.
     *
     * 🔴 (2026-10-06, 5a passada · petició d'usuari «en general hi ha uns frames de retraso»)
     * L'escaneig general va a `scanFps` (2 mostres/s = pas 0,5 s = 12 frames) i el primer
     * mostreig ON SEMPRE cau després de l'entrada real: la targeta s'hi col·locava fins a
     * 12 frames tard. Amb un pas fi (1/`fineFps`) l'error baixa a mig pas fi (~3 frames).
     * La mostra ON és la primera de la sèrie fina que cobreix el mínim; l'estimació és
     * `tIn` d'aquell interval MENYS mig pas fi (la veritat és dins del pas anterior).
     * @param {Array} series - mostres {t, cov, edge} de la sèrie fina
     * @param {number} tIn - entrada detectada amb l'escaneig general (segons del MP4)
     * @param {Object} cfgFine - paràmetres de l'interval amb el pas fi
     * @param {number} fineFps
     * @returns {number|null} instant estimat (segons del MP4) o null
     */
    function _refineFromSeries(series, tIn, cfgFine, fineFps) {
        const ivs = groupIntervals(series || [], cfgFine);
        if (!ivs.length) return null;
        let first = ivs[0];
        for (const iv of ivs) if (iv.tIn < first.tIn) first = iv;
        const half = 0.5 / ((fineFps && fineFps > 0) ? fineFps : 8);
        const est = Math.round((first.tIn - half) * 1000) / 1000;
        if (!isFinite(est) || est > tIn + 1e-6) return null;
        return est;
    }

    /**
     * refineEntry: escaneig FI al voltant de l'entrada d'un interval i, si tot va bé, reescriu
     * `iv.tIn` i `iv.dur` (la durada creix el que s'ha guanyat cap enrere).
     * És best-effort: si el ffmpeg falla o no s'hi veu el rètol, es queda l'entrada general.
     * @returns {Promise<{tIn:number, delta:number, fineFps:number}|null>} delta = entrada vella − nova
     */
    async function refineEntry(mp4, iv, cfg, label) {
        if (!cfg || cfg.refineEntry === false || !mp4) return null;
        const coarse = cfg.scanFps || 1;
        const fineFps = Math.max(coarse * 2, (cfg.refineFps != null) ? cfg.refineFps : 8);
        const win = Math.max(1.5 / fineFps, 1 / coarse);
        const t0 = Math.max(0, iv.tIn - win);
        const sc = await scanMp4(mp4, t0, win, Object.assign({}, cfg, { scanFps: fineFps }));
        if (!sc.ok || !sc.series) return null;
        const cfgFine = Object.assign({}, cfg, { minFrames: 1, minOn: 0, minOff: 0, gapMergeSec: 0 });
        const est = _refineFromSeries(sc.series, iv.tIn, cfgFine, fineFps);
        if (est === null) return null;
        const nuevo = Math.max(t0, Math.min(iv.tIn, est));
        const delta = Math.round((iv.tIn - nuevo) * 1000) / 1000;
        if (Math.abs(delta) >= 0.05) {
            iv.dur = Math.round((iv.dur + delta) * 1000) / 1000;
            iv.tIn = nuevo;
        }
        return { tIn: nuevo, delta: delta, fineFps: fineFps, label: label };
    }

    /**
     * refineFound: refina l'ENTRADA de tots els intervals USATS (1 crida ffmpeg per interval).
     * S'aplica tant al camí de l'escaneig com al de la CACHÉ (el pla desat es va calcular amb
     * l'entrada general; el refinament és barat i el millora).
     */
    async function refineFound(mp4, found, cfg, label) {
        if (!cfg || cfg.refineEntry === false || !mp4) return;
        for (const f of (found || [])) {
            try {
                const r = await refineEntry(mp4, f.iv, cfg, label);
                if (r && Math.abs(r.delta) >= 0.05) {
                    utils.log('   🔬 [titolet] ' + label + ' interval @ ' + (r.tIn + r.delta).toFixed(2) +
                        's → entrada REFINADA a ' + r.tIn.toFixed(2) + 's (' + (r.delta > 0 ? '−' : '+') +
                        Math.abs(r.delta).toFixed(2) + 's, escaneig fi ' + r.fineFps + '/s)');
                }
            } catch (eRf) { }
        }
    }

    /**
     * ALGO: versió de l'ALGORISME de muntatge del pla (assignació + orfes + refinament).
     * El JSON de caché desa `algo` i, si no coincideix amb aquesta versió, el pla es
     * RECALCULA amb les dades crues (intervals + texts) — no es torna a escanejar.
     *   1 = assignació voraç sense rebutjar texts aliens ni resoldre orfes
     *   2 = (2026-10-06, 5a passada) + matchos febles amb text aliè rebutjats + orfes per ordre
     */
    const ALGO = 2;

    /** _hash32: hash estable (djb2) d'un text → clau de caché curta. */
    function _hash32(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return h.toString(16);
    }

    /**
     * _planCachePath: ruta del JSON de caché del pla, o null si està desactivat
     * (`cfg.cache === false` o `FASTPASS_UI.State.titoletNoCache = true`).
     * La clau inclou els paràmetres que CAMBIEN el resultat (si no, el mateix clip
     * amb una ROI o uns llindars diferents retornaria un pla vell).
     */
    function _planCachePath(p, cfg) {
        if (cfg && cfg.cache === false) return null;
        try {
            if (window.FASTPASS_UI.State && window.FASTPASS_UI.State.titoletNoCache === true) return null;
        } catch (eS) { }
        const key = JSON.stringify({
            mp4: String((p && p.mp4) || '').toLowerCase(),
            tItemStart: (p && p.tItemStart) || 0,
            tScanStart: (p && p.tScanStart) || 0,
            tScanDur: (p && p.tScanDur) || 0,
            names: (p && p.names) || [],
            cfg: {
                v: 1, color: cfg.color, tol: cfg.tol, scanFps: (cfg.scanFps || 1),
                minCov: cfg.minCov, maxCov: cfg.maxCov, minOn: cfg.minOn, minOff: cfg.minOff,
                gapMergeSec: cfg.gapMergeSec, minFrames: cfg.minFrames, longOnSec: cfg.longOnSec,
                ocr: cfg.ocr, ocrLangs: cfg.ocrLangs, ocrTries: cfg.ocrTries,
                ocrRetryStepSec: cfg.ocrRetryStepSec, roiY: cfg.roiY, roiW: cfg.roiW, roiH: cfg.roiH,
                ocrRoiX: cfg.ocrRoiX, scanChunkSec: cfg.scanChunkSec, edgeAxes: cfg.edgeAxes
            }
        });
        return 'C:\\temp\\titolet_plan_' + _hash32(key) + '.json';
    }

    /**
     * _cacheLoad: llegeix el pla desat (null si no hi és o no serveix).
     * Accepta plans de l'algorisme vell (`algo` absent): qui el llegeix comprova `algo` i el
     * recalcula amb les dades crues si cal (vegeu `planForItem`).
     */
    function _cacheLoad(path) {
        if (!path) return null;
        try {
            const fs = window.cep && window.cep.fs;
            if (!fs || !fs.readFile) return null;
            const r = fs.readFile(path);
            if (!r || r.err !== 0 || !r.data) return null;
            const o = JSON.parse(String(r.data));
            if (!o || (o.v !== 1 && o.v !== 2) || !o.cards) return null;
            return o;
        } catch (e) { return null; }
    }

    /**
     * _t0FromCache: reconstrueix el `t0` (segon del MP4 on arrenca l'ítem) d'un pla desat amb
     * l'algorisme vell (que no el desava): t0 = tIn de l'interval assignat − relIn de la targeta.
     * @returns {number|null}
     */
    function _t0FromCache(hit) {
        try {
            const a = (hit.assign || [])[0];
            if (!a || !hit.intervals || !hit.cards) return null;
            const iv = hit.intervals[a.i], cd = hit.cards[a.w];
            if (!iv || !cd || !isFinite(cd.relIn)) return null;
            return Math.round((iv.tIn - cd.relIn) * 1000) / 1000;
        } catch (e) { return null; }
    }

    /** _cacheSave: desa el pla (best-effort; mai fa fallar la detecció). */
    function _cacheSave(path, plan) {
        if (!path) return;
        try {
            const fs = window.cep && window.cep.fs;
            if (!fs || !fs.writeFile) return;
            fs.writeFile(path, JSON.stringify({
                v: 2, algo: ALGO, ts: Date.now(), t0: plan.t0, cards: plan.cards, stats: plan.stats,
                intervals: plan.intervals, ocrTexts: plan.ocrTexts, assign: plan.assign
            }));
        } catch (e) { }
    }

    /**
     * composePlan: munta el pla (cards + stats) a partir dels encerts de l'escaneig
     * endavant. Mateixa forma que `buildPlan` → `flow_chyrons` no nota cap canvi.
     * @param {Array} found - [{w, iv, text, score, token, how, tOcr}]
     * @param {Array} intervals - TOTS els intervals detectats (en ordre)
     * @param {Array<string>} names
     * @param {number} t0 - segon del MP4 on arrenca l'ítem (per als temps relatius)
     * @param {Array<string>} [ivsText] - text OCR de CADA interval (índex = interval). Si no
     *   s'hi passa, es deriva dels encerts (i els intervals rebutjats queden sense text).
     * @param {Array} [notes] - notes de `resolveOrphans` (per a la traça del log)
     */
    function composePlan(found, intervals, names, t0, cfg, ivsText, notes) {
        const longOn = (cfg && cfg.longOnSec != null) ? cfg.longOnSec : 5.0;
        const byW = {};
        for (const f of found) byW[f.w] = f;
        const cards = [];
        for (let k = 0; k < names.length; k++) {
            const hit = byW[k];
            if (!hit) {
                cards.push({ wott: names[k], found: false, on: null, relIn: null, relOut: null, kind: 'none', score: 0, token: '', maxCov: 0, ocrAt: null, how: 'none', txt: '' });
                continue;
            }
            const iv = hit.iv;
            const txt = String(hit.text || '').replace(/\s+/g, ' ').substring(0, 40);
            cards.push({
                wott: names[k], found: true, on: iv.dur,
                relIn: Math.round((iv.tIn - t0) * 1000) / 1000,
                relOut: Math.round((iv.tOut - t0) * 1000) / 1000,
                kind: (iv.dur <= longOn) ? 'short' : 'long',
                score: hit.score, token: hit.token, maxCov: iv.maxCov,
                ocrAt: Math.round(((isFinite(hit.tOcr) ? hit.tOcr : iv.bestT) - t0) * 1000) / 1000,
                how: hit.how, txt: txt
            });
        }
        // Text OCR de CADA interval: si el cridador el porta (escaneig real), mana el seu
        // (inclou els intervals REBUTJATS, necessaris per detectar re-emissions).
        const ocrTexts = (ivsText && ivsText.length >= (intervals || []).length)
            ? ivsText
            : (intervals || []).map(iv => {
                const f = found.filter(x => x.iv === iv)[0];
                return f ? f.text : '';
            });
        const nMatch = cards.filter(c => c.found).length;
        const assignOut = found.map(f => ({ i: (intervals || []).indexOf(f.iv), w: f.w, score: f.score, token: f.token, how: f.how }));
        assignOut.sort((a, b) => (a.w - b.w));
        return {
            cards: cards,
            assign: assignOut,
            intervals: intervals || [],
            ocrTexts: ocrTexts,
            notes: notes || [],
            t0: t0,
            stats: {
                nWotts: names.length, nIntervals: (intervals || []).length, nMatched: nMatch,
                nShort: cards.filter(c => c.kind === 'short').length,
                nLong: cards.filter(c => c.kind === 'long').length,
                nNone: cards.filter(c => c.kind === 'none').length,
                ok: (nMatch === names.length)
            }
        };
    }

    /**
     * planFromRaw: munta el pla a partir de les dades CRUES (intervals + text OCR de CADA
     * interval) amb l'algorisme ACTUAL:
     *   assignació voraç (rebutjant els matchos febles amb text aliè) → resolució dels wott
     *   orfes per ordre → REFINAMENT de l'entrada → targetes.
     *
     * ⚠️ (2026-10-06, 5a passada) Tant el camí de l'escaneig endavant com el de la CACHÉ passen
     * per aquí: la caché desa els intervals + els texts, així que un canvi d'algorisme (o de
     * llindars com `ocrWeak`/`refineFps`) s'aplica SENSE tornar a escanejar els 350 s.
     * @param {string} mp4
     * @param {Array} ivs - intervals detectats (es poden MODIFICAR: `tIn` refinat)
     * @param {Array<string>} texts - text OCR de cada interval ('' si no se n'ha tret)
     * @param {Array<string>} names
     * @param {number} t0 - segon del MP4 on arrenca l'ítem
     * @param {Object} cfg
     * @param {string} label
     * @returns {Promise<Object>} pla (mateixa forma que `composePlan`)
     */
    async function planFromRaw(mp4, ivs, texts, names, t0, cfg, label) {
        const found = assignIntervals(ivs, texts, names, cfg).map(a => ({
            w: a.w, iv: ivs[a.i], text: texts[a.i] || '', score: a.score, token: a.token, how: a.how, tOcr: ivs[a.i].bestT
        }));
        const ro = resolveOrphans(found, ivs, names, texts, cfg);
        for (const n of (ro.notes || [])) {
            if (n.ok) {
                utils.log('   🧩 [titolet] ' + label + ' wott ' + (n.w + 1) + '/' + names.length + ' «' +
                    String(names[n.w]).substring(0, 34) + '» no tenia text llegible → interval @ ' +
                    ivs[n.i].tIn.toFixed(2) + 's assignat PER ORDRE (entre els seus veïns)');
            } else {
                utils.log('   ⚠️ [titolet] ' + label + ' wott ' + (n.w + 1) + '/' + names.length + ' «' +
                    String(names[n.w]).substring(0, 34) + '» orfe i sense interval deduïble (' +
                    ((n.cands || []).length) + ' candidat(s): ' + ((n.cands || []).join(',') || 'cap') +
                    ') → fallback', 'high');
            }
        }
        await refineFound(mp4, ro.found, cfg, label);
        return composePlan(ro.found, ivs, names, t0, cfg, texts, ro.notes);
    }

    /**
     * planForItem: pipeline complet per a UN ítem (el d'un marcador estructural).
     *
     * 🔴 ESCANEIG ENDAVANT (2026-10-06, 3a passada). Nota d'ordre de l'usuari:
     * «un cop trobat un chyron cremat ja no cal tornar a rastrejar abans d'aquell
     * chyron: cal restringir la cerca des d'aquell chyron en endavant». Per això:
     *   1) La finestra es recorre per TRAMS (`scanChunkSec`): el cursor NOMÉS avança.
     *   2) Dins d'un interval s'hi fa UNA captura (al frame de més cobertura); si
     *      l'OCR no en treu cap wott pendent, es reintenta cap ENDAVANT (≤ `ocrTries`).
     *   3) Si tots els wott ja estan assignats, S'ATURA (no escaneja la resta) — llevat que
     *      s'hagi vist un match FEBLE amb text aliè (llavors cal arribar al final: la
     *      reassignació global pot deixar algun wott orfe i necessita tots els intervals).
     *   4) (5a passada) La cerca per interval NOMÉS decideix QUIN text hi ha; l'assignació
     *      final es RECALCULA amb totes les dades (`planFromRaw`), i el pla es desa amb els
     *      intervals + els texts per poder-lo recalcular sense tornar a escanejar.
     *
     * @param {Object} p - { mp4, tItemStart, names, tScanStart, tScanDur, cfg, label }
     *   tItemStart = segon del MP4 on arrenca l'ítem (marcador) → els temps del pla
     *   queden RELATIUS a l'ítem, que és com els fa servir la cadena TITOLET.
     * @returns {Promise<{ok:boolean, cards:Array, stats:Object, intervals:Array, ocrTexts:Array, error?:string}>}
     */
    async function planForItem(p) {
        const cfg = p.cfg || {};
        const label = p.label || 'item';
        const empty = (err) => ({ ok: false, error: err, cards: [], stats: {}, intervals: [], ocrTexts: [] });
        try {
            if (!p.mp4) return empty('sense MP4 cleanFeed');
            const names = p.names || [];
            const cachePath = _planCachePath(p, cfg);
            const hit = _cacheLoad(cachePath);
            if (hit) {
                // (2026-10-06, 5a passada) El pla desat porta TOTES les dades crues (intervals +
                // ocrTexts): si el va calcular un algorisme anterior, es RECALCULA aquí mateix
                // amb el vigent → el canvi s'aplica SENSE tornar a escanejar (350 s → 25 s).
                if (hit.algo !== ALGO && (hit.intervals || []).length) {
                    const t0h = (hit.t0 != null) ? hit.t0 : _t0FromCache(hit);
                    if (t0h != null) {
                        utils.log('♻️ [titolet] ' + label + ': pla de la CACHÉ RECALCULAT amb l\'algorisme v' +
                            ALGO + ' (v' + (hit.algo || 1) + ' → ' + ALGO + '; dades crues: ' +
                            hit.intervals.length + ' intervals) → no es torna a rastrejar');
                        const re = await planFromRaw(p.mp4, hit.intervals, hit.ocrTexts || [], names, t0h, cfg, label);
                        _cacheSave(cachePath, re);
                        return {
                            ok: true, cards: re.cards, stats: re.stats, intervals: re.intervals,
                            ocrTexts: re.ocrTexts, assign: re.assign, cached: true, error: null
                        };
                    }
                }
                const nf = (hit.cards || []).filter(c => c.found).length;
                utils.log('⚡ [titolet] ' + label + ': pla de la CACHÉ (' + nf + '/' + names.length +
                    ' wotts · ' + ((hit.intervals || []).length) + ' intervals) → no es torna a rastrejar');
                return {
                    ok: true, cards: hit.cards, stats: hit.stats, intervals: hit.intervals,
                    ocrTexts: hit.ocrTexts, assign: hit.assign, cached: true, error: null
                };
            }
            const t0 = p.tItemStart || 0;
            const chunk = Math.max(5, (cfg.scanChunkSec != null) ? cfg.scanChunkSec : 45);
            const tStart = Math.max(0, p.tScanStart || 0);
            let cursor = tStart;
            const endAbs = tStart + Math.max(1, p.tScanDur || 0);
            const allIvs = [], found = [], taken = {}, ivsText = [];
            let sawWeak = false;
            let nSamples = 0, nChunks = 0, w = cfg.roiW || 160, h = cfg.roiH || 45;
            while (cursor < endAbs && (found.length < names.length || sawWeak)) {
                const len = Math.min(chunk, endAbs - cursor);
                nChunks++;
                const sc = await scanMp4(p.mp4, cursor, len, cfg);
                if (!sc.ok) return empty(sc.error);
                nSamples += (sc.series || []).length;
                w = sc.w; h = sc.h;
                const ivs = groupIntervals(sc.series, cfg);
                utils.log('🎯 [titolet] ' + label + ' tram ' + nChunks + ' [' + cursor.toFixed(1) + 's→' +
                    (cursor + len).toFixed(1) + 's]: ' + (sc.series || []).length + ' mostres (' + sc.w + 'x' + sc.h +
                    ') → ' + ivs.length + ' intervals');
                for (const iv of ivs) {
                    if (found.length >= names.length && !sawWeak) break;
                    allIvs.push(iv);
                    const ivIdx = allIvs.length - 1;
                    const relIn = Math.round((iv.tIn - t0) * 1000) / 1000;
                    const insts = (cfg.ocr === false) ? [] : _attemptInstants(iv, cfg);
                    let enc = null, text = '', tUsed = null;
                    for (let k = 0; k < insts.length && !enc; k++) {
                        const txt = await ocrAtInstant(p.mp4, insts[k], cfg, label + '_' + Math.round(relIn) + '_', k);
                        if (txt) {
                            text = txt;
                            const c = pickWott(txt, names, cfg, taken);
                            // 🔴 (5a passada) MATCH FEBLE amb text ALIÈ: si el text ja és (millor)
                            // d'un altre wott, aquest interval és una REPETICIÓ del rètol d'aquell
                            // wott → no es consumeix aquest wott. (Cas real: el ZAPATERO s'hi va
                            // emparellar amb 0,556 i va anar 10,5 s abans del seu lloc.)
                            const weak = (cfg.ocrWeak != null) ? cfg.ocrWeak : 0.7;
                            const anyW = c.index >= 0 ? pickWott(txt, names, cfg, null) : null;
                            if (c.index >= 0 && c.score < weak && anyW && anyW.index >= 0 &&
                                anyW.index !== c.index && anyW.score >= c.score + 0.1) {
                                sawWeak = true;
                                utils.log('   ♻️ [titolet] ' + label + ' interval @ ' + iv.tIn.toFixed(2) +
                                    's (relIn ' + relIn + 's): el text «' + txt.replace(/\r?\n/g, ' | ').substring(0, 50) +
                                    '» ja és (millor) del wott ' + (anyW.index + 1) + ' (score ' + anyW.score +
                                    ') → NO s\'hi assigna el ' + (c.index + 1) + ' (score ' + c.score + ')');
                            } else if (c.index >= 0) { enc = c; tUsed = insts[k]; }
                            else {
                                utils.log('   ♻️ [titolet] ' + label + ' intent ' + (k + 1) + '/' + insts.length +
                                    ' @ ' + insts[k].toFixed(2) + 's: cap wott pendent amb «' +
                                    txt.replace(/\r?\n/g, ' | ').substring(0, 60) + '»');
                            }
                        } else {
                            utils.log('   ⚠️ [titolet] ' + label + ' intent ' + (k + 1) + '/' + insts.length +
                                ' @ ' + insts[k].toFixed(2) + 's: OCR sense text');
                        }
                    }
                    ivsText[ivIdx] = text || '';   // text OCR de l'interval (encara que no s'assigni)
                    if (enc) {
                        taken[enc.index] = true;
                        found.push({ w: enc.index, iv: iv, text: text, score: enc.score, token: enc.token, how: enc.how, tOcr: tUsed });
                        utils.log('   🔎 [titolet] ' + label + ' interval @ ' + iv.tIn.toFixed(2) + 's→' +
                            iv.tOut.toFixed(2) + 's (dur ' + iv.dur.toFixed(2) + 's, cov ' + iv.maxCov +
                            '%, relIn ' + relIn + 's) → wott ' + (enc.index + 1) + '/' + names.length +
                            ' «' + String(names[enc.index]).substring(0, 38) + '» (score ' + enc.score +
                            ', token ' + enc.token + ', via ' + enc.how + '): «' +
                            text.replace(/\r?\n/g, ' | ').substring(0, 70) + '»');
                    } else if (cfg.ocr !== false) {
                        utils.log('   ❌ [titolet] ' + label + ' interval @ ' + iv.tIn.toFixed(2) + 's (relIn ' +
                            relIn + 's) descartat: cap wott pendent en ' + insts.length + ' intent(s)');
                    }
                }
                cursor += len;      // ← el cursor NOMÉS avança: mai es re-rastreja enrere
            }
            // (5a passada) El pla es RECALCULA amb TOTES les dades (no amb les decisions
            // incrementals de l'escaneig): mateixa assignació que faria la caché recalçada.
            const plan = await planFromRaw(p.mp4, allIvs, ivsText, names, t0, cfg, label);
            const st = plan.stats;
            utils.log('🎯 [titolet] ' + label + ': ' + st.nMatched + '/' + names.length + ' wotts · ' +
                allIvs.length + ' intervals · ' + nChunks + ' tram(s) · ' + nSamples + ' mostres (' + w + 'x' + h + ')' +
                ((found.length >= names.length && !sawWeak) ? ' · ATURAT (tots assignats)' : ' · fi de finestra'));
            _cacheSave(cachePath, plan);
            return {
                ok: true, cards: plan.cards, stats: st, intervals: plan.intervals,
                ocrTexts: plan.ocrTexts, assign: plan.assign, cached: false, error: null
            };
        } catch (e) {
            utils.log('❌ [titolet] planForItem: ' + e.message);
            return empty(e.message);
        }
    }

    FASTPASS_UI.Logic.TitoletDetect = {
        // ── pures (test headless, sense CEP) ──
        analyzeFrameAt: analyzeFrameAt,
        analyzeSeries: analyzeSeries,
        groupIntervals: groupIntervals,
        pickWott: pickWott,
        assignIntervals: assignIntervals,
        resolveOrphans: resolveOrphans,
        buildPlan: buildPlan,
        composePlan: composePlan,
        refineFromSeries: _refineFromSeries,
        attemptInstants: _attemptInstants,
        planCachePath: _planCachePath,
        normText: _normText,
        levRatio: _levRatio,
        wottTokens: _wottTokens,
        hexToRgb: _hexToRgb,
        // ── orquestració (CEP: ffmpeg + OCR + IO) ──
        ocrText: ocrText,
        scanMp4: scanMp4,
        planForItem: planForItem
    };
})();
