/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader - Sub-mòdul: Precision Trim + Fallback
 * Extiende el objeto base creado en escaleta_reader.js
 * ============================================================================
 */

(function () {
    var ER = window.FASTPASS_UI && window.FASTPASS_UI.EscaletaReader;
    if (!ER) return;

    const utils = function () { return window.FASTPASS_UI.Utils; };
    const callJSX = function (s) { return window.FASTPASS_UI.Utils.callJSX(s); };
    const log = function (m) { window.FASTPASS_UI.Utils.log(m, 'DEBUG'); };

    // ----------------------------------------------------------------
    // SISTEMA DE PRECISIÓ DE TRIM (3+1 TIERS)
    // ----------------------------------------------------------------

    /**
     * _findCaretasBetween: Busca items amb títol de careta entre dos índexs
     * (exclusiu) dins de allLines i retorna la suma de les seves duracions reals.
     * La durada es llegeix de l'item de l'escaleta, aplicant correccions si
     * es proporciona el JSON complet (data) per detectar programa i edició.
     *
     * @param {Array} allLines - Array complet de liniesEscaleta
     * @param {number} fromIdx - Índex inicial (exclusiu, es busca desde fromIdx+1)
     * @param {number} toIdx   - Índex final (exclusiu, es busca fins a toIdx-1)
     * @param {Object} [data]  - JSON complet de l'escaleta (per correcció per programa)
     * @returns {{ totalDur: number, names: string[] }}
     */
    ER._findCaretasBetween = function (allLines, fromIdx, toIdx, data) {
        let totalDur = 0;
        const names = [];

        // FIX (2026-05-19): Quan els índexs estan invertits (video previ apareix
        // després en l'array que el bloc), buscar caretes per rang de TEMPS en
        // lloc de rang d'índexs. Ex: V1 té blockStartIdx=3 però el video previ
        // és a l'índex 28 → toIdx(3) < fromIdx(28).
        if (toIdx < fromIdx) {
            const fromItem = allLines[fromIdx];
            const toItem = allLines[toIdx];
            if (!fromItem || !toItem) return { totalDur: 0, names: [] };

            var fromEndSec = this.tcToSeconds(fromItem.horaEntradaOnAir)
                + this.parseDurada(fromItem.duradaOnAir || fromItem.durada);
            var toStartSec = this.tcToSeconds(toItem.horaEntradaPrevista);

            for (var i = 0; i < allLines.length; i++) {
                var itemA = allLines[i];
                if (!itemA || !itemA.titol) continue;
                if (itemA.flotant === true) continue;
                var titleA = itemA.titol.trim().toUpperCase();
                if (titleA.indexOf('CARETA') !== -1) {
                    var itemStart = this.tcToSeconds(itemA.horaEntradaPrevista);
                    if (itemStart >= fromEndSec && itemStart < toStartSec) {
                        var dur = data
                            ? this._getCorrectedDuration(itemA, data)
                            : this.parseDurada(itemA.duradaOnAir || itemA.durada);
                        totalDur += dur;
                        names.push(itemA.titol);
                    }
                }
            }
            return { totalDur: totalDur, names: names };
        }

        // Cas normal: búsqueda per rang d'índexs (toIdx > fromIdx)
        for (let i = fromIdx + 1; i < toIdx; i++) {
            const item = allLines[i];
            if (!item || !item.titol) continue;
            // Saltar items flotants (s'han saltat en emissió, no rellevants)
            if (item.flotant === true) continue;
            // Buscar si el títol conté "CARETA" (indicador de careta)
            const title = item.titol.trim().toUpperCase();
            if (title.indexOf('CARETA') !== -1) {
                // Usar durada corregida si tenim data, sino la durada original
                const dur = data
                    ? this._getCorrectedDuration(item, data)
                    : this.parseDurada(item.duradaOnAir || item.durada);
                totalDur += dur;
                names.push(item.titol);
            }
        }
        return { totalDur: totalDur, names: names };
    };

    /**
     * calcPrecisionTrimBounds: Sistema de 2+1 passos per calcular els bounds
     * de trim del MP4 usant els TCs reals dels items emesos (horaEntradaOnAir)
     * en lloc dels TCs del bloc (que porten handles de -1min/+2min).
     *
     * ── Per a l'INICI (IN): 2 TIERS + FALLBACK ──
     *   Tier 0 (OnAir anterior + caretes): Item anterior (qualsevol bloc