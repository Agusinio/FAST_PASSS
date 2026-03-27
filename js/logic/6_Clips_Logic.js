/**
 * ============================================================================
 * LOGIC: CLIPS (Orquestación de acciones atómicas y Búsqueda) - Clips_Logic.js
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Clips = {
        
        /**
         * Troba el clip en una pista a un temps determinat.
         * Orquestra la cerca via bridges atòmics (count + indexData).
         */
        findAtTime: async function(trackIdx, timeSec, type) {
            const count = parseInt(await utils.callJSX(`jsx_getClipCount(${trackIdx}, '${type}')`));
            if (count === 0) return null;

            for (let i = 0; i < count; i++) {
                const dataRaw = await utils.callJSX(`jsx_getClipDataByIndex(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;
                
                const clip = JSON.parse(dataRaw);
                if (parseFloat(timeSec) >= clip.start && parseFloat(timeSec) <= clip.end) {
                    clip.index = i;
                    return clip;
                }
            }
            return null;
        },

        /**
         * Realiza un Ripple Trim del inicio de un clip.
         */
        rippleTrimStart: async function(trackIdx, clipIdx, cutSec, clipData) {
            const diff = parseFloat(cutSec) - clipData.start;
            if (diff <= 0.01) return "NO_DIFF";

            const newInPoint = clipData.inPoint + diff;
            
            // 1. Ajustar V1
            await utils.callJSX(`jsx_setClipInPoint(${trackIdx}, ${clipIdx}, ${newInPoint}, 'video')`);
            await utils.callJSX(`jsx_setClipStart(${trackIdx}, ${clipIdx}, 0, 'video')`);

            // 2. Intentar ajustar A1 (Audio)
            // Normalment la música/audio va lligat al mateix temps
            const audioClip = await this.findAtTime(trackIdx, cutSec, "audio");
            if (audioClip) {
                const audioDiff = parseFloat(cutSec) - audioClip.start;
                const newAudioIn = audioClip.inPoint + audioDiff;
                await utils.callJSX(`jsx_setClipInPoint(${trackIdx}, ${audioClip.index}, ${newAudioIn}, 'audio')`);
                await utils.callJSX(`jsx_setClipStart(${trackIdx}, ${audioClip.index}, 0, 'audio')`);
            }

            return "OK_RIPPLE_TRIM_START";
        },

        /**
         * Neteja clips posteriors a un temps en múltiples pistes.
         */
        clearMultipleTracksAfter: async function(timeSec, videoTracks = [1], audioTracks = [], extendToTarget = false) {
            let total = 0;
            for (let vt of videoTracks) {
                const res = await this.clearTrackAfter(vt, timeSec, "video", extendToTarget);
                total += parseInt(res.replace("OK_CLEAN_", "") || 0);
            }
            for (let at of audioTracks) {
                const res = await this.clearTrackAfter(at, timeSec, "audio", extendToTarget);
                total += parseInt(res.replace("OK_CLEAN_", "") || 0);
            }
            return total;
        },

        clearTrackAfter: async function(trackIdx, timeSec, type, extendToTarget = false) {
            const count = parseInt(await utils.callJSX(`jsx_getClipCount(${trackIdx}, '${type}')`));
            if (count === 0) return "EMPTY_TRACK";

            let removedCount = 0;
            const target = parseFloat(timeSec);
            let lastClipValid = null;

            for (let i = count - 1; i >= 0; i--) {
                const dataRaw = await utils.callJSX(`jsx_getClipDataByIndex(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;
                
                const clip = JSON.parse(dataRaw);
                
                // 1. Clips que comencen després del tall -> Esborrar
                if (clip.start >= target - 0.01) {
                    await utils.callJSX(`jsx_removeClip(${trackIdx}, ${i}, '${type}')`);
                    removedCount++;
                } 
                // 2. Clips que creuen el tall -> Retallar el final
                else if (clip.start < target && clip.end > target + 0.01) {
                    await utils.callJSX(`jsx_setClipEnd(${trackIdx}, ${i}, ${target}, '${type}')`);
                }
                // 3. Guardem la referència a l'últim clip que queda per estendre'l si cal
                else if (extendToTarget && clip.end < target - 0.01) {
                    if (!lastClipValid || clip.end > lastClipValid.end) {
                        lastClipValid = { index: i, end: clip.end };
                    }
                }
            }

            // Si cal estendre l'últim clip trobat abans del tall
            if (extendToTarget && lastClipValid) {
                await utils.callJSX(`jsx_setClipEnd(${trackIdx}, ${lastClipValid.index}, ${target}, '${type}')`);
            }

            return "OK_CLEAN_" + removedCount;
        },
        /**
         * Obté tots els clips d'una pista en un format manejable.
         */
        getTrackClips: async function(trackIdx, type = "video") {
            const count = parseInt(await utils.callJSX(`jsx_getClipCount(${trackIdx}, '${type}')`));
            const clips = [];
            for (let i = 0; i < count; i++) {
                const dataRaw = await utils.callJSX(`jsx_getClipDataByIndex(${trackIdx}, ${i}, '${type}')`);
                if (dataRaw && dataRaw !== "null") {
                    const c = JSON.parse(dataRaw);
                    c.index = i;
                    clips.push(c);
                }
            }
            return clips;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
