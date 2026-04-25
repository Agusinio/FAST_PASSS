/** Logic_Clips.js
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
            console.log('[ClipsLogic.at]', trackIdx, timeSec, type);
            const dataRaw = await utils.callJSX(`Clips.at(${trackIdx}, ${timeSec}, '${type || "video"}')`);
            console.log('[ClipsLogic.at] raw:', dataRaw);
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
            //utils.log(`[rippleIn] diff=${diff}, newIn=${newIn}, clipData.start=${clipData.start}, clipData.inPoint=${clipData.inPoint}`);

            // 1. Ajustar Clip Principal (Video)
            //utils.log(`[rippleIn] Llamando Clips.inPoint(${trackIdx}, ${clipIdx}, ${newIn}, 'video')`);
            const resInPoint = await utils.callJSX(`Clips.inPoint(${trackIdx}, ${clipIdx}, ${newIn}, 'video')`);
            //utils.log(`[rippleIn] Resultado inPoint: ${resInPoint}`);
            //utils.log(`[rippleIn] Llamando Clips.start(${trackIdx}, ${clipIdx}, 0, 'video')`);
            const resStart = await utils.callJSX(`Clips.start(${trackIdx}, ${clipIdx}, 0, 'video')`);
            //utils.log(`[rippleIn] Resultado start: ${resStart}`);
            // Ajustar el end del clip para reflejar el nuevo inPoint (ripple trim)
            const newEnd = clipData.end - diff;
            //utils.log(`[rippleIn] Llamando Clips.end(${trackIdx}, ${clipIdx}, ${newEnd}, 'video')`);
            const resEnd = await utils.callJSX(`Clips.end(${trackIdx}, ${clipIdx}, ${newEnd}, 'video')`);
            //utils.log(`[rippleIn] Resultado end: ${resEnd}`);

            // 2. Ajustar Audio sincronitzat (A1)
            const audioClip = await this.at(trackIdx, cutTime, "audio");
            if (audioClip) {
                const audioDiff = parseFloat(cutTime) - audioClip.start;
                const newAudioIn = audioClip.inPoint + audioDiff;
                //utils.log(`[rippleIn] Ajustando audio clip ${audioClip.index}, newAudioIn=${newAudioIn}`);
                await utils.callJSX(`Clips.inPoint(${trackIdx}, ${audioClip.index}, ${newAudioIn}, 'audio')`);
                await utils.callJSX(`Clips.start(${trackIdx}, ${audioClip.index}, 0, 'audio')`);
                // Ajustar end del audio
                const audioEnd = audioClip.end - audioDiff;
                await utils.callJSX(`Clips.end(${trackIdx}, ${audioClip.index}, ${audioEnd}, 'audio')`);
            }

            utils.log(`[rippleIn] Trim completado`);
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
                if (res.startsWith("OK_RIPPLE_OUT_")) {
                    total += parseInt(res.replace("OK_RIPPLE_OUT_", "") || 0);
                }
                // Si es "EMPTY" o otro, se ignora
            }
            for (let a of audioTracks) {
                const res = await this.rippleOut(a, timeSec, "audio", extend);
                if (res.startsWith("OK_RIPPLE_OUT_")) {
                    total += parseInt(res.replace("OK_RIPPLE_OUT_", "") || 0);
                }
            }
            return total;
        },
        
        /**
         * clearMultipleTracksAfter: Elimina clips después de un tiempo en múltiples pistas, excluyendo algunas.
         */
        clearMultipleTracksAfter: async function (cutTime, trackIndices, excludeTracks, ripple) {
            utils.log(`[clearMultipleTracksAfter] cutTime=${cutTime}, trackIndices=${JSON.stringify(trackIndices)}, excludeTracks=${JSON.stringify(excludeTracks)}, ripple=${ripple}`);
            const videoTracks = trackIndices.filter(t => !excludeTracks.includes(t));
            const audioTracks = [];
            const extend = false; // ripple? no se usa
            const result = await this.rippleAllOut(cutTime, videoTracks, audioTracks, extend);
            return result;
        },

        /**
         * getTrackClips: Obté tots els clips d'una pista en ordre temporal.
         */
        getTrackClips: async function (trackIdx, type = "video") {
            utils.log(`[getTrackClips] Obtenint clips de pista ${trackIdx} (${type})`);
            const countStr = await utils.callJSX(`Clips.count(${trackIdx}, '${type}')`);
            const count = parseInt(countStr || 0);
            if (count === 0) return [];
            
            const clips = [];
            for (let i = 0; i < count; i++) {
                const dataRaw = await utils.callJSX(`Clips.get(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;
                const clip = JSON.parse(dataRaw);
                clip.index = i;
                clips.push(clip);
            }
            utils.log(`[getTrackClips] Retornant ${clips.length} clips`);
            return clips;
        },

        /**
         * cleanFlashWhites: Detecta i elimina físicament els clips "flash blanc" del timeline.
         *
         * Un flash blanc és un clip de durada < minDuration amb un gap < maxGap respecte
         * al clip anterior. Per cada flash (clipB) s'elimina clipB i clipC (posterior) i
         * s'estén clipA (anterior) per tapar el forat.
         *
         * Usa operacions per temps (endAt / removeAt) per evitar el desfasament d'índexs
         * que es produïa amb les operacions per posició. Refresca el array des de Premiere
         * després de cada operació per mantenir sincronització perfecta.
         *
         * @param {Array}  clips      - Array de clips (modificat in-place)
         * @param {number} mainTrack  - Índex de pista V principal (1-based, igual que mainTrack)
         * @param {Object} [options]  - { maxGap, minDuration, frameDuration }
         * @returns {Array} clips actualitzat
         */
        cleanFlashWhites: async function (clips, mainTrack, options) {
            const maxGap       = (options && options.maxGap       !== undefined) ? options.maxGap       : 0.2;
            const minDuration  = (options && options.minDuration  !== undefined) ? options.minDuration  : 0.2;
            const frameDuration = (options && options.frameDuration !== undefined) ? options.frameDuration : 0.04;
            const trackIdx     = mainTrack; // JSX _get() converteix 1 → tracks[0] (V1)

            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 1; i < clips.length - 1; i++) {
                    const clipB = clips[i];
                    const clipA = clips[i - 1];
                    const clipC = clips[i + 1];
                    const gapAB     = clipB.start - clipA.end;
                    const durationB = clipB.end   - clipB.start;

                    if (gapAB < maxGap && durationB < minDuration) {
                        // Fins on esteneu clipA? Si clipD existeix i toca clipC, restem 1 frame per evitar solapament
                        const clipD  = (i + 2 < clips.length) ? clips[i + 2] : null;
                        let newEnd   = clipD ? clipD.start : clipC.end;
                        if (clipD && Math.abs(clipC.end - clipD.start) < 0.001) {
                            newEnd -= frameDuration;
                        }

                        utils.log(`      🔧 Flash blanc detectat: [${clipB.start.toFixed(2)}‑${clipB.end.toFixed(2)}] gap=${gapAB.toFixed(2)}s. Estenent anterior fins a ${newEnd.toFixed(2)}s`);

                        try {
                            // Operacions per temps → immunitat a renumeració d'índexs
                            await utils.callJSX(`Clips.endAt(${trackIdx}, ${clipA.start}, ${newEnd})`);
                            await utils.callJSX(`Clips.removeAt(${trackIdx}, ${clipC.start}, 'video')`);
                            await utils.callJSX(`Clips.removeAt(${trackIdx}, ${clipB.start}, 'video')`);

                            // Refrescar el array des de Premiere per resincronitzar índexs
                            const refreshed = await this.getTrackClips(mainTrack, "video");
                            clips.length = 0;
                            refreshed.forEach(c => clips.push(c));

                            utils.log(`      ✅ Flash blanc eliminat. Timeline refrescat: ${clips.length} clips`);
                            changed = true;
                            break; // reiniciar while
                        } catch (err) {
                            utils.log(`      ❌ Error en la fusió física: ${err.message || err}`);
                            break;
                        }
                    }
                }
            }

            utils.log(`      📋 Clips després de la neteja de flash whites: ${clips.length} clips`);
            clips.forEach((clip, idx) => {
                utils.log(`         Clip ${idx}: start=${clip.start.toFixed(2)}, end=${clip.end.toFixed(2)}, duration=${(clip.end - clip.start).toFixed(2)}`);
            });
            return clips;
        },

        /**
         * insert: Bridge per inserir un clip al timeline via overwriteClip (JSX).
         * @param {string} itemName - Nom del project item a inserir
         * @param {number} trackIdx - Índex de pista (1-based)
         * @param {number} startSec - Temps d'inici en segons
         * @param {number|null} [endSec] - Temps final opcional (per retallar durada)
         * @param {string} [type] - Tipus de pista ('video' | 'audio', default 'video')
         * @returns {Promise<string>} Resposta del JSX
         */
        insert: async function (itemName, trackIdx, startSec, endSec, type) {
            const safeName = (itemName || '').replace(/'/g, "\\'");
            const endParam = (endSec !== null && endSec !== undefined) ? `, ${endSec}` : ', null';
            const typeParam = type || 'video';
            return await utils.callJSX(`Clips.insert('${safeName}', ${trackIdx}, ${startSec}${endParam}, '${typeParam}')`);
        }
    };

    // Alias literal global window.Clips
    window.Clips = FASTPASS_UI.Logic.Clips;

    window.FASTPASS_UI = FASTPASS_UI;
})();
