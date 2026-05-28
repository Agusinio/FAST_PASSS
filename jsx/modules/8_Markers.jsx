/**
 * =================================================================================
 * 8_Markers.jsx
 * Gestió de marcadors de seqüència (v1.1)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Markers = (function() {
    
    function _seq() {
        return app.project.activeSequence;
    }

    /**
     * Helper: extreu el prefix d'un comentari de marcador.
     * Format esperat: "03 - Titol" → "03", "04i - intro" → "04i".
     * Retorna cadena buida si no troba patró.
     */
    function _extractPrefix(comment) {
        if (!comment) return '';
        var spaceDashIdx = comment.indexOf(' -');
        if (spaceDashIdx <= 0) return '';
        // ES3 no té String.trim(); usar replace amb regex
        return comment.substring(0, spaceDashIdx).replace(/^\s+|\s+$/g, '');
    }

    /**
     * Helper: assigna color a un objecte marcador de Premiere.
     * @param {Marker} markerObj - objecte marcador de PPro
     * @param {number} colorIdx - índex de color (0-7)
     */
    function _setMarkerColor(markerObj, colorIdx) {
        if (colorIdx === null || isNaN(colorIdx)) return;
        colorIdx = Math.max(0, Math.min(7, colorIdx));
        // BUG #9: Sempre assignar markerObj.color perquè sigui llegible després.
        // Abans només s'assignava al else (quan setColorByIndex no existia),
        // per tant existing.color sempre retornava -1 en marcadors creats per nosaltres.
        markerObj.color = colorIdx;
        if (typeof markerObj.setColorByIndex === "function") {
            markerObj.setColorByIndex(colorIdx);
        }
    }

    return {
        /**
         * get: Obté tots els marcadors de la seqüència activa.
         * @returns {string} JSON array de {time, name, comments, color}
         */
        get: function() {
            try {
                var s = _seq();
                if (!s) return "[]";
                var m = s.markers;
                var res = [];
                var current = m.getFirstMarker();
                while (current) {
                    var colorIdx = -1;
                    try { colorIdx = current.color; } catch (e2) { /* color no disponible */ }
                    res.push({
                        time: current.start.seconds,
                        name: current.name,
                        comments: current.comments,
                        color: (typeof colorIdx === "number") ? colorIdx : -1
                    });
                    current = m.getNextMarker(current);
                }
                return JSON.stringify(res);
            } catch(e) { return "[]"; }
        },

        /**
         * set: Afegeix un marcador a la seqüència.
         * @param {number} time - Temps d'inici en segons
         * @param {string} comment - Comentari
         * @param {string} name - Nom (o "color=N")
         * @param {number} duration - Durada en segons (opcional)
         */
        set: function(time, comment, name, duration) {
            try {
                var s = _seq();
                if (!s) return "ERR:NO_SEQ";
                var m = s.markers.createMarker(time);
                
                // Durada (Fase B: Marcadors de barra)
                if (duration && !isNaN(duration)) {
                    var tDur = new Time();
                    tDur.seconds = parseFloat(duration);
                    m.duration = tDur.ticks;
                }

                // Extraer índice numérico de color del parámetro name "color=N"
                var colorIdx = null;
                if (typeof name === 'string' && name.indexOf('color=') === 0) {
                    colorIdx = parseInt(name.substring(6), 10);
                    name = "Línia Escaleta";
                }
                m.name = name || "Línia Escaleta";
                m.comments = comment || "";
                
                _setMarkerColor(m, colorIdx);
                
                return "OK";
            } catch(e) { return "ERR:" + e.message; }
        },

        /**
         * clear: Elimina tots els marcadors.
         */
        clear: function() {
            try {
                var s = _seq();
                if (!s) return "ERR:NO_SEQ";
                var m = s.markers;
                var current = m.getFirstMarker();
                while (current) {
                    m.deleteMarker(current);
                    current = m.getFirstMarker();
                }
                return "OK";
            } catch(e) { return "ERR:" + e.message; }
        },

        /**
         * moveByPrefixes: Mou marcadors existents canviant la seva posició
         * (start.seconds) si el seu comentari comença per un dels prefixes.
         * Format esperat del comment: "03 - Titol" o "04i - intro".
         *
         * @param {string} movesJson - JSON array d'objectes {prefix, newTimeSec}
         *        Ex: '[{"prefix":"03","newTimeSec":45.5},{"prefix":"04i","newTimeSec":120.3}]'
         * @returns {string} JSON {moved, prefixes}
         */
        moveByPrefixes: function(movesJson) {
            try {
                var s = _seq();
                if (!s) return JSON.stringify({ moved: 0, prefixes: [], error: "NO_SEQ" });
                var moves = JSON.parse(movesJson);
                var moveMap = {};
                for (var mi = 0; mi < moves.length; mi++) {
                    moveMap[moves[mi].prefix] = moves[mi].newTimeSec;
                }
                var moved = 0;
                var movedPrefixes = [];
                var m = s.markers;
                var current = m.getFirstMarker();
                while (current) {
                    var prefix = _extractPrefix(current.comments);
                    if (prefix !== '' && moveMap.hasOwnProperty(prefix)) {
                        current.start.seconds = moveMap[prefix];
                        moved++;
                        movedPrefixes.push(prefix);
                        delete moveMap[prefix];
                    }
                    current = m.getNextMarker(current);
                }
                return JSON.stringify({ moved: moved, prefixes: movedPrefixes });
            } catch(e) { return JSON.stringify({ moved: 0, prefixes: [], error: e.message }); }
        },

        /**
         * placeByPrefixes: UPSERT atòmic de marcadors.
         * Per cada placement, si existeix un marcador amb el mateix prefix
         * al comentari → el mou. Si no existeix → el crea.
         * Tota la lògica (cerca, decisió, execució) es resol al JSX en una sola
         * crida, sense que el JS hagi de preocupar-se de quins marcadors
         * existeixen o no.
         *
         * @param {string} placementsJson - JSON array d'objectes:
         *        {prefix, timeSec, comment, colorIdx}
         *        Ex: '[{"prefix":"03","timeSec":45.5,"comment":"03 - Titol","colorIdx":1}]'
         * @returns {string} JSON {placed, moved, created}
         */
        placeByPrefixes: function(placementsJson) {
            try {
                var s = _seq();
                if (!s) return JSON.stringify({ placed: 0, moved: 0, created: 0, error: "NO_SEQ" });
                var placements = JSON.parse(placementsJson);

                // ── 1. Indexar tots els marcadors existents per prefix ──
                var existingByPrefix = {};
                var markerList = [];
                var m = s.markers;
                var current = m.getFirstMarker();
                while (current) {
                    var prefix = _extractPrefix(current.comments);
                    if (prefix !== '') {
                        existingByPrefix[prefix] = current;
                        markerList.push({ marker: current, prefix: prefix });
                    }
                    current = m.getNextMarker(current);
                }

                var movedCount = 0;
                var createdCount = 0;

                // ── 2. Per cada placement: moure si existeix, crear si no ──
                for (var pi = 0; pi < placements.length; pi++) {
                    var p = placements[pi];
                    // Evitar temps negatius (són TCs anteriors a l'àncora)
                    var safeTime = p.timeSec;
                    if (safeTime < 0) safeTime = 0;
                    var existing = existingByPrefix[p.prefix];
                    if (existing) {
                        // Ja existeix → BUG #6: delete + create en lloc de start.seconds =
                        // perquè modificar start.seconds NO refresca visualment el timeline.
                        // Llegir metadata actual abans d'esborrar
                        var savedComments = existing.comments || '';
                        var savedColor = -1;
                        try { savedColor = existing.color; } catch (ec) { /* color no disponible */ }

                        // Eliminar el marcador existent
                        m.deleteMarker(existing);

                        // Crear nou marcador a la posició corregida
                        var newMarker = m.createMarker(safeTime);

                        // Restaurar/actualitzar metadata
                        newMarker.comments = (p.comment !== undefined && p.comment !== null) ? p.comment : savedComments;
                        newMarker.name = (p.name !== undefined && p.name !== null) ? String(p.name) : (existing.name || 'Línia Escaleta');

                        // Color: prioritat al placement, sinó restaurar l'original
                        // BUG #9: Amb el fix de _setMarkerColor (sempre assigna .color),
                        // savedColor ara hauria de ser correcte per a marcadors creats per FASTPASS.
                        // Fallback: si tot falla, no tocar el color (es queda verd per defecte).
                        if (p.colorIdx !== undefined && p.colorIdx !== null && p.colorIdx >= 0) {
                            _setMarkerColor(newMarker, p.colorIdx);
                        } else if (savedColor >= 0) {
                            _setMarkerColor(newMarker, savedColor);
                        }

                        movedCount++;
                    } else {
                        // No existeix → crear
                        var newMarker = m.createMarker(safeTime);
                        // name opcional: "definitiu" (F4) o "Línia Escaleta" (default)
                        newMarker.name = (p.name !== undefined && p.name !== null) ? String(p.name) : "Línia Escaleta";
                        newMarker.comments = p.comment || '';
                        _setMarkerColor(newMarker, p.colorIdx);
                        createdCount++;
                    }
                }

                var placed = movedCount + createdCount;
                return JSON.stringify({ placed: placed, moved: movedCount, created: createdCount });
            } catch(e) { return JSON.stringify({ placed: 0, moved: 0, created: 0, error: e.message }); }
        },

        /**
         * deleteByPrefixes: Elimina marcadors el comentari dels quals
         * comença per algun dels prefixes indicats.
         * Format esperat del comment: "03 - Titol" o "04i - intro".
         *
         * @param {string} prefixesJson - JSON array de strings
         *        Ex: '["03","04i","11"]'
         * @returns {string} "OK:N" on N = nombre de marcadors eliminats
         */
        deleteByPrefixes: function(prefixesJson) {
            try {
                var s = _seq();
                if (!s) return "ERR:NO_SEQ";
                var prefixes = JSON.parse(prefixesJson);
                var prefixSet = {};
                for (var pi = 0; pi < prefixes.length; pi++) {
                    prefixSet[prefixes[pi]] = true;
                }
                var deleted = 0;
                var m2 = s.markers;
                var cur = m2.getFirstMarker();
                while (cur) {
                    var pfx = _extractPrefix(cur.comments);
                    if (pfx !== '' && prefixSet.hasOwnProperty(pfx)) {
                        var next = m2.getNextMarker(cur);
                        m2.deleteMarker(cur);
                        deleted++;
                        cur = next;
                        continue;
                    }
                    cur = m2.getNextMarker(cur);
                }
                return "OK:" + deleted;
            } catch(e) { return "ERR:" + e.message; }
        },

    };
})();
