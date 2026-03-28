/**
 * ============================================================================
 * LOGIC: Clips (Orquestació d'accions atòmiques i Cerca) - v2.5.0
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    // Alias per a crides literals
    FASTPASS_UI.Logic.Clips = {
        
        /**
         * at: Troba el clip en una pista a un temps determinat.
         */
        at: async function(trackIdx, timeSec, type) {
            const count = parseInt(await utils.callJSX(`Clips.count(${trackIdx}, '${type}')`));
            if (count === 0) return null;

            for (let i = 0; i < count; i++) {
                const dataRaw = await utils.callJSX(`Clips.get(${trackIdx}, ${i}, '${type}')`);
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
         * trimStart: Realitza un Ripple Trim de l'inici d'un clip.
         */
        trimStart: async function(trackIdx, clipIdx, cutSec, clipData) {
            const diff = parseFloat(cutSec) - clipData.start;
            if (diff <= 0.01) return "NO_DIFF";

            const newInPoint = clipData.inPoint + diff;
            
            // 1. Ajustar V1 literalment
            await utils.callJSX(`Clips.inPoint(${trackIdx}, ${clipIdx}, ${newInPoint}, 'video')`);
            await utils.callJSX(`Clips.start(${trackIdx}, ${clipIdx}, 0, 'video')`);

            // 2. Intentar ajustar A1 (Audio) literalment
            const audioClip = await this.at(trackIdx, cutSec, "audio");
            if (audioClip) {
                const audioDiff = parseFloat(cutSec) - audioClip.start;
                const newAudioIn = audioClip.inPoint + audioDiff;
                await utils.callJSX(`Clips.inPoint(${trackIdx}, ${audioClip.index}, ${newAudioIn}, 'audio')`);
                await utils.callJSX(`Clips.start(${trackIdx}, ${audioClip.index}, 0, 'audio')`);
            }

            return "OK_TRIM_START";
        },

        /**
         * clearAfterMultiple: Neteja clips posteriors a un temps en múltiples pistes.
         */
        clearAfterMultiple: async function(timeSec, videoTracks = [1], audioTracks = [], extendToTarget = false) {
            let total = 0;
            for (let vt of videoTracks) {
                const res = await this.clearAfter(vt, timeSec, "video", extendToTarget);
                total += parseInt(res.replace("OK_CLEAN_", "") || 0);
            }
            for (let at of audioTracks) {
                const res = await this.clearAfter(at, timeSec, "audio", extendToTarget);
                total += parseInt(res.replace("OK_CLEAN_", "") || 0);
            }
            return total;
        },

        /**
         * clearAfter: Neteja clips posteriors en una pista.
         */
        clearAfter: async function(trackIdx, timeSec, type, extendToTarget = false) {
            const count = parseInt(await utils.callJSX(`Clips.count(${trackIdx}, '${type}')`));
            if (count === 0) return "EMPTY_TRACK";

            let removedCount = 0;
            const target = parseFloat(timeSec);
            let lastClipValid = null;

            for (let i = count - 1; i >= 0; i--) {
                const dataRaw = await utils.callJSX(`Clips.get(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;
                
                const clip = JSON.parse(dataRaw);
                
                if (clip.start >= target - 0.01) {
                    await utils.callJSX(`Clips.remove(${trackIdx}, ${i}, '${type}')`);
                    removedCount++;
                } 
                else if (clip.start < target && clip.end > target + 0.01) {
                    await utils.callJSX(`Clips.end(${trackIdx}, i, ${target}, '${type}')`);
                }
                else if (extendToTarget && clip.end < target - 0.01) {
                    if (!lastClipValid || clip.end > lastClipValid.end) {
                        lastClipValid = { index: i, end: clip.end };
                    }
                }
            }

            if (extendToTarget && lastClipValid) {
                await utils.callJSX(`Clips.end(${trackIdx}, ${lastClipValid.index}, ${target}, '${type}')`);
            }

            return "OK_CLEAN_" + removedCount;
        },

        /**
         * list: Obté tots els clips d'una pista.
         */
        list: async function(trackIdx, type = "video") {
            const count = parseInt(await utils.callJSX(`Clips.count(${trackIdx}, '${type}')`));
            const clips = [];
            for (let i = 0; i < count; i++) {
                const dataRaw = await utils.callJSX(`Clips.get(${trackIdx}, ${i}, '${type}')`);
                if (dataRaw && dataRaw !== "null") {
                    const c = JSON.parse(dataRaw);
                    c.index = i;
                    clips.push(c);
                }
            }
            return clips;
        }
    };

    // Alias global per a sintaxi literal Clips.list()
    window.Clips = FASTPASS_UI.Logic.Clips;

    window.FASTPASS_UI = FASTPASS_UI;
})();
