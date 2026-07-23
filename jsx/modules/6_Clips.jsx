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
                clip.remove(true, true);
                return "OK";
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * clearTrack: Elimina tots els clips d'una pista (escombrat invers).
     */
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
            if (!clip) return null;
            
            var comp = clip.components.getComponentByMatchName(compMatch);
            if (!comp) return null;
            var prop = comp.properties.getPropertyByMatchName(propMatch);
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
     * scenes: Executa el Scene Edit Detection.
     */
    scenes: function(trackIdx) {
        try {
            $.writeln("DEBUG scenes: trackIdx=" + trackIdx);
            var track = this._get(trackIdx, "video");
            if (!track || track.clips.numItems == 0) return "ERR_EMPTY_TRACK";
            
            // Deseleccionar todo
            for (var i = 0; i < track.clips.numItems; i++) {
                track.clips[i].setSelected(false, false);
            }
            // Seleccionar solo el primer clip (MP4)
            track.clips[0].setSelected(true, true);
            
            var success = app.project.activeSequence.performSceneEditDetectionOnSelection('applyCuts');
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
}
