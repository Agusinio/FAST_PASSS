/**
 * ============================================================================
 * LOGIC: CLIPS (Orquestació de talls i Ripple Editing) - v2.5.2 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Clips = {

        /**
         * at: Troba el clip en una pista a un temps determinat (Bridge a JSX).
         */
        at: async function (trackIdx, timeSec, type) {
            const dataRaw = await utils.callJSX(`Clips.at(${trackIdx}, ${timeSec}, '${type || "video"}')`);
            if (!dataRaw || dataRaw === "null") return null;
            return JSON.parse(dataRaw);
        },

        /**
         * rippleIn: Ajusta l'entrada d'un clip (inPoint) i el mou a zero.
         */
        rippleIn: async function (trackIdx, clipIdx, cutTime, clipData) {
            const diff = parseFloat(cutTime) - clipData.start;
            if (diff <= 0.01) return "NO_DIFF";

            const newIn = clipData.inPoint + diff;

            // 1. Ajustar Clip Principal (Video)
            await utils.callJSX(`Clips.inPoint(${trackIdx}, ${clipIdx}, ${newIn}, 'video')`);
            await utils.callJSX(`Clips.start(${trackIdx}, ${clipIdx}, 0, 'video')`);

            // 2. Ajustar Audio sincronitzat (A1)
            const audioClip = await this.at(trackIdx, cutTime, "audio");
            if (audioClip) {
                const audioDiff = parseFloat(cutTime) - audioClip.start;
                const newAudioIn = audioClip.inPoint + audioDiff;
                await utils.callJSX(`Clips.inPoint(${trackIdx}, ${audioClip.index}, ${newAudioIn}, 'audio')`);
                await utils.callJSX(`Clips.start(${trackIdx}, ${audioClip.index}, 0, 'audio')`);
            }

            return "OK_RIPPLE_IN";
        },

        /**
         * rippleOut: Neteja un track eliminant clips a partir d'un temps (Outer trim).
         */
        rippleOut: async function (trackIdx, timeSec, type, extendToTarget = false) {
            const countStr = await utils.callJSX(`Clips.count(${trackIdx}, '${type || "video"}')`);
            const count = parseInt(countStr || 0);
            if (count === 0) return "EMPTY";

            let removed = 0;
            const target = parseFloat(timeSec);
            let lastClipValid = null;

            for (let i = count - 1; i >= 0; i--) {
                const dataRaw = await utils.callJSX(`Clips.get(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;

                const clip = JSON.parse(dataRaw);

                // 1. Clips que s'han de treure (Post-target)
                if (clip.start >= target - 0.01) {
                    await utils.callJSX(`Clips.remove(${trackIdx}, ${i}, '${type}')`);
                    removed++;
                }
                // 2. Clips que s'han de retallar (Straddling target)
                else if (clip.start < target && clip.end > target + 0.01) {
                    await utils.callJSX(`Clips.end(${trackIdx}, ${i}, ${target}, '${type}')`);
                }
                // 3. Captura per extreure si cal
                else if (extendToTarget && clip.end < target - 0.01) {
                    if (!lastClipValid || clip.end > lastClipValid.end) {
                        lastClipValid = { index: i, end: clip.end };
                    }
                }
            }

            if (extendToTarget && lastClipValid) {
                await utils.callJSX(`Clips.end(${trackIdx}, ${lastClipValid.index}, ${target}, '${type}')`);
            }

            return "OK_RIPPLE_OUT_" + removed;
        },

        /**
         * rippleAllOut: Purga massiva de pistes després d'un tall.
         */
        rippleAllOut: async function (timeSec, videoTracks = [1], audioTracks = [], extend = false) {
            let total = 0;
            for (let v of videoTracks) {
                const res = await this.rippleOut(v, timeSec, "video", extend);
                total += parseInt(res.replace("OK_RIPPLE_OUT_", "") || 0);
            }
            for (let a of audioTracks) {
                const res = await this.rippleOut(a, timeSec, "audio", extend);
                total += parseInt(res.replace("OK_RIPPLE_OUT_", "") || 0);
            }
            return total;
        }
    };

    // Alias literal global window.Clips
    window.Clips = FASTPASS_UI.Logic.Clips;

    window.FASTPASS_UI = FASTPASS_UI;
})();
