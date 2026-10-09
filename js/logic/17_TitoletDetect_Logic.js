/**
 * ============================================================================
 * LOGIC: TITOLET DETECT - v1.2.0 (2026-10-09)
 * Detecció del grafisme cremat (rètol mosquit) al MP4 cleanFeed
 * ============================================================================
 * Llegeix el MP4 cleanFeed, mesura QUAN surt el rètol TITOLET (color #F25F13)
 * i QUANT dura, i en llegeix el text per OCR per saber QUIN wott és.
 *
 * 🎨 MULTI-COLOR PER ETIQUETA (2026-10-09, 8a passada; petició d'usuari: «detectar més
 * d'un color per tipus de grafisme, i definir per a cada tipus quins colors i en quina
 * zona s'han de buscar»). Una recepta pot declarar `facets`: una LLISTA de colors, CADA
 * UN amb la seva ZONA (`roiX`/`roiY` propis en fracció de frame; si no en declara, la de
 * la recepta) i els seus PROPIS llindars (`minCov`/`maxCov`/`edgeAxes`/`minEdgeFrac`).
 *   · Un frame és ON si ALGUNA faceta hi passa (`_frameSummary` → `frame.on`).
 *   · La cobertura de cada faceta es mesura sobre l'ÀREA DE LA SEVA ZONA (no sobre el
 *     conjunt) → els llindars es poden llegir igual que en una recepta d'un sol color.
 *   · L'escaneig segueix sent UNA sola passada d'ffmpeg: s'extreu el rectangle que
 *     ENGLOBA totes les zones (hull) i cada color només compta dins la seva (`_facetRect`).
 *   · Sense `facets` tot queda EXACTAMENT com abans (color únic + llindars de la recepta).
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

    // ─── PUR: ROI per ETIQUETA (2026-10-08, 7a passada) ──────────────────────
    /** ROI_KEYS: paràmetres del rastreig que una recepta d'etiqueta pot sobreescriure. */
    const ROI_KEYS = ['roiX', 'roiY', 'edgeAxes', 'color', 'tol', 'minCov', 'maxCov',
        'minEdgeFrac', 'ocrRoiX', 'roiW', 'roiH', 'facets'];

    /**
     * _recipeOf: (PURA) Recepta de rastreig d'UNA etiqueta de rol. Precedència:
     *   `cfg.roiPerRole[rol]` → `cfg.roiDefault` (comodí) → valors base de `cfg`.
     * Només toca les claus de `ROI_KEYS`: la resta de `cfg` (OCR, cadència, caché…) no s'hi
     * barreja, així que la recepta es pot fer servir com a `cfg` de l'escaneig sense perdre res.
     * @param {Object} cfg - `config.titolet`
     * @param {string|null} role - etiqueta literal del rol (p.ex. 'PREGUNTA')
     * @returns {Object} { roiX, roiY, edgeAxes, color, tol, minCov, maxCov, minEdgeFrac,
     *                     ocrRoiX, from }
     */
    function _recipeOf(cfg, role) {
        const c = cfg || {};
        const out = {};
        for (const k of ROI_KEYS) if (c[k] !== undefined) out[k] = c[k];
        if (out.roiY === undefined) out.roiY = [0.60, 0.85];
        if (out.roiX === undefined) out.roiX = null;
        if (out.edgeAxes === undefined) out.edgeAxes = 'y';
        const per = (c.roiPerRole && role && c.roiPerRole[role]) ? c.roiPerRole[role] : null;
        const src = per || c.roiDefault || null;
        if (src) {
            for (const k of ROI_KEYS) {
                if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
            }
        }
        // 🎨 MULTI-COLOR (2026-10-09, 8a passada): la ROI de la recepta ha d'ENGLOBAR les
        // zones de totes les facetes — l'escaneig fa UNA sola passada (hull) i després
        // cada color només compta dins la seva zona (`_facetRect`). Si la ROI no les
        // inclou, la zona queda FORA del que s'ha extret i la faceta mai no hi veu res.
        const fs = _facetsOf(out);
        for (const f of fs) {
            if (f.roiX) out.roiX = _hull2(out.roiX, f.roiX, [0, 1]);
            if (f.roiY) out.roiY = _hull2(out.roiY, f.roiY, [0, 1]);
        }
        if (out.roiX && out.roiX[0] <= 0.001 && out.roiX[1] >= 0.999) out.roiX = null;
        out.from = per ? ('recepta ' + role) : (c.roiDefault ? 'comodí' : 'base');
        return out;
    }

    /** roiOnly: (PURA) Només les claus de ROI d'un `cfg` — el que viatja dins d'un interval
     *  perquè el refinament i el recàlcul des de la caché el rastrejin amb la SEVA recepta. */
    function roiOnly(cfg) {
        const o = {};
        for (const k of ROI_KEYS) if (cfg && cfg[k] !== undefined) o[k] = cfg[k];
        return o;
    }

    /** _hull2: (PURA) unió de dos rangs [a,b]; `null` compta com el rang complet (`def`). */
    function _hull2(a, b, def) {
        const x = a || def, y = b || def;
        return [Math.min(x[0], y[0]), Math.max(x[1], y[1])];
    }

    /** _maxGrid: (PURA) Graella (roiW/roiH) MÉS FINA de dues cel·les. `undefined` = el valor per
     *  defecte del codi (160x45), que una recepta pot no declarar. Si cap de les dues en porta,
     *  el resultat és `undefined` (es manté el defecte). */
    function _maxGrid(a, b, def) {
        if (a == null && b == null) return undefined;
        return Math.max((a == null) ? def : a, (b == null) ? def : b);
    }

    /** _isect2: (PURA) intersecció de dos rangs; `null` si es queden sense solapament útil. */
    function _isect2(a, b) {
        if (!a) return b || null;
        if (!b) return a;
        const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
        return ((hi - lo) >= 0.05) ? [lo, hi] : null;
    }

    /**
     * recipeForRoles: (PURA) Recepta d'un ÍTEM sencer = UNIÓ de les receptes de les seves
     * etiquetes (rectangle que les engloba, color/tol del primer grup, `edgeAxes` només si
     * tots coincideixen). Serveix per a la clau de caché, els logs i el cas d'una sola
     * recepta (on la unió és la recepta mateixa). Qui decideix si cal MÉS D'UNA passada
     * d'escaneig és `roleGroups`.
     * @param {Object} cfg
     * @param {Array<string>} roles - una etiqueta per wott (buit = recepta base)
     * @returns {Object} còpia de `cfg` amb les claus de ROI_KEYS aplicades + `recipe`
     */
    function recipeForRoles(cfg, roles) {
        const c = cfg || {};
        const list = (roles && roles.length) ? roles.slice() : [null];
        const recs = list.map(r => _recipeOf(c, r));
        const eff = Object.assign({}, c);
        let roiX = recs[0].roiX, roiY = recs[0].roiY, edgeAxes = recs[0].edgeAxes;
        let color = recs[0].color, tol = recs[0].tol, minEdgeFrac = recs[0].minEdgeFrac;
        let minCov = recs[0].minCov, maxCov = recs[0].maxCov, ocrRoiX = recs[0].ocrRoiX;
        let roiW = recs[0].roiW, roiH = recs[0].roiH;
        // 🎨 MULTI-COLOR (2026-10-09, 8a passada): la unió d'etiquetes ha d'unir també les
        // FACETES (colors + zones). Si no, un ítem que mescla etiquetes amb facetes diferents
        // es rastrejaria amb les d'una de sola. Els grups (`roleGroups`) les porten igualment
        // SEVES (una passada per grup): això només afecta la clau de caché i els logs.
        let facets = _facetsOf(recs[0]).slice();
        const warns = [];
        for (let i = 1; i < recs.length; i++) {
            const r = recs[i];
            roiX = _hull2(roiX, r.roiX, [0, 1]);
            // Graella de mostreig: mana la MÉS FINA (una ROI ampla amb la graella del TITOLET
            // deixa el rètol com un punxat). Amb una sola recepta es copia TAL QUAL, que és el
            // cas que importa: cada passada de rastreig ha de mostrejar amb la SEVA graella.
            roiW = _maxGrid(roiW, r.roiW, 160);
            roiH = _maxGrid(roiH, r.roiH, 45);
            roiY = _hull2(roiY, r.roiY, [0, 1]);
            if (r.edgeAxes !== edgeAxes) { edgeAxes = 'none'; if (warns.indexOf('edgeAxes') === -1) warns.push('edgeAxes'); }
            if (r.color !== color && warns.indexOf('color') === -1) warns.push('color');
            if (r.tol !== tol && warns.indexOf('tol') === -1) warns.push('tol');
            if (r.minEdgeFrac !== minEdgeFrac && warns.indexOf('minEdgeFrac') === -1) warns.push('minEdgeFrac');
            // Llindars de cobertura: mana el MÉS PERMISSIU (la unió es mira amb la mateixa vara).
            minCov = Math.min((minCov != null) ? minCov : 2.0, (r.minCov != null) ? r.minCov : 2.0);
            maxCov = Math.max((maxCov != null) ? maxCov : 60, (r.maxCov != null) ? r.maxCov : 60);
            ocrRoiX = _hull2(ocrRoiX, r.ocrRoiX, [0, 1]);
            const rf = _facetsOf(r);
            for (const f of rf) {
                const k = JSON.stringify(f);
                if (!facets.some(x => JSON.stringify(x) === k)) facets.push(f);
            }
        }
        if (roiX && roiX[0] <= 0.001 && roiX[1] >= 0.999) roiX = null;
        eff.roiX = roiX;
        eff.roiY = roiY;
        eff.edgeAxes = edgeAxes;
        if (color !== undefined) eff.color = color;
        if (tol !== undefined) eff.tol = tol;
        if (minEdgeFrac !== undefined) eff.minEdgeFrac = minEdgeFrac;
        if (minCov !== undefined) eff.minCov = minCov;
        if (maxCov !== undefined) eff.maxCov = maxCov;
        // ── Graella de mostreig (roiW/roiH) ──────────────────────────────────────────────
        // 🔴 Sense això, `recipeForRoles(cfgBase, [unaEtiqueta])` (la recepta amb què cada
        // passada de rastreig crida `scanMp4`) perdia la graella pròpia de l'etiqueta i
        // mostrejava una ROI de mitja imatge amb la graella del TITOLET (160x45) → el rètol
        // quedava reduït a un punxat i es perdia el color. `undefined` manté el defecte.
        if (roiW !== undefined) eff.roiW = roiW;
        if (roiH !== undefined) eff.roiH = roiH;
        // 🎨 MULTI-COLOR: les facetes unides de totes les etiquetes de l'ítem.
        if (facets.length) eff.facets = facets;
        // Finestra d'OCR: MAI fora de la zona rastrejada (si no, l'OCR llegiria on no hi ha
        // rètol: MESURAT que llegia el marcador de votacions del fons).
        const roiClamp = roiX || [0, 1];
        const ocrClip = _isect2(ocrRoiX, roiClamp);
        eff.ocrRoiX = ocrClip || [roiClamp[0], roiClamp[1]];
        eff.recipe = {
            roles: list, how: 'unió de ' + recs.length + ' recepta(es)',
            srcs: recs.map(r => r.from), warns: warns, roiX: roiX, roiY: roiY
        };
        return eff;
    }

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
     * _analyzeRect: mesura UN color dins un RECTANGLE de cel·les de la graella (`rect`, en
     * cel·les; `null` = tota la graella).
     * cov = % de píxels que casen amb el color (±tol per canal) sobre l'ÀREA DEL RECTANGLE
     * (no de la graella) → els llindars d'una faceta es llegeixen igual que els d'un color únic.
     * `axes` diu QUINES vores (del rectangle) desqualifiquen la taca:
     *   'y' (per defecte) = només dalt/baix. MESURAT amb dades reals (TN Migdia 2026-10-05,
     *      roi_real.raw): el rètol TITOLET és una xinxeta ancorada a l'ESQUERRA del frame
     *      (x0 = 0 SEMPRE) → comprovar les vores X el descartava TOT (0 intervals). El que
     *      sí que delata un FONS de grafisme és que la taca ompli el ROI de dalt a baix.
     *   'xy' = les quatre vores (comportament estricte original) · 'none' = cap.
     */
    function _analyzeRect(buf, off, w, h, rgb, tol, minEdgeFrac, axes, rect) {
        const cx0 = (rect && rect.cx0 != null) ? rect.cx0 : 0;
        const cx1 = (rect && rect.cx1 != null) ? rect.cx1 : w;
        const cy0 = (rect && rect.cy0 != null) ? rect.cy0 : 0;
        const cy1 = (rect && rect.cy1 != null) ? rect.cy1 : h;
        const rw = Math.max(1, cx1 - cx0), rh = Math.max(1, cy1 - cy0);
        let count = 0;
        let x0 = rw, x1 = -1, y0 = rh, y1 = -1;
        for (let y = cy0; y < cy1; y++) {
            const row = off + y * w * 3;
            for (let x = cx0; x < cx1; x++) {
                const p = row + x * 3;
                const r = _byteAt(buf, p), g = _byteAt(buf, p + 1), b = _byteAt(buf, p + 2);
                if (Math.abs(r - rgb.r) <= tol && Math.abs(g - rgb.g) <= tol && Math.abs(b - rgb.b) <= tol) {
                    count++;
                    const rx = x - cx0, ry = y - cy0;
                    if (rx < x0) x0 = rx;
                    if (rx > x1) x1 = rx;
                    if (ry < y0) y0 = ry;
                    if (ry > y1) y1 = ry;
                }
            }
        }
        const cov = (count * 100) / (rw * rh);
        const ax = axes || 'y';
        let edge = false;
        if (count > 0) {
            const mx = Math.max(1, Math.round(rw * minEdgeFrac));
            const my = Math.max(1, Math.round(rh * minEdgeFrac));
            const eX = (ax.indexOf('x') !== -1) && ((x0 < mx) || (x1 >= rw - mx));
            const eY = (ax.indexOf('y') !== -1) && ((y0 < my) || (y1 >= rh - my));
            edge = eX || eY;
        }
        return { cov: cov, x0: x0, x1: x1, y0: y0, y1: y1, edge: edge };
    }

    /**
     * _analyzeFrame: mesura UN frame RGB24 del ROI amb UN color (àlies de `_analyzeRect` amb
     * tota la graella). Es manté perquè és l'eina dels ajustos manuals i dels tests.
     */
    function _analyzeFrame(buf, off, w, h, rgb, tol, minEdgeFrac, axes) {
        return _analyzeRect(buf, off, w, h, rgb, tol, minEdgeFrac, axes, null);
    }

    // ─── PUR: MULTI-COLOR (2026-10-09, 8a passada) ───────────────────────────
    /**
     * _facetsOf: (PURA) Facetes VÀLIDES d'una recepta (`[]` si no n'hi ha cap). Una faceta
     * sense `color` propi hereta el de la recepta; sense `roiX`/`roiY`, la zona de la recepta.
     */
    function _facetsOf(cfg) {
        const f = (cfg && cfg.facets) ? cfg.facets : null;
        if (!f || !f.length) return [];
        const out = [];
        for (const x of f) {
            if (!x) continue;
            if (x.color === undefined && !cfg.color) continue;
            out.push(x);
        }
        return out;
    }

    /** _facetLog: text curt de les facetes (color@zona(llindars)) per als logs. */
    function _facetLog(cfg) {
        const fs = _facetsOf(cfg);
        if (!fs.length) return '';
        const parts = [];
        for (const f of fs) {
            const c = (f.color !== undefined) ? f.color : cfg.color;
            const zx = f.roiX || cfg.roiX || [0, 1], zy = f.roiY || cfg.roiY || [0, 1];
            const own = (f.roiX || f.roiY) ? '' : '*';
            const mn = (f.minCov != null) ? f.minCov : cfg.minCov;
            const mx = (f.maxCov != null) ? f.maxCov : cfg.maxCov;
            const ax = (f.edgeAxes !== undefined) ? f.edgeAxes : cfg.edgeAxes;
            parts.push(c + '@x' + zx[0] + '-' + zx[1] + own + ' y' + zy[0] + '-' + zy[1] +
                ' (' + mn + '-' + mx + '%, vores ' + ax + ')');
        }
        return parts.join(' + ');
    }

    /**
     * _facetRect: (PURA) Zona d'una FACETA (fracció de FRAME) → cel·les de la graella w×h de
     * la ROI mare (`hull`). `null` = la faceta no declara zona → tota la ROI mare (és el
     * comportament d'un color únic: la cobertura es mesura sobre tota la graella).
     */
    function _facetRect(f, hullX, hullY, w, h) {
        const zx = (f && f.roiX) ? f.roiX : null;
        const zy = (f && f.roiY) ? f.roiY : null;
        if (!zx && !zy) return null;
        const HX = (hullX && hullX.length === 2) ? hullX : [0, 1];
        const HY = (hullY && hullY.length === 2) ? hullY : [0, 1];
        const sx = Math.max(1e-6, HX[1] - HX[0]), sy = Math.max(1e-6, HY[1] - HY[0]);
        const a = zx || HX, b = zy || HY;
        let cx0 = Math.floor((((a[0] - HX[0]) / sx) * w));
        let cx1 = Math.ceil((((a[1] - HX[0]) / sx) * w));
        let cy0 = Math.floor((((b[0] - HY[0]) / sy) * h));
        let cy1 = Math.ceil((((b[1] - HY[0]) / sy) * h));
        cx0 = Math.max(0, Math.min(w - 1, cx0));
        cx1 = Math.max(cx0 + 1, Math.min(w, cx1));
        cy0 = Math.max(0, Math.min(h - 1, cy0));
        cy1 = Math.max(cy0 + 1, Math.min(h, cy1));
        return { cx0: cx0, cx1: cx1, cy0: cy0, cy1: cy1 };
    }

    /**
     * _frameSummary: (PURA) Mètrica d'UN frame amb la RECEPTA sencera.
     *   · Sense `facets` → un sol color amb els llindars de la recepta (`on` queda `undefined`:
     *     qui decideix si el frame és ON és `groupIntervals`, com sempre).
     *   · Amb `facets` → mira CADA color dins la SEVA zona: el frame és ON (`on: true`) si
     *     ALGUNA faceta passa els SEUS llindars i no se l'ha descartat la vora. `cov`/`edge`
     *     són de la faceta GUANYADORA (la que passa amb més cobertura; si cap passa, la de
     *     més cobertura) → `maxCov`/`bestT` i l'OCR segueixen triant el frame bo.
     * @returns {{cov:number, edge:boolean, on:(boolean|undefined), facet:number,
     *            facets:(Array|null), x0:number, x1:number, y0:number, y1:number}}
     */
    function _frameSummary(buf, off, w, h, cfg) {
        const c = cfg || {};
        const fs = _facetsOf(c);
        const mef0 = (c.minEdgeFrac != null) ? c.minEdgeFrac : 0.04;
        if (!fs.length) {
            const m = _analyzeRect(buf, off, w, h, _hexToRgb(c.color),
                (c.tol != null) ? c.tol : 25, mef0, c.edgeAxes, null);
            return {
                cov: m.cov, edge: m.edge, on: undefined, facet: -1, facets: null,
                x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1
            };
        }
        const det = [];
        let best = -1, pass = -1;
        for (let k = 0; k < fs.length; k++) {
            const f = fs[k];
            const m = _analyzeRect(buf, off, w, h,
                _hexToRgb((f.color !== undefined) ? f.color : c.color),
                (f.tol != null) ? f.tol : ((c.tol != null) ? c.tol : 25),
                (f.minEdgeFrac != null) ? f.minEdgeFrac : mef0,
                (f.edgeAxes !== undefined) ? f.edgeAxes : c.edgeAxes,
                _facetRect(f, c.roiX, c.roiY, w, h));
            const mn = (f.minCov != null) ? f.minCov : ((c.minCov != null) ? c.minCov : 2.0);
            const mx = (f.maxCov != null) ? f.maxCov : ((c.maxCov != null) ? c.maxCov : 60);
            det.push({
                k: k, color: (f.color !== undefined) ? f.color : c.color, cov: m.cov,
                edge: m.edge, min: mn, max: mx,
                on: (m.cov >= mn) && (m.cov < mx) && !m.edge,
                x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1
            });
            if (best === -1 || det[k].cov > det[best].cov) best = k;
            if (det[k].on && (pass === -1 || det[k].cov > det[pass].cov)) pass = k;
        }
        const win = (pass !== -1) ? det[pass] : det[best];
        return {
            cov: win.cov, edge: win.edge, on: (pass !== -1), facet: win.k, facets: det,
            x0: win.x0, x1: win.x1, y0: win.y0, y1: win.y1
        };
    }

    /**
     * analyzeFrameAt: mesura UN frame concret d'una sèrie rgb24 (cobertura, bbox i si
     * toca les vores), amb la recepta sencera (multi-color si en porta). És l'eina per
     * AJUSTAR la ROI amb dades reals (dry-run/log).
     */
    function analyzeFrameAt(buf, w, h, i, cfg) {
        return _frameSummary(buf, i * w * h * 3, w, h, cfg);
    }

    /**
     * analyzeSeries: recorre TOTS els frames del .raw (rgb24 encadenat) i en treu la
     * mètrica de cada mostra.
     * @param {string|Uint8Array} buf - buffer de tota la sèrie (frames seguits)
     * @param {number} w · @param {number} h - dimensions del ROI de cada frame
     * @param {Object} cfg - { color, tol, scanFps, minEdgeFrac, edgeAxes, tStart } i, si
     *   la recepta és MULTI-COLOR, { roiX, roiY, facets, minCov, maxCov } (les zones de
     *   les facetes es resolen amb la graella w×h: vegeu `_facetRect`).
     * @returns {Array<{i:number,t:number,cov:number,edge:boolean,on:(boolean|undefined)}>}
     *   `on` només hi és quan la recepta porta `facets` (decideix `groupIntervals`).
     */
    function analyzeSeries(buf, w, h, cfg) {
        const fps = cfg.scanFps || 1;
        const tStart = (cfg.tStart != null) ? cfg.tStart : 0;
        const frameBytes = w * h * 3;
        const total = Math.floor((buf.length || 0) / frameBytes);
        const out = [];
        for (let i = 0; i < total; i++) {
            const m = _frameSummary(buf, i * frameBytes, w, h, cfg);
            out.push({
                i: i, t: tStart + i / fps, cov: Math.round(m.cov * 1000) / 1000,
                edge: m.edge, on: m.on
            });
        }
        return out;
    }

    /**
     * groupIntervals: converteix la sèrie de mostres en intervals ON (rètol visible).
     * Un frame és ON si cov >= minCov i !edge — o segons el veredicte `on` de la mostra, que
     * és el cas de les receptes MULTI-COLOR (`facets`). S'hi fusiona tot buit <= (minOff+gapMergeSec)
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
            // 🎨 MULTI-COLOR (2026-10-09, 8a passada): amb `facets`, cada mostra ja porta el
            // SEU veredicte (`f.on`, calculat amb els llindars de cada color a la seva zona)
            // i aquí no s'hi tornen a aplicar els de la recepta. Sense facetes, comportament
            // de sempre (el frame és ON si cov >= minCov, < maxCov i no toca les vores).
            const on = (f.on !== undefined) ? !!f.on : ((f.cov >= minCov) && (f.cov < maxCov) && !f.edge);
            if (!on) continue;
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
     * roleGroups: (PURA) Agrupa els índexs de wott de l'ítem per RECEPTA IDÈNTICA. Cada grup
     * és una passada d'ffmpeg independent (la seva ROI i els seus llindars) i els seus
     * intervals només poden assignar-se els wotts del grup (vegeu `_groupAllow`).
     * @param {Object} cfg
     * @param {Array<string>} roles - una etiqueta per wott
     * @returns {Array<{role:string, wotts:Array<number>, recipe:Object}>}
     */
    function roleGroups(cfg, roles) {
        const c = cfg || {};
        const list = (roles && roles.length) ? roles.slice() : [null];
        const groups = [], keys = [];
        for (let i = 0; i < list.length; i++) {
            const r = _recipeOf(c, list[i]);
            const k = ROI_KEYS.map(x => JSON.stringify(r[x] === undefined ? null : r[x])).join('|');
            let gi = keys.indexOf(k);
            if (gi === -1) {
                gi = keys.length; keys.push(k);
                groups.push({ role: list[i], wotts: [], recipe: r });
            }
            groups[gi].wotts.push(i);
        }
        return groups;
    }

    /**
     * _groupAllow: (PURA) Índexs de wott que pot reclamar l'interval `i` quan l'ítem té MÉS
     * D'UN grup de rastreig (receptes diferents). `null` = sense restricció (un sol grup, o
     * pla desat sense `ivGroups`).
     */
    function _groupAllow(cfg, i) {
        if (!cfg || !cfg.ivGroups || !cfg.groups) return null;
        const g = cfg.ivGroups[i];
        if (g === undefined || g === null) return null;
        const gr = cfg.groups[g];
        return (gr && gr.wotts) ? gr.wotts : null;
    }

    /**
     * _sameGroup: (PURA) El wott `w` i l'interval `i` són del mateix grup de rastreig?
     * Sense grups (`ivGroups`/`wottGroups` absents) sempre true (comportament antic).
     */
    function _sameGroup(cfg, w, i) {
        if (!cfg || !cfg.ivGroups || !cfg.wottGroups) return true;
        const gw = cfg.wottGroups[w], gi = cfg.ivGroups[i];
        if (gw === undefined || gi === undefined) return true;
        return gw === gi;
    }

    /**
     * pickWott: millor wott per a UN text OCR (diagnòstic; el pla usa assignIntervals).
     * @param {string} ocrText
     * @param {Array<string>} names
     * @param {Object} cfg
     * @param {Object|Array} [taken] - wotts JA assignats (map per índex o array): es
     *   descarten. Ho fa servir l'escaneig endavant per no repetir un wott.
     * @param {Array<number>} [allow] - restricció de grup (2026-10-08, 7a passada): NOMÉS
     *   aquests índexs són candidats, perquè cada passada de rastreig té la SEVA ROI.
     * @returns {{index:number, score:number, token:string, how:string}}
     */
    function pickWott(ocrText, names, cfg, taken, allow) {
        const fuzz = (cfg && cfg.ocrFuzz != null) ? cfg.ocrFuzz : 0.55;
        const isTaken = (i) => !!(taken && (taken[i] === true || taken[i] === i + 1));
        const inGroup = (i) => (!allow || allow.indexOf(i) !== -1);
        let best = { index: -1, score: 0, token: '', how: 'sense-text' };
        if (_normText(ocrText).length < 3) return best;
        for (let i = 0; i < names.length; i++) {
            if (isTaken(i) || !inGroup(i)) continue;
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
            // (2026-10-08, 7a passada) Restricció de grup: si l'ítem es va rastrejar amb MÉS
            // D'UNA recepta de ROI, aquest interval només pot ser d'un wott del SEU grup.
            const allow = _groupAllow(cfg, i);
            const per = [];
            let bestW = -1, bestS = 0;
            for (let w = 0; w < names.length; w++) {
                if (allow && allow.indexOf(w) === -1) continue;
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
                // (2026-10-08, 7a passada) Amb grups de ROI, l'interval ha de ser del grup del wott.
                if (!_sameGroup(cfg, w, j)) continue;
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
            roiX: (cfg && cfg.roiX) || null,
            w: w, h: h, fps: (cfg && cfg.scanFps) || 1
        });
        if (!sc.ok) return { ok: false, error: sc.error };
        const buf = _readBinary(sc.path);
        if (!buf) return { ok: false, error: 'no s\'ha pogut llegir el .raw (' + sc.path + ')' };
        const series = analyzeSeries(buf, sc.w, sc.h, {
            color: cfg.color, tol: cfg.tol, scanFps: sc.fps, minEdgeFrac: cfg.minEdgeFrac,
            // ⚠️ `edgeAxes` s'ha de passar EXPLÍCITAMENT: abans no hi era i `_analyzeFrame` hi
            // queia al seu valor per defecte ('y'), així que una recepta amb 'none' no s'aplicava.
            edgeAxes: cfg.edgeAxes, tStart: tStart,
            // 🎨 MULTI-COLOR (2026-10-09, 8a passada): les facetes necessiten la ROI MARE (el
            // rectangle que s'ha extret) per situar la zona de cada color dins la graella, i
            // els llindars de la recepta com a herència de les facetes que no els declaren.
            roiX: cfg.roiX, roiY: cfg.roiY, facets: cfg.facets,
            minCov: cfg.minCov, maxCov: cfg.maxCov
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
                // (2026-10-08, 7a passada) Cada interval porta la recepta del SEU grup de
                // rastreig: refinar-lo amb la ROI d'un altre grup no hi veuria el rètol.
                const cIv = (f.iv && f.iv.recipe) ? Object.assign({}, cfg, f.iv.recipe) : cfg;
                const r = await refineEntry(mp4, f.iv, cIv, label);
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
     *   3 = (2026-10-08, 7a passada) + grups de ROI per etiqueta (cada interval només pot
     *       assignar-se els wotts del seu grup de rastreig)
     *   4 = (2026-10-09, 8a passada) + MULTI-COLOR per etiqueta (`facets`): un frame és ON si
     *       alguna faceta hi passa a la SEVA zona amb els SEUS llindars
     */
    const ALGO = 4;

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
        const obj = {
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
        };
        // (2026-10-08, 7a passada) La X de la ROI només entra a la clau si RESTRINGEIX (una
        // recepta d'etiqueta amb mitja imatge): amb `roiX: null` l'escaneig és el de sempre i
        // la clau ha de continuar sent la mateixa per aprofitar el pla ja desat.
        if (cfg && cfg.roiX) obj.cfg.roiX = cfg.roiX;
        // 🎨 MULTI-COLOR (2026-10-09, 8a passada): canviar les facetes (colors, zones o
        // llindars) canvia el resultat → ha d'invalidar el pla desat. Només entren a la clau
        // quan n'hi ha, així els ítems sense facetes conserven la seva clau de sempre.
        if (cfg && cfg.facets && cfg.facets.length) obj.cfg.facets = cfg.facets;
        // (2026-10-08, 7a passada) Només els ítems amb MÉS D'UNA recepta de ROI necessiten la
        // signatura dels grups: així la clau dels ítems d'una sola recepta (TITOLET) NO canvia
        // i el pla que ja tenien desat es continua reaprofitant.
        if (cfg && cfg.groupsSig) obj.groupsSig = cfg.groupsSig;
        return 'C:\\temp\\titolet_plan_' + _hash32(JSON.stringify(obj)) + '.json';
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
                intervals: plan.intervals, ocrTexts: plan.ocrTexts, assign: plan.assign,
                ivGroups: plan.ivGroups || []
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
            // (2026-10-08, 7a passada) Grup de rastreig de cada interval (quan l'ítem té més
            // d'una recepta de ROI): sense això, recalcular el pla des de la caché perdria la
            // restricció interval ↔ wotts del grup.
            ivGroups: (cfg && cfg.ivGroups) || [],
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
     * @param {Object} p - { mp4, tItemStart, names, tScanStart, tScanDur, cfg, label, roles }
     *   tItemStart = segon del MP4 on arrenca l'ítem (marcador) → els temps del pla
     *   queden RELATIUS a l'ítem, que és com els fa servir la cadena TITOLET.
     *   roles = etiqueta de rol (el 4t camp del nom) de CADA wott, per longitud. Si no
     *   s'informa, tots es tracten com a 'TITOLET' (la recepta mesurada = comportament antic).
     * @returns {Promise<{ok:boolean, cards:Array, stats:Object, intervals:Array, ocrTexts:Array, error?:string}>}
     */
    async function planForItem(p) {
        const cfgBase = p.cfg || {};
        const label = p.label || 'item';
        const empty = (err) => ({ ok: false, error: err, cards: [], stats: {}, intervals: [], ocrTexts: [] });
        try {
            if (!p.mp4) return empty('sense MP4 cleanFeed');
            const names = p.names || [];
            // ── 🎯 GRUPS DE RASTREIG PER ETIQUETA (2026-10-08, 7a passada) ────────────────
            // Un ítem pot portar etiquetes de NATURALESA diferent (un TITOLET viu a la banda
            // baixa; un PREGUNTA, a mitja imatge). Amb una sola ROI mesurada (la del TITOLET)
            // els PREGUNTA no es veien (0 intervals al cas real de TNM V3). Aquí es fa UNA
            // passada d'escaneig per RECEPTA de ROI i cada interval només pot assignar-se els
            // wotts del SEU grup. Amb una sola recepta tot queda EXACTAMENT com abans.
            const roles = (p.roles && p.roles.length === names.length) ? p.roles : names.map(() => 'TITOLET');
            const groups = roleGroups(cfgBase, roles);
            const groupsSig = (groups.length > 1)
                ? groups.map(g => g.role + '=' + ROI_KEYS.map(k => JSON.stringify(g.recipe[k] === undefined ? null : g.recipe[k])).join(',')).join(';')
                : null;
            const grpInfo = { groups: groups.map(g => ({ role: g.role, wotts: g.wotts })), wottGroups: [] };
            for (let gi = 0; gi < groups.length; gi++) {
                for (const wi of groups[gi].wotts) grpInfo.wottGroups[wi] = gi;
            }
            const cfg = Object.assign({}, recipeForRoles(cfgBase, roles), {
                groups: grpInfo.groups, wottGroups: grpInfo.wottGroups,
                groupsSig: groupsSig, ivGroups: []
            });
            if (groups.length > 1) {
                utils.log('🎯 [titolet] ' + label + ': ' + groups.length + ' grups de rastreig (' +
                    groups.map(g => g.role + ' ×' + g.wotts.length).join(' · ') +
                    ') → una passada d\'ffmpeg per grup');
            }
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
                        // (7a passada) El grup de cada interval també ve de la caché (si hi és):
                        // sense això, recalcular perdria la restricció interval ↔ grup.
                        cfg.ivGroups = hit.ivGroups || [];
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
            const endAbs = tStart + Math.max(1, p.tScanDur || 0);
            const allIvs = [], found = [], taken = {}, ivsText = [], ivGroups = [];
            let sawWeak = false;
            let nSamples = 0, nChunks = 0, w = cfg.roiW || 160, h = cfg.roiH || 45;
            // Wotts trobats que són del grup `gi` (cada grup s'atura quan té els SEUS).
            const nInGroup = (gi) => {
                let n = 0;
                for (const f of found) if (groups[gi].wotts.indexOf(f.w) !== -1) n++;
                return n;
            };
            for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            const gc = recipeForRoles(cfgBase, [g.role]);
            if (groups.length > 1) {
                utils.log('🎯 [titolet] ' + label + ' grup ' + (gi + 1) + '/' + groups.length + ' «' + g.role +
                    '»: ' + g.wotts.length + ' wott(s) · ROI x ' + (gc.roiX ? (gc.roiX[0] + '→' + gc.roiX[1]) : '0→1') +
                    ' · y ' + gc.roiY[0] + '→' + gc.roiY[1] + ' · vores ' + gc.edgeAxes +
                    ' · cov ' + gc.minCov + '-' + gc.maxCov + '% (' + (g.recipe.from || 'base') + ')');
            }
            // 🎨 MULTI-COLOR (8a passada): si la recepta del grup porta colors (facets), es diu
            // un cop per grup — color, zona i llindars de CADA faceta (l'* = zona de la recepta).
            const flog = _facetLog(gc);
            if (flog) {
                utils.log('   🎨 [titolet] ' + label + ' grup ' + (gi + 1) + '/' + groups.length +
                    ' «' + g.role + '» colors ' + _facetsOf(gc).length + ': ' + flog);
            }
            let cursor = tStart;
            while (cursor < endAbs && (nInGroup(gi) < g.wotts.length || sawWeak)) {
                const len = Math.min(chunk, endAbs - cursor);
                nChunks++;
                const sc = await scanMp4(p.mp4, cursor, len, gc);
                if (!sc.ok) return empty(sc.error);
                nSamples += (sc.series || []).length;
                w = sc.w; h = sc.h;
                const ivs = groupIntervals(sc.series, gc);
                utils.log('🎯 [titolet] ' + label + ' tram ' + nChunks + ' [' + cursor.toFixed(1) + 's→' +
                    (cursor + len).toFixed(1) + 's]: ' + (sc.series || []).length + ' mostres (' + sc.w + 'x' + sc.h +
                    ') → ' + ivs.length + ' intervals');
                for (const iv of ivs) {
                    if (found.length >= names.length && !sawWeak) break;
                    allIvs.push(iv);
                    // (7a passada) El grup de rastreig de l'interval i la SEVA recepta de ROI:
                    // el recàlcul i el refinament han de mirar on es va veure el rètol.
                    ivGroups.push(gi);
                    iv.recipe = roiOnly(gc);
                    const ivIdx = allIvs.length - 1;
                    const relIn = Math.round((iv.tIn - t0) * 1000) / 1000;
                    const insts = (gc.ocr === false) ? [] : _attemptInstants(iv, gc);
                    let enc = null, text = '', tUsed = null;
                    for (let k = 0; k < insts.length && !enc; k++) {
                        const txt = await ocrAtInstant(p.mp4, insts[k], gc, label + '_' + Math.round(relIn) + '_', k);
                        if (txt) {
                            text = txt;
                            const c = pickWott(txt, names, gc, taken, g.wotts);
                            // 🔴 (5a passada) MATCH FEBLE amb text ALIÈ: si el text ja és (millor)
                            // d'un altre wott, aquest interval és una REPETICIÓ del rètol d'aquell
                            // wott → no es consumeix aquest wott. (Cas real: el ZAPATERO s'hi va
                            // emparellar amb 0,556 i va anar 10,5 s abans del seu lloc.)
                            const weak = (gc.ocrWeak != null) ? gc.ocrWeak : 0.7;
                            const anyW = c.index >= 0 ? pickWott(txt, names, gc, null, g.wotts) : null;
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
                    } else if (gc.ocr !== false) {
                        utils.log('   ❌ [titolet] ' + label + ' interval @ ' + iv.tIn.toFixed(2) + 's (relIn ' +
                            relIn + 's) descartat: cap wott pendent en ' + insts.length + ' intent(s)');
                    }
                }
                cursor += len;      // ← el cursor NOMÉS avança: mai es re-rastreja enrere
            }
            }

            // (5a passada) El pla es RECALCULA amb TOTES les dades (no amb les decisions
            // incrementals de l'escaneig): mateixa assignació que faria la caché recalçada.
            cfg.ivGroups = ivGroups;
            const plan = await planFromRaw(p.mp4, allIvs, ivsText, names, t0, cfg, label);
            const st = plan.stats;
            utils.log('🎯 [titolet] ' + label + ': ' + st.nMatched + '/' + names.length + ' wotts · ' +
                allIvs.length + ' intervals · ' + nChunks + ' tram(s) · ' + nSamples + ' mostres (' + w + 'x' + h + ')' +
                ((groups.length > 1) ? ' · ' + groups.length + ' grups de ROI' : '') +
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
        // ── pures: ROI per etiqueta (7a passada) ──
        recipeOf: _recipeOf,
        recipeForRoles: recipeForRoles,
        roleGroups: roleGroups,
        roiOnly: roiOnly,
        groupAllow: _groupAllow,
        sameGroup: _sameGroup,
        roiKeys: ROI_KEYS,
        // ── pures: MULTI-COLOR per etiqueta (8a passada) ──
        facetsOf: _facetsOf,
        facetLog: _facetLog,
        facetRect: _facetRect,
        analyzeRect: _analyzeRect,
        frameSummary: _frameSummary,
        // ── orquestració (CEP: ffmpeg + OCR + IO) ──
        ocrText: ocrText,
        scanMp4: scanMp4,
        planForItem: planForItem
    };
})();
