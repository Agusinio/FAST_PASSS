/* * =================================================================================
 * 6_Clips.jsx
 * Módulo especializado en la manipulación física de objetos Clip en el Timeline.
 * (v18 - RECONSTRUCCIÓN LITERAL - DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Clips = {

    /**
     * _get: Helper privat: Obté un objecte Track segons context ancorat.
     */
    _get: function(idx, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return null;
            var i = parseInt(idx) - 1; 
            if (i < 0) i = 0;
            var tracks = (type === "audio") ? seq.audioTracks : (type === "subtitle" ? seq.subtitleTracks : seq.videoTracks);
            if (!tracks || i >= tracks.numTracks) return null;
            return tracks[i];
        } catch(e) { return null; }
    },

    /**
     * count: Compta clips en una pista.
     */
    count: function(trackIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            return (track && track.clips) ? track.clips.numItems : 0;
        } catch(e) { return 0; }
    },

    /**
     * get: Obté data bàsica d'un clip per índex.
     */
    get: function(trackIdx, clipIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            if (!track || !track.clips) return "null";
            var clip = track.clips[clipIdx];
            if (!clip) return "null";

            return JSON.stringify({
                index: clipIdx,
                name: clip.name,
                start: clip.start.seconds,
                end: clip.end.seconds,
                inPoint: clip.inPoint.seconds,
                outPoint: clip.outPoint.seconds,
                duration: clip.duration.seconds,
                selected: clip.isSelected()
            });
        } catch(e) { return "null"; }
    },

    /**
     * getInPoint: Obté el start.seconds d'un clip (posició a la seqüència).
     * Útil per establir tcRef.clipStart post-inserció.
     */
    getInPoint: function(trackIdx, clipIdx, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track || !track.clips || track.clips.numItems <= clipIdx) return "null";
            return track.clips[clipIdx].inPoint.seconds.toString();
        } catch(e) { return "null"; }
    },

    /**
     * at: Troba i retorna dades d'un clip en un temps determinat.
     */
    at: function(trackIdx, timeSec, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track || !track.clips) return "null";
            var targetTime = (timeSec === -1) ? (app.project.activeSequence.getPlayerPosition().seconds) : parseFloat(timeSec);
            
            for (var i = 0; i < track.clips.numItems; i++) {
                var clip = track.clips[i];
                if (clip.start.seconds <= targetTime && clip.end.seconds > targetTime) {
                    return this.get(trackIdx, i, type);
                }
            }
            return "null";
        } catch(e) { return "null"; }
    },

    /**
     * remove: Elimina un clip.
     */
    remove: function(trackIdx, clipIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            var clip = track.clips[clipIdx];
            if (clip) {
                // (false,false): elimina només del timeline, sense moure a la paperera ni
                // tocar el projecte. Més fiable que (true,true) amb clips vinculats/MP4 compartit.
                clip.remove(false, false);
                return "OK";
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * unlink: Desvincula el clip (vídeo o àudio) del seu grup enllaçat, per poder-lo
     * eliminar o moure SOL sense arrossegar l'altre component.
     * Tècnica del SDK: setSelected(true) + seq.unlinkSelection().
     */
    unlink: function(trackIdx, clipIdx, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var track = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";
            clip.setSelected(true, true);
            seq.unlinkSelection();
            clip.setSelected(false, false);
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * removeLinkedAudio: Elimina el clip d'àudio ENLLAÇAT a un clip de vídeo del timeline.
     * Útil després d'un overwriteClip que insereix un MP4 amb àudio (el qual deixa un clip
     * d'àudio enllaçat a A1/A2). Tècnica del SDK: seleccionar el clip de vídeo →
     * unlinkSelection() → eliminar els clips d'àudio seleccionats que comencen al mateix temps.
     * @returns {string} "OK:<n>" (n clips d'àudio eliminats) o "ERR:..."
     */
    removeLinkedAudio: function(trackIdx, clipIdx) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var track = seq.videoTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";
            var tStart = clip.start.seconds;

            // 1. Deseleccionar TOT (vídeo + àudio) perquè la selecció sigui només el clip
            var _desel = function(trs) {
                if (!trs) return;
                for (var i = 0; i < trs.numTracks; i++) {
                    var tr = trs[i];
                    if (!tr || !tr.clips) continue;
                    for (var j = 0; j < tr.clips.numItems; j++) {
                        try { tr.clips[j].setSelected(false, false); } catch(eS) {}
                    }
                }
            };
            _desel(seq.videoTracks);
            _desel(seq.audioTracks);

            // 2. Seleccionar el clip de vídeo (arrossega el seu grup enllaçat)
            clip.setSelected(true, true);
            seq.unlinkSelection();

            // 3. Eliminar els clips d'àudio seleccionats que comencen al mateix temps que el vídeo
            var removed = 0;
            for (var at = 0; at < seq.audioTracks.numTracks; at++) {
                var atr = seq.audioTracks[at];
                if (!atr || !atr.clips) continue;
                for (var ai = atr.clips.numItems - 1; ai >= 0; ai--) {
                    var aClip = atr.clips[ai];
                    if (!aClip) continue;
                    var sel = false;
                    try { sel = aClip.isSelected(); } catch(eI) {}
                    if (sel && Math.abs(aClip.start.seconds - tStart) < 0.1) {
                        aClip.remove(false, false);
                        removed++;
                    }
                }
            }
            clip.setSelected(false, false);
            return "OK:" + removed;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * dedupeAudioAt: Neteja els clips d'àudio duplicats a la posició donada.
     * - A1 (pista 0): conserva el PRIMER clip que comença aquí (l'àudio original del
     *   programa) i elimina els duplicats que hagin creat els overwriteClip.
     * - A2, A3... (pistes 1+): elimina TOTS els clips que comencen aquí (són duplicats
     *   dels overwrite dels MP4, que cauen a les pistes target de l'operador).
     * @param {number} timeSec - Posició (start) on netejar
     * @returns {string} "OK:<n>" (n clips eliminats) o "ERR:..."
     */
    dedupeAudioAt: function(timeSec) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var target = parseFloat(timeSec);
            var removed = 0;
            for (var at = 0; at < seq.audioTracks.numTracks; at++) {
                var atr = seq.audioTracks[at];
                if (!atr || !atr.clips) continue;
                if (at === 0) {
                    // A1: conservar el primer (original del programa), eliminar la resta
                    var keep = null;
                    var dups = [];
                    for (var i = 0; i < atr.clips.numItems; i++) {
                        var aClip = atr.clips[i];
                        if (aClip && Math.abs(aClip.start.seconds - target) < 0.1) {
                            if (!keep) keep = aClip;
                            else dups.push(aClip);
                        }
                    }
                    for (var j = 0; j < dups.length; j++) {
                        try { dups[j].remove(false, false); removed++; } catch(eR) {}
                    }
                } else {
                    // A2/A3...: són duplicats dels overwrite → eliminar-los tots
                    for (var k = atr.clips.numItems - 1; k >= 0; k--) {
                        var c2 = atr.clips[k];
                        if (c2 && Math.abs(c2.start.seconds - target) < 0.1) {
                            try { c2.remove(false, false); removed++; } catch(eR) {}
                        }
                    }
                }
            }
            return "OK:" + removed;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * audioAround: Diagnòstic. Retorna els clips d'àudio de TOTES les pistes d'àudio
     * (A1, A2, A3...) que comencen o s'encavalquen amb [timeSec-0.5, timeSec+40].
     */
    audioAround: function(timeSec) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var t = parseFloat(timeSec);
            var out = { tracks: [] };
            for (var i = 0; i < seq.audioTracks.numTracks; i++) {
                var atr = seq.audioTracks[i];
                var arr = [];
                if (atr && atr.clips) {
                    for (var j = 0; j < atr.clips.numItems; j++) {
                        var c = atr.clips[j];
                        if (!c) continue;
                        if (c.end.seconds > t - 0.5 && c.start.seconds < t + 40) {
                            arr.push({ idx: j, name: c.name, start: Math.round(c.start.seconds * 100) / 100, end: Math.round(c.end.seconds * 100) / 100, inPt: Math.round(c.inPoint.seconds * 100) / 100, outPt: Math.round(c.outPoint.seconds * 100) / 100 });
                        }
                    }
                }
                out.tracks.push({ pista: "A" + (i + 1), clips: arr });
            }
            return JSON.stringify(out);
        } catch(e) { return "ERR: " + e.message; }
    },
    clearTrack: function(trackIdx, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track) return "ERR_TRACK_NOT_FOUND";
            
            var n = track.clips.numItems;
            for (var i = n - 1; i >= 0; i--) {
                track.clips[i].remove(true, true);
            }
            return "OK_CLEARED_" + n;
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * insert: Insereix un element del Bin (Overwrite) amb durada opcional.
     */
    insert: function(itemName, trackIdx, startSec, endSec, type) {
        try {
            var p = app.project;
            var seq = p.activeSequence;
            if (!seq) return "ERR_NO_ACTIVE_SEQUENCE";
    
            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.find(nameToFind);
            
            // Buscador de respaldo sin extensión
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) {
                    item = FASTPASS.Project.find(nameToFind.substring(0, lastDot));
                }
            }
            if (!item) return "ERR_ITEM_NOT_FOUND";
    
            // 1. Localizar la pista (Video o Audio)
            var targetTrack = null;
            var isVideo = (type !== "audio"); // Por defecto video
            
            if (isVideo) {
                targetTrack = seq.videoTracks[parseInt(trackIdx) - 1];
            } else {
                targetTrack = seq.audioTracks[parseInt(trackIdx) - 1];
            }
    
            if (!targetTrack) return "ERR_TRACK_NOT_FOUND";
    
            // 2. Configurar el tiempo de inserción
            var tStart = new Time();
            tStart.seconds = parseFloat(startSec || 0);
    
            // 3. LA LLAMADA REAL A PREMIERE (overwriteClip)
            // Esto es lo que faltaba. Usamos overwrite para no desplazar el resto
            targetTrack.overwriteClip(item, tStart);
    
            // 4. Ajustar duración si se especifica endSec
            if (endSec && parseFloat(endSec) > 0) {
                var clips = targetTrack.clips;
                var lastClip = clips[clips.numItems - 1];
                var tEnd = new Time();
                tEnd.seconds = parseFloat(endSec);
                lastClip.end = tEnd;
            }

            // 🎯 VERIFICACIÓ AUDIO I SINCRONIA (per a inserció estàndard)
            // Trobar el clip inserit
            var clips = targetTrack.clips;
            var insertedClip = null;
            for (var i = 0; i < clips.numItems; i++) {
                if (Math.abs(clips[i].start.seconds - tStart.seconds) < 0.1) {
                    insertedClip = clips[i];
                    break;
                }
            }
            if (insertedClip) {
                try {
                    var audioComp = null;
                    for (var c = 0; c < insertedClip.components.numItems; c++) {
                        if (insertedClip.components[c].matchName === "AE.ADBE Audio") {
                            audioComp = insertedClip.components[c];
                            break;
                        }
                    }
                    if (audioComp) {
                        $.writeln("✅ [JSX] Clip estàndard: component d'audio trobat");
                    } else {
                        $.writeln("ℹ️ [JSX] Clip estàndard sense audio.");
                    }
                } catch (e) {
                    $.writeln("⚠️ [JSX] No s'ha pogut verificar l'audio: " + e.message);
                }
            }
    
            // Eliminar el clip d'audio que Premiere afegeix AUTOMÀTICAMENT a A1
            // quan s'insereix un clip de vídeo que conté àudio (ex: wotts .mov).
            // IMPORTANT: Només s'elimina el clip d'audio que coincideix EXACTAMENT
            // amb el start del vídeo inserit. NO es toquen altres clips d'A1.
            if (audioComp) {
                var audioTrackA1 = seq.audioTracks[0];
                if (audioTrackA1) {
                    for (var i = audioTrackA1.clips.numItems - 1; i >= 0; i--) {
                        var aClip = audioTrackA1.clips[i];
                        if (Math.abs(aClip.start.seconds - insertedClip.start.seconds) < 0.1) {
                            try {
                                aClip.remove(true, true);
                                $.writeln("✅ [JSX] Àudio fantasma eliminat de A1 (wott sense so).");
                            } catch (e2) {
                                $.writeln("⚠️ [JSX] Error en eliminar àudio fantasma: " + e2.message);
                            }
                            break; // només n'hi ha un
                        }
                    }
                }
            }

            return "OK";
        } catch (e) {
            return "ERR: " + e.message;
        }
    },

    /**
     * trimBounds: Aplica inPoint/outPoint al clip inserit a una posició del timeline.
     * Funció atòmica (S3): separada d'insertWithBounds per permetre
     * control independent de la inserció i el trim des de JS.
     *
     * @param {number} startSec   - Posició al timeline on es va inserir el clip
     * @param {number} inPtSec    - InPoint dins del source (en segons)
     * @param {number} outPtSec   - OutPoint dins del source (en segons)
     * @param {number} trackIdx   - Índex de la pista (1-based, V1 per defecte)
     * @param {string} [type]     - "video" (per defecte) o "audio"
     */
    trimBounds: function(startSec, inPtSec, outPtSec, trackIdx, type) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_ACTIVE_SEQUENCE";

            var isVideo = (type !== "audio");
            var targetTrack = isVideo
                ? seq.videoTracks[parseInt(trackIdx || 1) - 1]
                : seq.audioTracks[parseInt(trackIdx || 1) - 1];
            if (!targetTrack) return "ERR_TRACK_NOT_FOUND";

            // Trobar el clip a la posició indicada
            var clips = targetTrack.clips;
            var targetClip = null;
            var tStartSec = parseFloat(startSec || 0);
            for (var i = 0; i < clips.numItems; i++) {
                if (Math.abs(clips[i].start.seconds - tStartSec) < 0.1) {
                    targetClip = clips[i];
                    break;
                }
            }
            if (!targetClip) targetClip = clips[clips.numItems - 1];
            if (!targetClip) return "ERR_CLIP_NOT_FOUND_AFTER_INSERT";

            // Aplicar inPoint i outPoint al clip
            var tIn = new Time();
            tIn.seconds = parseFloat(inPtSec);
            targetClip.inPoint = tIn;

            var tOut = new Time();
            tOut.seconds = parseFloat(outPtSec);
            targetClip.outPoint = tOut;

            // 🎯 FIX OUT TRIM: Forçar explícitament el timeline end
            var expectedDur = tOut.seconds - tIn.seconds;
            if (expectedDur > 0) {
                var tEnd = new Time();
                tEnd.seconds = targetClip.start.seconds + expectedDur;
                targetClip.end = tEnd;
                $.writeln("✅ [JSX·trimBounds] OUT trim forçat via clip.end: start=" + targetClip.start.seconds.toFixed(3) + "s + dur=" + expectedDur.toFixed(3) + "s → end=" + tEnd.seconds.toFixed(3) + "s");

                // Aplicar el mateix OUT trim al clip d'audio associat a A1
                try {
                    var audioTrackA1 = seq.audioTracks[0];
                    if (audioTrackA1 && audioTrackA1.clips && audioTrackA1.clips.numItems > 0) {
                        for (var aIdx = 0; aIdx < audioTrackA1.clips.numItems; aIdx++) {
                            var aClip = audioTrackA1.clips[aIdx];
                            if (Math.abs(aClip.start.seconds - targetClip.start.seconds) < 0.1) {
                                var aEnd = new Time();
                                aEnd.seconds = tEnd.seconds;
                                aClip.end = aEnd;
                                $.writeln("✅ [JSX·trimBounds] OUT trim forçat també a A1: start=" + aClip.start.seconds.toFixed(3) + "s → end=" + aEnd.seconds.toFixed(3) + "s");
                                break;
                            }
                        }
                    }
                } catch (eAudio) {
                    $.writeln("⚠️ [JSX·trimBounds] No s'ha pogut retallar l'audio a A1: " + eAudio.message);
                }
            } else {
                $.writeln("⚠️ [JSX·trimBounds] expectedDur=" + expectedDur + " (no es pot forçar end)");
            }

            return "OK";
        } catch (e) {
            return "ERR: " + e.message;
        }
    },

    /**
     * trimAudioA2: Elimina tots els clips de la pista A2.
     * Funció atòmica (S3): separada d'insertWithBounds.
     */
    trimAudioA2: function() {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_ACTIVE_SEQUENCE";

            var audioTrack2 = seq.audioTracks[1]; // A2
            if (audioTrack2 && audioTrack2.clips.numItems > 0) {
                var count = audioTrack2.clips.numItems;
                $.writeln("🔍 [JSX·trimAudioA2] Eliminant clips de A2 (" + count + " clips).");
                for (var i = count - 1; i >= 0; i--) {
                    var clip = audioTrack2.clips[i];
                    try {
                        clip.remove(true, true);
                        $.writeln("✅ [JSX·trimAudioA2] Clip eliminat de A2.");
                    } catch (e) {
                        $.writeln("❌ [JSX·trimAudioA2] Error eliminant clip de A2: " + e.message);
                    }
                }
                return "OK:" + count;
            } else {
                $.writeln("ℹ️ [JSX·trimAudioA2] No hi ha clips a A2.");
                return "OK:0";
            }
        } catch (e) {
            return "ERR: " + e.message;
        }
    },

    /**
     * insertWithBounds: ALIAS DE COMPATIBILITAT.
     * Delega a insert() + trimBounds() + trimAudioA2() en seqüència.
     * Mantingut per compatibilitat amb 3_Project_Logic.js.
     * Usat per al cleanFeed MP4 del workflow d'escaleta.
     * Aplica inPoint/outPoint al clip insertat al timeline (no al ProjectItem).
     *
     * @param {string} itemName   - Nom (URI-encoded) de l'asset al Bin
     * @param {number} trackIdx   - Índex de la pista (1-based)
     * @param {number} startSec   - Posició al timeline (normalment 0)
     * @param {number} inPtSec    - InPoint dins del MP4 (en segons)
     * @param {number} outPtSec   - OutPoint dins del MP4 (en segons)
     * @param {string} [type]     - "video" (per defecte) o "audio"
     */
    insertWithBounds: function(itemName, trackIdx, startSec, inPtSec, outPtSec, type) {
        try {
            var p = app.project;
            var seq = p.activeSequence;
            if (!seq) return "ERR_NO_ACTIVE_SEQUENCE";

            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.find(nameToFind);
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) item = FASTPASS.Project.find(nameToFind.substring(0, lastDot));
            }
            if (!item) return "ERR_ITEM_NOT_FOUND:" + nameToFind;

            var isVideo = (type !== "audio");
            var targetTrack = isVideo
                ? seq.videoTracks[parseInt(trackIdx) - 1]
                : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!targetTrack) return "ERR_TRACK_NOT_FOUND";

            // Col·locar el clip al timeline en la posició indicada
            var tStart = new Time();
            tStart.seconds = parseFloat(startSec || 0);
            targetTrack.overwriteClip(item, tStart);

            // Trobar el clip que acabem d'insertar (l'últim, o el que coincideix amb tStart)
            var clips = targetTrack.clips;
            var insertedClip = null;
            for (var i = 0; i < clips.numItems; i++) {
                if (Math.abs(clips[i].start.seconds - tStart.seconds) < 0.1) {
                    insertedClip = clips[i];
                    break;
                }
            }
            if (!insertedClip) insertedClip = clips[clips.numItems - 1];
            if (!insertedClip) return "ERR_CLIP_NOT_FOUND_AFTER_INSERT";

            // Aplicar inPoint i outPoint al clip insertat
            var tIn = new Time();
            tIn.seconds = parseFloat(inPtSec);
            insertedClip.inPoint = tIn;

            var tOut = new Time();
            tOut.seconds = parseFloat(outPtSec);
            insertedClip.outPoint = tOut;

            // 🎯 FIX OUT TRIM: Forçar explícitament el timeline end
            // Premiere de vegades ignora clip.outPoint després de clip.inPoint,
            // deixant el clip estirat fins al final del source.
            // Calcular durada esperada i forçar clip.end per garantir el tall.
            var expectedDur = tOut.seconds - tIn.seconds;
            if (expectedDur > 0) {
                var tEnd = new Time();
                tEnd.seconds = insertedClip.start.seconds + expectedDur;
                insertedClip.end = tEnd;
                $.writeln("✅ [JSX] OUT trim forçat via clip.end: start=" + insertedClip.start.seconds.toFixed(3) + "s + dur=" + expectedDur.toFixed(3) + "s → end=" + tEnd.seconds.toFixed(3) + "s");

                // 🎯 FIX AUDIO A1: Aplicar el mateix OUT trim al clip d'audio associat a A1
                // Quan s'insereix un MP4 amb àudio, Premiere crea automàticament un clip
                // d'audio enllaçat a A1. Cal retallar-lo al mateix temps final que el vídeo.
                try {
                    var audioTrackA1 = seq.audioTracks[0]; // A1
                    if (audioTrackA1 && audioTrackA1.clips && audioTrackA1.clips.numItems > 0) {
                        for (var aIdx = 0; aIdx < audioTrackA1.clips.numItems; aIdx++) {
                            var aClip = audioTrackA1.clips[aIdx];
                            // Cercar el clip d'audio que comença al mateix temps que el vídeo inserit
                            if (Math.abs(aClip.start.seconds - insertedClip.start.seconds) < 0.1) {
                                var aEnd = new Time();
                                aEnd.seconds = tEnd.seconds;
                                aClip.end = aEnd;
                                $.writeln("✅ [JSX] OUT trim forçat també a A1: start=" + aClip.start.seconds.toFixed(3) + "s → end=" + aEnd.seconds.toFixed(3) + "s");
                                break;
                            }
                        }
                    }
                } catch (eAudio) {
                    $.writeln("⚠️ [JSX] No s'ha pogut retallar l'audio a A1: " + eAudio.message);
                }
            } else {
                $.writeln("⚠️ [JSX] expectedDur=" + expectedDur + " (no es pot forçar end)");
            }

            // PASO 2: Eliminar clip de A2 (si existe)
            var audioTrack2 = seq.audioTracks[1]; // A2
            if (audioTrack2 && audioTrack2.clips.numItems > 0) {
                $.writeln("🔍 [JSX] Eliminant clips de A2 (" + audioTrack2.clips.numItems + " clips).");
                for (var i = audioTrack2.clips.numItems - 1; i >= 0; i--) {
                    var clip = audioTrack2.clips[i];
                    try {
                        clip.remove(true, true);
                        $.writeln("✅ [JSX] Clip eliminat de A2.");
                    } catch (e) {
                        $.writeln("❌ [JSX] Error eliminant clip de A2: " + e.message);
                    }
                }
            } else {
                $.writeln("ℹ️ [JSX] No hi ha clips a A2.");
            }

            // PASO 3: Aplicar Offset en V1 y A1
            // Detecció de component d'audio embegut
            var audioComp = null;
            var components = insertedClip.components;
            if (components && components.numItems > 0) {
                $.writeln("🔍 [JSX] Components del clip: " + components.numItems);
                for (var cIdx = 0; cIdx < components.numItems; cIdx++) {
                    var comp = components[cIdx];
                    $.writeln("🔍 [JSX] Component " + cIdx + ": matchName=" + comp.matchName + ", type=" + comp.type);
                    if (comp.matchName === "AE.ADBE Audio" || comp.matchName === "ADBE Audio" || (comp.type && comp.type.toString().toLowerCase().indexOf("audio") !== -1)) {
                        audioComp = comp;
                        $.writeln("✅ [JSX] Component d'audio identificat.");
                        break;
                    }
                }
            } else {
                $.writeln("ℹ️ [JSX] El clip no té components.");
            }

            if (audioComp) {
                $.writeln("✅ [JSX] Component d'audio trobat. Pista actual: " + (audioComp.track ? audioComp.track.name : "N/A"));
                // Verificar si el audio està a la pista A1 (índex 0)
                var audioTrack = audioComp.track;
                var desiredAudioTrack = seq.audioTracks[0]; // A1
                if (audioTrack && desiredAudioTrack && audioTrack !== desiredAudioTrack) {
                    $.writeln("⚠️ [JSX] Audio no està a A1. Intentant moure...");
                    // Moure el component d'audio a la pista A1 (suposant que insertant el clip a V1 ja hi ha audio)
                    // Aquesta implementació depèn de l'API de Premiere; per ara només log.
                }
                // Aplicar mateixos inPoint/outPoint a l'audio (si la propietat existeix)
                try {
                    audioComp.inPoint = tIn;
                    audioComp.outPoint = tOut;
                    $.writeln("✅ [JSX] Offset aplicat també al component d'audio.");
                } catch (e) {
                    $.writeln("ℹ️ [JSX] No s'ha pogut aplicar offset a l'audio (potser no té la propietat).");
                }
                // Log de diagnóstico de sincronía
                $.writeln("🔍 [JSX] Clip start: " + insertedClip.start.seconds + "s, inPoint: " + insertedClip.inPoint.seconds + "s, outPoint: " + insertedClip.outPoint.seconds + "s");
                $.writeln("🔍 [JSX] Audio start: " + audioComp.start.seconds + "s, inPoint: " + audioComp.inPoint.seconds + "s, outPoint: " + audioComp.outPoint.seconds + "s");
                var diffStart = audioComp.start.seconds - insertedClip.start.seconds;
                if (Math.abs(diffStart) > 0.01) {
                    $.writeln("⚠️ [JSX] Desfase en start detectado: " + diffStart + "s. Intentant corregir...");
                    try {
                        audioComp.start.seconds = insertedClip.start.seconds;
                        $.writeln("✅ [JSX] Start d'audio ajustat.");
                    } catch (e) {
                        $.writeln("❌ [JSX] No s'ha pogut ajustar start d'audio: " + e.message);
                    }
                }
                var diffIn = audioComp.inPoint.seconds - insertedClip.inPoint.seconds;
                if (Math.abs(diffIn) > 0.01) {
                    $.writeln("⚠️ [JSX] Desfase en inPoint detectado: " + diffIn + "s. Intentant corregir...");
                    try {
                        audioComp.inPoint = tIn;
                        $.writeln("✅ [JSX] inPoint d'audio ajustat.");
                    } catch (e) {
                        $.writeln("❌ [JSX] No s'ha pogut ajustar inPoint d'audio: " + e.message);
                    }
                }
                // Log per a verificació
                $.writeln("✅ [JSX] Offset aplicat: inPoint=" + inPtSec + "s, outPoint=" + outPtSec + "s");
            } else {
                $.writeln("ℹ️ [JSX] Clip sense component d'audio.");
                // Aplicar offset als clips d'audio a la pista A1 (si existeixen)
                var audioTrack1 = seq.audioTracks[0]; // A1
                if (audioTrack1 && audioTrack1.clips.numItems > 0) {
                    $.writeln("🔍 [JSX] S'ha trobat pista A1 amb " + audioTrack1.clips.numItems + " clips. Aplicant offset...");
                    for (var i = 0; i < audioTrack1.clips.numItems; i++) {
                        var aClip = audioTrack1.clips[i];
                        $.writeln("🔍 [JSX] Clip a A1: start=" + aClip.start.seconds + "s, inPoint=" + (aClip.inPoint ? aClip.inPoint.seconds : "N/A") + "s");
                        // Aplicar el mateix offset que al vídeo (inPoint/outPoint)
                        try {
                            aClip.start.seconds = insertedClip.start.seconds;
                            $.writeln("✅ [JSX] Start del clip d'audio a A1 ajustat.");
                        } catch (e) {
                            $.writeln("❌ [JSX] No s'ha pogut ajustar start: " + e.message);
                        }
                        try {
                            aClip.inPoint = tIn;
                            aClip.outPoint = tOut;
                            $.writeln("✅ [JSX] Offset aplicat al clip d'audio a A1.");
                        } catch (e) {
                            $.writeln("ℹ️ [JSX] No s'ha pogut aplicar offset al clip d'audio (potser no té la propietat).");
                        }
                    }
                }
            }

            // Neteja de clips d'audio duplicats a A1 (assegurar només un clip)
            var audioTrack1 = seq.audioTracks[0];
            if (audioTrack1 && audioTrack1.clips.numItems > 1) {
                $.writeln("⚠️ [JSX] Hi ha " + audioTrack1.clips.numItems + " clips a A1. Eliminant duplicats...");
                // Mantenir el primer clip (el que està més a l'esquerda) i eliminar la resta
                var clipsToKeep = 1;
                for (var i = audioTrack1.clips.numItems - 1; i >= clipsToKeep; i--) {
                    var clip = audioTrack1.clips[i];
                    try {
                        clip.remove(true, true);
                        $.writeln("✅ [JSX] Clip duplicat eliminat de A1.");
                    } catch (e) {
                        $.writeln("❌ [JSX] Error eliminant clip duplicat: " + e.message);
                    }
                }
            }

            // Eliminar TODO el contenido de V2 (si existe)
            var videoTrack2 = seq.videoTracks[1]; // V2
            if (videoTrack2) {
                $.writeln("🔍 [JSX] Inspeccionant V2: " + videoTrack2.clips.numItems + " clips.");
                for (var i = videoTrack2.clips.numItems - 1; i >= 0; i--) {
                    var clip = videoTrack2.clips[i];
                    $.writeln("🔍 [JSX] Clip a V2: start=" + clip.start.seconds + "s, components=" + clip.components.numItems);
                    try {
                        clip.remove(true, true);
                        $.writeln("✅ [JSX] Clip eliminat de V2.");
                    } catch (e) {
                        $.writeln("❌ [JSX] Error eliminant clip de V2: " + e.message);
                    }
                }
            } else {
                $.writeln("ℹ️ [JSX] No hi ha pista V2.");
            }

            return "OK";
        } catch (e) {
            return "ERR: " + e.message;
        }
    },

    /**
     * start: Canvia el temps d'inici (posició) d'un clip.
     */
    start: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); 
            t.seconds = parseFloat(seconds);
            clip.start = t;
            return "OK";
        } catch ( e ) { return "ERR:" + e.message; }
    },

    /**
     * end: Canvia el temps final d'un clip.
     */
    end: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); t.seconds = parseFloat(seconds);
            clip.end = t;
            return "OK";
        } catch ( e ) { return "ERR: " + e.message; }
    },

    /**
     * endAt: Canvia el temps final del clip que inicia a startSec (cerca per temps, no per índex).
     * Immunitzat contra renumeració de clips.
     */
    endAt: function(trackIdx, startSec, newEndSec, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track) return "ERR_TRACK_NOT_FOUND";
            var target = parseFloat(startSec);
            for (var i = 0; i < track.clips.numItems; i++) {
                if (Math.abs(track.clips[i].start.seconds - target) < 0.05) {
                    var t = new Time(); t.seconds = parseFloat(newEndSec);
                    track.clips[i].end = t;
                    return "OK";
                }
            }
            return "ERR_CLIP_NOT_FOUND_AT_" + startSec;
        } catch (e) { return "ERR: " + e.message; }
    },

    /**
     * removeAt: Elimina el clip que inicia a startSec (cerca per temps, no per índex).
     * Immunitzat contra renumeració de clips.
     */
    removeAt: function(trackIdx, startSec, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track) return "ERR_TRACK_NOT_FOUND";
            var target = parseFloat(startSec);
            for (var i = 0; i < track.clips.numItems; i++) {
                if (Math.abs(track.clips[i].start.seconds - target) < 0.05) {
                    track.clips[i].remove(true, true);
                    return "OK";
                }
            }
            return "ERR_CLIP_NOT_FOUND_AT_" + startSec;
        } catch (e) { return "ERR: " + e.message; }
    },

    /**
     * inPoint: Canvia el punt d'entrada (inPoint) d'un clip.
     */
    inPoint: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); 
            t.seconds = parseFloat(seconds);
            clip.inPoint = t;
            return "OK";
        } catch ( e ) { return "ERR:" + e.message; }
    },

    /**
     * getProp: Obté el valor d'una propietat d'un clip.
     */
    getProp: function(trackIdx, clipIdx, compMatch, propMatch, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            if (!clip || !clip.components) return null;

            var upper = function(s){ return (s || "").toUpperCase(); };
            var nComps = clip.components.numItems || clip.components.length || 0;

            // 1. Component: per matchName/displayName (fallback iteratiu)
            var comp = null;
            if (typeof clip.components.getComponentByMatchName === 'function') {
                comp = clip.components.getComponentByMatchName(compMatch);
            }
            if (!comp) {
                var wantMotion = upper(compMatch).indexOf("MOTION") !== -1;
                for (var i = 0; i < nComps; i++) {
                    var c = clip.components[i];
                    if (!c) continue;
                    var cmn = upper(c.matchName), cdn = upper(c.displayName);
                    if (c.matchName === compMatch || c.displayName === compMatch ||
                        cmn.indexOf(upper(compMatch)) !== -1 || cdn.indexOf(upper(compMatch)) !== -1 ||
                        (wantMotion && (cdn === "MOTION" || cdn === "MOVIMIENTO"))) {
                        comp = c; break;
                    }
                }
            }
            if (!comp || !comp.properties) return null;

            // 2. Propietat: per matchName/displayName (fallback iteratiu)
            var prop = null;
            if (typeof comp.properties.getPropertyByMatchName === 'function') {
                prop = comp.properties.getPropertyByMatchName(propMatch);
            }
            if (!prop) {
                var nProps = comp.properties.numItems || comp.properties.length || 0;
                for (var j = 0; j < nProps; j++) {
                    var p = comp.properties[j];
                    if (!p) continue;
                    var pmn = upper(p.matchName), pdn = upper(p.displayName);
                    if (p.matchName === propMatch || p.displayName === propMatch ||
                        pmn.indexOf(upper(propMatch)) !== -1 || pdn.indexOf(upper(propMatch)) !== -1) {
                        prop = p; break;
                    }
                }
            }
            // 3. Fallback per índex conegut (Motion: 0=Position, 1=Scale, 2=Anchor Point)
            if (!prop) {
                var up = upper(propMatch);
                var pi = -1;
                if (up.indexOf("POSITION") !== -1 || up.indexOf("POS") !== -1) pi = 0;
                else if (up.indexOf("SCALE") !== -1) pi = 1;
                else if (up.indexOf("ANCHOR") !== -1) pi = 2;
                if (pi !== -1 && comp.properties[pi]) prop = comp.properties[pi];
            }
            return prop;
        } catch(e) { return null; }
    },

    /**
     * setProp: Estableix el valor d'una propietat d'un clip.
     */
    setProp: function(trackIdx, clipIdx, compMatch, propMatch, val, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            if (!clip) return "ERR_CLIP";
            var comp = clip.components.getComponentByMatchName(compMatch);
            var prop = comp.properties.getPropertyByMatchName(propMatch);
            if (!prop) return "ERR_PROP";
            
            if (propMatch == "ADBE Video Position") {
                prop.setValue(val, true);
            } else {
                prop.setValue(parseFloat(val), true);
            }
            return "OK";
        } catch (e) { return "ERR: " + e.message + " (trackIdx=" + trackIdx + ")"; }
    },

    /**
     * scenes: Executa el Scene Edit Detection directament sobre la seqüència activa.
     */
    scenes: function(trackIdx) {
        try {
            $.writeln("DEBUG scenes: trackIdx=" + trackIdx);
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var i = parseInt(trackIdx) - 1;
            if (i < 0) i = 0;
            var track = seq.videoTracks[i];
            if (!track || !track.clips || track.clips.numItems == 0) return "ERR_EMPTY_TRACK";
            
            // Deseleccionar todo
            for (var c = 0; c < track.clips.numItems; c++) {
                track.clips[c].setSelected(false, false);
            }
            // Seleccionar solo el primer clip (MP4)
            track.clips[0].setSelected(true, true);
            
            var success = seq.performSceneEditDetectionOnSelection('applyCuts');
            return success ? "OK_SCENES" : "NO_SCENES_DETECTED";
        } catch (e) { return "ERR: " + e.message; }
    },

    /**
     * getSubtitles: Busca clips de subtítols seleccionats.
     */
    getSubtitles: function() {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "[]";
            var results = [];
            for (var t = 0; t < seq.subtitleTracks.numItems; t++) {
                var track = seq.subtitleTracks[t];
                for (var i = 0; i < track.clips.numItems; i++) {
                    var c = track.clips[i];
                    if (c.isSelected()) {
                        results.push({
                            trackIndex: t,
                            clipIndex: i,
                            name: c.name,
                            start: c.start.seconds,
                            end: c.end.seconds,
                            duration: c.duration.seconds
                        });
                    }
                }
            }
            return JSON.stringify(results);
        } catch(e) { return "[]"; }
    },
    /**
     * getSelectedVideo: Busca el primer clip de VÍDEO seleccionat al timeline
     * (recorre totes les pistes de vídeo d'abaix cap amunt).
     * @returns {string} JSON {track (1-based), index, name, start, end} o "null"
     */
    getSelectedVideo: function() {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "null";
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var track = seq.videoTracks[t];
                if (!track || !track.clips) continue;
                for (var i = 0; i < track.clips.numItems; i++) {
                    var c = track.clips[i];
                    try {
                        if (c && c.isSelected()) {
                            return JSON.stringify({
                                track: t + 1,
                                index: i,
                                name: c.name,
                                start: c.start.seconds,
                                end: c.end.seconds
                            });
                        }
                    } catch(eI) {}
                }
            }
            return "null";
        } catch(e) { return "ERR: " + e.message; }
    },


    /**
     * createCaptionFromProjectItem: Crea una nova caption track i hi col·loca un SRT.
     * És l'única API disponible per treballar amb subtítols des d'ExtendScript.
     * @param {string} itemName - Nom del .srt al projecte (URI-encoded)
     * @param {number} startSec - Segon d'inici al timeline (normalment 0)
     * @returns {string} "OK" o "ERR:... "
     */
    createCaptionFromProjectItem: function(itemName, startSec) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.find(nameToFind);
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) {
                    item = FASTPASS.Project.find(nameToFind.substring(0, lastDot));
                }
            }
            if (!item) return "ERR_ITEM_NOT_FOUND";
            if (typeof seq.createCaptionTrack !== "function") return "ERR_NO_CREATE_CAPTION_API";
            var tStart = parseFloat(startSec || 0);
            var result = seq.createCaptionTrack(item, tStart);
            if (result) return "OK";
            return "ERR_CREATE_CAPTION_FAILED";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * placeSrtOnExistingSubtitleTrack: Col·loca un .srt a una pista de subtítols
     * JA EXISTENT (conserva el seu estil). Si no n'hi ha cap, retorna error.
     * @param {string} itemName - Nom del .srt al projecte (URI-encoded)
     * @param {number} startSec - Segon d'inici al timeline (normalment 0)
     * @returns {string} "OK" o "ERR:..."
     */
    placeSrtOnExistingSubtitleTrack: function(itemName, startSec) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.find(nameToFind);
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) item = FASTPASS.Project.find(nameToFind.substring(0, lastDot));
            }
            if (!item) return "ERR_ITEM_NOT_FOUND";
            var tracks = seq.subtitleTracks;
            if (!tracks) return "ERR_NO_SUBTITLE_TRACKS";
            var n = tracks.numTracks || tracks.numItems || 0;
            if (n <= 0) return "ERR_NO_SUBTITLE_TRACKS";
            var track = tracks[0];
            var tStart = new Time();
            tStart.seconds = parseFloat(startSec || 0);
            track.overwriteClip(item, tStart);
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * move: Mou un clip d'una pista a una altra preservant start, inPoint i outPoint.
     * Funció ATÒMICA: no pren decisions, només executa el moviment.
     * @param {number} trackIdx - Pista d'origen (1-based)
     * @param {number} clipIdx - Índex del clip (0-based)
     * @param {number} targetTrackIdx - Pista de destí (1-based)
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK" o "ERR:..."
     */
    move: function(trackIdx, clipIdx, targetTrackIdx, type, stripAudio) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var srcTrack = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!srcTrack || !srcTrack.clips) return "ERR_NO_SRC_TRACK";
            var clip = srcTrack.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";
            if (!clip.projectItem) return "ERR_NO_PROJECT_ITEM";
            var tgtTrack = isVideo ? seq.videoTracks[parseInt(targetTrackIdx) - 1] : seq.audioTracks[parseInt(targetTrackIdx) - 1];
            if (!tgtTrack) return "ERR_NO_TARGET_TRACK";

            var tStart = clip.start.seconds;
            var tIn = clip.inPoint.seconds;
            // Duració basada en el TIMELINE (end - start), no en el source outPoint.
            var tDur = clip.end.seconds - clip.start.seconds;
            var tOut = tIn + tDur;

            // 🎯 CLAU anti-machacado SIMÈTRIC: desactivar les targets del tipus CONTRARI
            // durant l'overwriteClip. En un overwrite de VÍDEO, no s'insereix l'àudio a A1/A2;
            // en un overwrite d'ÀUDIO, no es reinsereix el vídeo del MP4 a la pista de vídeo target.
            var _savedT = [];
            try {
                var _otherTracks = isVideo ? seq.audioTracks : seq.videoTracks;
                if (_otherTracks) {
                    for (var _x = 0; _x < _otherTracks.numTracks; _x++) {
                        var _tx = _otherTracks[_x];
                        if (!_tx) continue;
                        var _w = true;
                        try { _w = _tx.getTargeted(); } catch(eG) {}
                        _savedT.push({ t: _tx, w: _w });
                        try { _tx.setTargeted(false); } catch(eS) {}
                    }
                }
            } catch(eX) {}

            tgtTrack.overwriteClip(clip.projectItem, tStart);

            try {
                for (var _y = 0; _y < _savedT.length; _y++) {
                    try { _savedT[_y].t.setTargeted(_savedT[_y].w); } catch(eR) {}
                }
            } catch(eY) {}

            var newIdx = -1;
            var newClip = null;
            // Buscar el clip recien inserit (per nom del projectItem + start). SENSE fallback:
            // si no es troba, error explícit per NO aplicar trims/motion a un clip equivocat.
            for (var i = 0; i < tgtTrack.clips.numItems; i++) {
                var c = tgtTrack.clips[i];
                if (Math.abs(c.start.seconds - tStart) < 0.1 && c.projectItem && clip.projectItem &&
                    c.projectItem.name === clip.projectItem.name) { newClip = c; newIdx = i; }
            }
            if (!newClip) return "ERR_CLIP_NOT_FOUND_AFTER_MOVE: " + (clip.projectItem.name || "?");
            if (newClip.projectItem && clip.projectItem && newClip.projectItem.name !== clip.projectItem.name) return "ERR_WRONG_CLIP_AFTER_MOVE: " + newClip.projectItem.name;

            // NOTA: els trims (inPoint/outPoint/end) NO s'apliquen aquí. Premiere ignora el
            // setter d'inPoint en el MATEIX evalScript que l'overwriteClip. El retrim es fa
            // DESPRÉS des de JS amb crides JSX separades (com el TROSEJA).

            // Eliminar àudio associat si stripAudio=1 (A1 i A2)
            if (parseInt(stripAudio) === 1) {
                try {
                    var audTracks = seq.audioTracks;
                    for (var at = 0; at < audTracks.numTracks; at++) {
                        var aTr = audTracks[at];
                        if (!aTr || !aTr.clips) continue;
                        for (var ai = aTr.clips.numItems - 1; ai >= 0; ai--) {
                            var aCl = aTr.clips[ai];
                            if (Math.abs(aCl.start.seconds - tStart) < 0.1) {
                                aCl.remove(true, true);
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }

            clip.remove(true, true);
            return "OK:" + newIdx;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * duplicate: Duplica un clip a una altra pista preservant start, inPoint i outPoint.
     * Funció ATÒMICA: deixa l'original intacte.
     * @param {number} trackIdx - Pista d'origen (1-based)
     * @param {number} clipIdx - Índex del clip (0-based)
     * @param {number} targetTrackIdx - Pista de destí (1-based)
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK" o "ERR:..."
     */
    duplicate: function(trackIdx, clipIdx, targetTrackIdx, type, stripAudio) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var srcTrack = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!srcTrack || !srcTrack.clips) return "ERR_NO_SRC_TRACK";
            var clip = srcTrack.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";
            if (!clip.projectItem) return "ERR_NO_PROJECT_ITEM";
            var tgtTrack = isVideo ? seq.videoTracks[parseInt(targetTrackIdx) - 1] : seq.audioTracks[parseInt(targetTrackIdx) - 1];
            if (!tgtTrack) return "ERR_NO_TARGET_TRACK";

            var tStart = clip.start.seconds;
            var tIn = clip.inPoint.seconds;
            // Duració basada en el TIMELINE (end - start), no en el source outPoint:
            // si el clip original està retallat de forma atípica, el outPoint del
            // source pot no coincidir amb la durada real del clip a la seqüència.
            var tDur = clip.end.seconds - clip.start.seconds;
            var tOut = tIn + tDur;

            // 🎯 CLAU anti-machacado SIMÈTRIC: desactivar les targets del tipus CONTRARI
            // durant l'overwriteClip. En un overwrite de VÍDEO, Premiere no insereix l'àudio
            // sencer del MP4 a A1/A2. En un overwrite d'ÀUDIO, no reinsereix el vídeo del MP4
            // a la pista de vídeo target (V1) — que era el que MACHACAVA el timeline.
            var _savedT = [];
            try {
                var _otherTracks = isVideo ? seq.audioTracks : seq.videoTracks;
                if (_otherTracks) {
                    for (var _x = 0; _x < _otherTracks.numTracks; _x++) {
                        var _tx = _otherTracks[_x];
                        if (!_tx) continue;
                        var _w = true;
                        try { _w = _tx.getTargeted(); } catch(eG) {}
                        _savedT.push({ t: _tx, w: _w });
                        try { _tx.setTargeted(false); } catch(eS) {}
                    }
                }
            } catch(eX) {}

            tgtTrack.overwriteClip(clip.projectItem, tStart);

            try {
                for (var _y = 0; _y < _savedT.length; _y++) {
                    try { _savedT[_y].t.setTargeted(_savedT[_y].w); } catch(eR) {}
                }
            } catch(eY) {}

            var newIdx = -1;
            var newClip = null;
            // Buscar el clip recien inserit (per nom del projectItem + start). SENSE fallback:
            // si no es troba, error explícit per NO aplicar trims/motion a un clip equivocat.
            for (var i = 0; i < tgtTrack.clips.numItems; i++) {
                var c = tgtTrack.clips[i];
                if (Math.abs(c.start.seconds - tStart) < 0.1 && c.projectItem && clip.projectItem &&
                    c.projectItem.name === clip.projectItem.name) { newClip = c; newIdx = i; }
            }
            if (!newClip) return "ERR_CLIP_NOT_FOUND_AFTER_DUP: " + (clip.projectItem.name || "?");
            if (newClip.projectItem && clip.projectItem && newClip.projectItem.name !== clip.projectItem.name) return "ERR_WRONG_CLIP_AFTER_DUP: " + newClip.projectItem.name;

            // NOTA: els trims (inPoint/outPoint/end) NO s'apliquen aquí. S'ha comprovat que
            // Premiere ignora el setter d'inPoint en el MATEIX evalScript que l'overwriteClip
            // (el clip queda mostrant el frame 0 del media). El retrim es fa DESPRÉS, des de JS,
            // amb crides JSX separades (Clips.inPoint / Clips.end), com fa el TROSEJA amb èxit.

            // Eliminar àudio associat si stripAudio=1 (A1 i A2)
            if (parseInt(stripAudio) === 1) {
                try {
                    var audTracks = seq.audioTracks;
                    for (var at = 0; at < audTracks.numTracks; at++) {
                        var aTr = audTracks[at];
                        if (!aTr || !aTr.clips) continue;
                        for (var ai = aTr.clips.numItems - 1; ai >= 0; ai--) {
                            var aCl = aTr.clips[ai];
                            if (Math.abs(aCl.start.seconds - tStart) < 0.1) {
                                aCl.remove(true, true);
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }

            return "OK:" + newIdx;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * trim: Retalla un clip del timeline al rang [startSec, endSec], ajustant
     * els in/out points del source per mantenir la sincronia.
     * Funció ATÒMICA.
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} clipIdx - Índex del clip (0-based)
     * @param {number} startSec - Nou inici al timeline
     * @param {number} endSec - Nou final al timeline
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK" o "ERR:..."
     */
    trim: function(trackIdx, clipIdx, startSec, endSec, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var track = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";

            var newStart = parseFloat(startSec);
            var newEnd = parseFloat(endSec);
            var oldStart = clip.start.seconds;
            var oldIn = clip.inPoint.seconds;
            var newDur = newEnd - newStart;
            var newIn = oldIn + (newStart - oldStart);
            var newOut = newIn + newDur;

            var tStart = new Time(); tStart.seconds = newStart;
            clip.start = tStart;
            var tIn = new Time(); tIn.seconds = newIn;
            clip.inPoint = tIn;
            var tOut = new Time(); tOut.seconds = newOut;
            clip.outPoint = tOut;
            var tEnd = new Time(); tEnd.seconds = newEnd;
            clip.end = tEnd;

            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * debugTracks: Diagnòstic de l'estat de les pistes (nombre, bloquejada, clips amb
     * start/end). Molt útil per detectar pistes BLOQUEJADES que fan fallar els
     * overwriteClip/remove de forma silenciosa.
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} JSON {count, tracks:[{index, locked, clips:[{index,name,start,end}]}]}
     */
    debugTracks: function(type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var tracks = (type === "audio") ? seq.audioTracks : seq.videoTracks;
            if (!tracks) return "ERR_NO_TRACKS";
            var out = { count: tracks.numTracks || 0, tracks: [] };
            for (var i = 0; i < out.count; i++) {
                var tr = tracks[i];
                var t = { index: i, locked: !!(tr && tr.isLocked), clips: [] };
                if (tr && tr.clips) {
                    for (var j = 0; j < tr.clips.numItems; j++) {
                        var c = tr.clips[j];
                        if (!c) continue;
                        t.clips.push({ index: j, name: c.name, start: Math.round(c.start.seconds * 100) / 100, end: Math.round(c.end.seconds * 100) / 100 });
                    }
                }
                out.tracks.push(t);
            }
            return JSON.stringify(out);
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * retrim: Retalla un clip recentment inserit al rang exacte.
     * Es crida en un evalScript SEPARAT del overwriteClip (Premiere ignora el setter
     * d'inPoint en el mateix evalScript que la inserció).
     * Ordre crític (com insertWithBounds): inPoint → outPoint → end.
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} clipIdx - Índex del clip (0-based)
     * @param {number} inPtSec - InPoint dins del source
     * @param {number} outPtSec - OutPoint dins del source
     * @param {number} endSec - End al timeline (start + (outPt-inPt))
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK:in=X,out=Y,end=Z" o "WARN_INVALID:..." o "ERR:..."
     */
    retrim: function(trackIdx, clipIdx, inPtSec, outPtSec, endSec, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var track = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";

            var inPt = parseFloat(inPtSec);
            var outPt = parseFloat(outPtSec);
            var endS = parseFloat(endSec);
            var tIn = new Time(); tIn.seconds = inPt;
            var tOut = new Time(); tOut.seconds = outPt;
            var tEnd = new Time(); tEnd.seconds = endS;

            var ok = false;
            for (var attempt = 0; attempt < 3 && !ok; attempt++) {
                clip.inPoint = tIn;
                clip.outPoint = tOut;
                clip.end = tEnd;
                var curIn = Math.round(clip.inPoint.seconds * 100) / 100;
                var curOut = Math.round(clip.outPoint.seconds * 100) / 100;
                var curEnd = Math.round(clip.end.seconds * 100) / 100;
                if (Math.abs(curIn - inPt) < 0.05 && Math.abs(curOut - outPt) < 0.05 && Math.abs(curEnd - endS) < 0.05) ok = true;
            }
            if (ok) {
                return "OK:in=" + clip.inPoint.seconds.toFixed(3) + ",out=" + clip.outPoint.seconds.toFixed(3) + ",end=" + clip.end.seconds.toFixed(3);
            }
            return "WARN_INVALID:in=" + clip.inPoint.seconds.toFixed(3) + ",out=" + clip.outPoint.seconds.toFixed(3) + ",end=" + clip.end.seconds.toFixed(3) + ",wantIn=" + inPt + ",wantOut=" + outPt;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * moveToRange: Mou un clip dins de la MATEIXA pista al rang EXACTE [startSec, endSec]
     * reasignant clip.start i clip.end en el MATEIX evalScript, PRESERVANT la durada
     * del clip (no toca inPoint/outPoint: per a imatges fixes/stills el contingut és un
     * frame únic, així que és irrellevant). Reintenta i verifica el resultat.
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} clipIdx - Índex del clip (0-based)
     * @param {number} startSec - Nou inici al timeline
     * @param {number} endSec - Nou final al timeline
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK:start=X,end=Y" o "WARN_MOVE:..." o "ERR:..."
     */
    moveToRange: function(trackIdx, clipIdx, startSec, endSec, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var track = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";

            var wantStart = parseFloat(startSec);
            var wantEnd = parseFloat(endSec);
            if (!isFinite(wantStart) || !isFinite(wantEnd)) return "ERR_INVALID_RANGE:" + startSec + "→" + endSec;
            var tStart = new Time(); tStart.seconds = wantStart;
            var tEnd = new Time(); tEnd.seconds = wantEnd;

            var ok = false;
            for (var attempt = 0; attempt < 3 && !ok; attempt++) {
                clip.start = tStart;
                clip.end = tEnd;
                var curStart = clip.start.seconds;
                var curEnd = clip.end.seconds;
                if (Math.abs(curStart - wantStart) < 0.05 && Math.abs(curEnd - wantEnd) < 0.05) ok = true;
            }
            if (ok) {
                return "OK:start=" + clip.start.seconds.toFixed(3) + ",end=" + clip.end.seconds.toFixed(3);
            }
            return "WARN_MOVE:start=" + clip.start.seconds.toFixed(3) + ",end=" + clip.end.seconds.toFixed(3) + ",wantStart=" + wantStart.toFixed(3) + ",wantEnd=" + wantEnd.toFixed(3);
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * itemDuration: Retorna la durada (en segons) del PROJECT ITEM (media al bin) d'un
     * clip del timeline. Serveix per saber quant ocupa un overwriteClip d'aquest media
     * (el duplicat d'un clip d'un MP4 llarg re-insereix TOT el MP4).
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} clipIdx - Índex del clip (0-based)
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} segons (ex: "1246.32") o "ERR:..."
     */
    itemDuration: function(trackIdx, clipIdx, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var track = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip || !clip.projectItem) return "ERR_NO_PROJECT_ITEM";
            if (typeof clip.projectItem.getDuration !== 'function') return "ERR_NO_DURATION_API";
            return clip.projectItem.getDuration().seconds.toString();
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * insertClipItem: Insereix un ProjectItem (per nom al bin) en una pista amb
     * INSERT amb ripple (Track.insertClip): NO pisa res, desplaça els clips posteriors
     * de la pista cap a la dreta la durada del media insertat.
     * @param {string} itemName - Nom (URI-encoded) de l'asset al bin
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} timeSec - Posició d'inserció al timeline (segons)
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK" o "ERR:..."
     */
    /**
     * _limitarTargets: Desactiva els targets de TOTES les pistes (vídeo i àudio) EXCEPTE
     * la pista destí (que es força activa), perquè el insertClip (ripple) afecti NOMÉS la
     * pista destí. Sense això, el ripple també desplaça/insereix a altres pistes amb target
     * actiu (i l'àudio enllaçat), cosa que desvirtua els clips veïns (bug DF 2026-09-04).
     * Retorna una funció per restaurar l'estat original dels targets.
     */
    _limitarTargets: function(seq, keepTrack) {
        var saved = [];
        try {
            var all = [];
            if (seq.videoTracks) { for (var v = 0; v < seq.videoTracks.numTracks; v++) all.push(seq.videoTracks[v]); }
            if (seq.audioTracks) { for (var a = 0; a < seq.audioTracks.numTracks; a++) all.push(seq.audioTracks[a]); }
            for (var i = 0; i < all.length; i++) {
                var tr = all[i];
                if (!tr) continue;
                var w = true;
                try { w = tr.getTargeted(); } catch(eG) {}
                saved.push({ t: tr, w: w });
                try { tr.setTargeted(tr === keepTrack); } catch(eS) {}
            }
        } catch(eX) {}
        return function() {
            for (var j = 0; j < saved.length; j++) {
                try { saved[j].t.setTargeted(saved[j].w); } catch(eR) {}
            }
        };
    },


    insertClipItem: function(itemName, trackIdx, timeSec, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var track = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!track) return "ERR_NO_TRACK";
            if (typeof track.insertClip !== 'function') return "ERR_NO_INSERTCLIP_API";

            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.find(nameToFind);
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) item = FASTPASS.Project.find(nameToFind.substring(0, lastDot));
            }
            if (!item) return "ERR_ITEM_NOT_FOUND:" + nameToFind;

            // 🎯 CLAU anti-machacado: deixar SOLS la pista destí amb target actiu durant
            // l'insertClip (així el ripple no desplaça ni toca altres pistes ni l'àudio).
            var _restoreTargets = this._limitarTargets(seq, track);
            track.insertClip(item, parseFloat(timeSec));
            _restoreTargets();
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * insertClipFrom: Insereix amb ripple (Track.insertClip) el PROJECT ITEM del clip
     * font d'una pista en una altra pista a la posició indicada. NO pisa res: desplaça
     * els clips posteriors de la pista de destí (és la manera segura de "pujar" un clip
     * d'un MP4 llarg a una pista que ja té contingut, a diferència del duplicate/overwrite).
     * @param {number} trackIdx - Pista d'origen (1-based)
     * @param {number} clipIdx - Índex del clip font (0-based)
     * @param {number} targetTrackIdx - Pista de destí (1-based)
     * @param {number} timeSec - Posició d'inserció al timeline (segons)
     * @param {string} [type] - "video" (default) o "audio"
     * @returns {string} "OK" o "ERR:..."
     */
    insertClipFrom: function(trackIdx, clipIdx, targetTrackIdx, timeSec, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var isVideo = (type !== "audio");
            var srcTrack = isVideo ? seq.videoTracks[parseInt(trackIdx) - 1] : seq.audioTracks[parseInt(trackIdx) - 1];
            if (!srcTrack || !srcTrack.clips) return "ERR_NO_SRC_TRACK";
            var clip = srcTrack.clips[parseInt(clipIdx)];
            if (!clip || !clip.projectItem) return "ERR_NO_CLIP";
            var tgtTrack = isVideo ? seq.videoTracks[parseInt(targetTrackIdx) - 1] : seq.audioTracks[parseInt(targetTrackIdx) - 1];
            if (!tgtTrack) return "ERR_NO_TARGET_TRACK";
            if (typeof tgtTrack.insertClip !== 'function') return "ERR_NO_INSERTCLIP_API";

            // 🎯 CLAU anti-machacado: deixar SOLS la pista destí amb target actiu durant
            // l'insertClip (el ripple no desplaça ni toca altres pistes ni l'àudio).
            var _restoreTargets2 = this._limitarTargets(seq, tgtTrack);
            tgtTrack.insertClip(clip.projectItem, parseFloat(timeSec));
            _restoreTargets2();
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    }
}