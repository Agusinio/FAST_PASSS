/**
 * ============================================================================
 * WORKFLOW: GRAPHICS (Infraestructura de Gràfics — CTI, In/Out, Debug)
 * ============================================================================
 * Extret de flow_assembly.js durant la modularització v2.9.5 "LIPO-PRO".
 * Aquest mòdul gestiona operacions de timeline basades en CTI,
 * captura de marcadors d'usuari i validació de WorkArea.
 * Creixerà amb la col·locació de gràfics (GF, TE, P5, P7, TD...).
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Graphics = {

        /**
         * Solució C: Actualitza el punt d'entrada del bloc al cabezal actual (CTI).
         */
        updateBlocInFromCTI: async function() {
            try {
                const cti = parseFloat(await callJSX("Timeline.get()"));
                log(`📍 In Seqüència → ${cti.toFixed(2)}s`);
                await callJSX(`Timeline.inPoint(${cti})`);
                getUtils().status("In fixat", "exito");
            } catch (e) { getUtils().handleError(e, "updateBlocIn"); }
        },

        /**
         * Solució C: Actualitza el punt de sortida del bloc al cabezal actual (CTI).
         */
        updateBlocOutFromCTI: async function() {
            try {
                const cti = parseFloat(await callJSX("Timeline.get()"));
                log(`📍 Fixant BLOC_OUT a ${cti.toFixed(2)}s`);
                
                // 1. Actualitzar Out Point de seqüència
                await callJSX(`Timeline.outPoint(${cti})`);
                
                // 2. Actualitzar marcador BLOC_OUT
                await callJSX(`Markers.set(${cti}, 'BLOC_OUT', 'color=3')`);
                getUtils().status("Out Bloc fixat", "exito");
            } catch (e) { getUtils().handleError(e, "updateBlocOut"); }
        },

        /**
         * Helper: snap al corte más cercano dentro de 2s de tolerancia.
         */
        _snapSimple: function(pos, clipCuts) {
            var best = pos;
            var minD = Infinity;
            for (var i = 0; i < clipCuts.length; i++) {
                var d = Math.abs(clipCuts[i] - pos);
                if (d < minD && d <= 2.0) { minD = d; best = clipCuts[i]; }
            }
            return best;
        },

        /**
         * RESET GRAPHICS: Neteja total de les pistes de gràfics (Pànic button)
         */
        runResetGraphics: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            if (!confirm("Segur que vols ELIMINAR TOTS els gràfics de la línia de temps?")) return;

            log("🧹 Netejant graella de gràfics...");
            const cfg = FASTPASS_UI.Config.get();
            const tracksToClear = [
                cfg.tracks.video.tematitol, 
                cfg.tracks.video.chyrons, 
                cfg.tracks.video.llocdata,
                cfg.tracks.video.graficos
            ];

            try {
                for(let t of tracksToClear) {
                    await callJSX(`Clips.clearTrack(${t}, 'video')`);
                }
                log("✅ Gràfics eliminats correctament.", "INFO");
                getUtils().status("Gràfics Reiniciats", "exito");
            } catch (e) { getUtils().handleError(e, "ResetGraphics"); }
        },

        /**
         * GRAFIC (Marker‑guided placement): Col·loca rètols (wotts) del bin CHY.
         */
        runPlaceGraphic: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Executant placement guiat per marcadors (wotts CHY → markers)...");
            try {
                await FASTPASS_UI.Logic.Assembly.runGuidedAssembly();
                getUtils().status("Placement guiat completat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceGraphic"); }
        },

        /**
         * runPlaceGraph169: Aplica format 16:9 amb fons.
         */
        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9 amb fondos...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     
            const T_FONS = cfg.tracks.video.fondos;  

            try {
                const infoStr = await callJSX(`Clips.at(${T_MP4}, -1, 'video')`);
                if (!infoStr || infoStr === "null") throw new Error("Posa el cabezal sobre el clip.");
                const info = JSON.parse(infoStr);
                await callJSX(`Clips.setProp(${T_MP4}, ${info.index}, 'ADBE Motion', 'ADBE Video Scale', 140, 'video')`);
                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${info.start}, ${info.end}, 'video')`);
            } catch (e) { getUtils().handleError(e, "Graph169"); }
        },

        /**
         * runPlaceBackground: Col·loca un fons vertical genèric.
         */
        runPlaceBackground: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Col·locant fons vertical...");
            const cfg = FASTPASS_UI.Config.get();
            const T_FONS = cfg.tracks.video.fondos;  
            try {
                const cti = parseFloat(await callJSX('Timeline.get()') || "0");
                const bgName = "Fons_Vertical_Generic.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${cti}, null, 'video')`);
                getUtils().status("Fons colocat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceBackground"); }
        },

        /**
         * FASE 3a: Cocinado (inout) — WorkArea snapeado a corte real + sceneDetect.
         * Coloca marcadores de validación a ±1s (color naranja).
         */
        runInOutCocinado: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [INOUT Cocinado] Calculant WorkArea snapejat...");
            try {
                const clips  = await getClipsLogic().getTrackClips(1, 'video');
                if (clips.length === 0) { log("⚠️ No hi ha clips a V1."); return; }
                const clipCuts = clips.map(function(c) { return c.start; });

                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const waCrudo = analysis.crudo || {};

                const waInCrudo  = (waCrudo.workAreaIn !== undefined && waCrudo.workAreaIn !== null) ? waCrudo.workAreaIn : 0;
                const waOutCrudo = (waCrudo.workAreaOut !== undefined && waCrudo.workAreaOut !== null) ? waCrudo.workAreaOut : (clips[clips.length - 1] ? clips[clips.length - 1].end : 0);

                // Snap a corte más cercano
                const snapIn  = this._snapSimple(waInCrudo, clipCuts);
                const snapOut = this._snapSimple(waOutCrudo, clipCuts);

                // Aplicar WorkArea en Premiere
                await callJSX("Timeline.setWorkArea(" + snapIn + ", " + snapOut + ")");

                // Colocar marcadores de validación a ±1s (color naranja = 3)
                const validIn  = snapIn + 1.0;
                const validOut = snapOut - 1.0;
                await callJSX("Markers.set(" + validIn + ", 'VALID_IN', 'color=3')");
                await callJSX("Markers.set(" + validOut + ", 'VALID_OUT', 'color=3')");

                // Guardar sceneDetect + inout dins fase 'cocinado' (merge automàtic)
                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
                    clipCuts: clipCuts,
                    totalClips: clips.length,
                    workAreaIn: snapIn,
                    workAreaOut: snapOut,
                    snapDeltaIn:  snapIn - waInCrudo,
                    snapDeltaOut: snapOut - waOutCrudo,
                    validInMarker: validIn,
                    validOutMarker: validOut,
                    capturedAt: new Date().toISOString()
                });

                getUtils().status("INOUT Cocinado OK", "exito");
            } catch (e) { getUtils().handleError(e, "runInOutCocinado"); }
        },

        /**
         * _waitClipAt: Espera (polling) fins que una pista té o deixa de tenir un clip
         * que cobreix un temps donat. Retorna true si s'assoleix l'estat esperat.
         */
        _waitClipAt: async function (trackIdx, timeSec, shouldExist, timeoutMs) {
            const start = Date.now();
            const timeout = timeoutMs || 5000;
            while (Date.now() - start < timeout) {
                const raw = await callJSX(`Clips.at(${trackIdx}, ${timeSec}, 'video')`);
                const exists = (raw && raw !== "null");
                if (exists === shouldExist) return true;
                await getUtils().delay(250);
            }
            return false;
        },

        /**
         * runDoblePantalla: VERTICALITZACIÓ 16:9 AMB UN SOL CLIC.
         * PAS0=diagnòstic, PAS1=moure MP4 V1→V2, PAS2=duplicar V2→V3,
         * PAS3=fons V1, PAS4=motion. Ctrl+clic = reset de l'estat del flujo.
         * Convenció de pista al JSX: 1-based (1=V1, 2=V2, 3=V3, 4=V4).
         */
        _dp: null,
        _dpBusy: false,

        resetDoblePantalla: async function () {
            this._dp = null;
            this._dpBtnReset();
            log("🔁 [DoblePantalla] Estat reiniciat.");
            getUtils().status("Doble Pantalla reset", "warn");
        },

        /**
         * _dpBtn / _dpBtnSet / _dpBtnReset: Botó de Doble Pantalla amb la seva ETIQUETA
         * ORIGINAL (la de l'HTML, "🪟🪟") capturada la primera vegada que es toca.
         * El flux hi escriu text temporal mentre treballa ('DblPant…') i, en acabar (o si
         * falla), l'ha de deixar EXACTAMENT com estava: abans quedava 'DblPant ✓' i el
         * botó es veia canviat (queixa d'usuari 2026-09-21).
         */
        _dpBtn: function () {
            const btn = document.getElementById('btnGrafDoblePantalla');
            if (!btn) return null;
            if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
            return btn;
        },
        _dpBtnSet: function (txt) {
            const btn = this._dpBtn();
            if (btn) btn.textContent = txt;
        },
        _dpBtnReset: function () {
            const btn = this._dpBtn();
            if (btn) btn.textContent = btn.dataset.origLabel || 'DP';
        },

        _dpParseOk: function (res) {
            if (res && String(res).indexOf('OK:') === 0) return parseInt(String(res).substring(3), 10);
            return null;
        },

        /**
         * _dpColaPosterior: Llegeix la "cola" (clips posteriors) d'una pista de VÍDEO a
         * partir d'un temps i en guarda les posicions originals (start/end).
         */
        _dpColaPosterior: async function (trackIdx, desdeSec) {
            try {
                const r = await callJSX(`Clips.debugTracks('video')`);
                if (!r || String(r).indexOf('ERR') === 0) return [];
                const d = JSON.parse(r);
                const t = (d.tracks || [])[trackIdx - 1];
                if (!t || !t.clips) return [];
                const cola = t.clips.filter(c => c.start >= desdeSec - 0.05).map(c => ({ name: c.name, start: c.start, end: c.end }));
                cola.sort((a, b) => a.start - b.start);
                return cola;
            } catch (e) { return []; }
        },

        /**
         * _dpMesurarDelta: Després d'un insertClip amb ripple, mesura quant s'ha desplaçat
         * la cola: start actual del primer clip de la cola menys el seu start original.
         */
        _dpMesurarDelta: async function (trackIdx, cola, puntFi) {
            if (!cola || cola.length === 0) return 0;
            try {
                const r = await callJSX(`Clips.debugTracks('video')`);
                if (!r || String(r).indexOf('ERR') === 0) return 0;
                const d = JSON.parse(r);
                const t = (d.tracks || [])[trackIdx - 1];
                if (!t || !t.clips) return 0;
                // El primer clip de la cola ara és el primer clip que comença JUST després
                // del forat (start >= puntFi - tolerància). Si l'insert no l'ha desplaçat
                // (el clip nou cap dins el forat), aquest clip segueix a puntFi → delta = 0.
                // ⚠️ NO fer servir "start > puntFi + 0.2": si la cola NO s'ha desplaçat,
                // salta el primer clip i mesura contra el segon → delta espuri (= distància
                // entre clips) que fa moure clips EQUIVOCATS (bug DF 2026-09-04: duplicava
                // el clip posterior del fons i en feia desaparèixer el següent).
                const candidats = t.clips.filter(x => x.start >= puntFi - 0.05);
                if (!candidats.length) return 0;
                candidats.sort((a, b) => a.start - b.start);
                const f = candidats[0];
                const delta = f.start - cola[0].start;
                if (delta > 0.2) return delta;
                return 0;
            } catch (e) {}
            return 0;
        },

        /**
         * _dpDevolverCola: Retorna la cola a les seves posicions originals (start/end
         * guardats) després d'un insertClip que l'havia desplaçada +delta. Comença pel
         * primer clip (re-localitzant cada un pel seu start actual). Retorna quants ha pogut.
         */
        _dpDevolverCola: async function (trackIdx, cola, delta, tag) {
            if (!cola || cola.length === 0 || !delta || delta <= 0) return 0;
            let okCount = 0;
            for (const c of cola) {
                const r = await callJSX(`Clips.debugTracks('video')`);
                let idx = -1;
                if (r && String(r).indexOf('ERR') !== 0) {
                    try {
                        const d = JSON.parse(r);
                        const t = (d.tracks || [])[trackIdx - 1];
                        if (t && t.clips) {
                            const hit = t.clips.find(x => Math.abs(x.start - (c.start + delta)) < 0.5);
                            if (hit) idx = hit.index;
                        }
                    } catch (e) {}
                }
                if (idx >= 0) {
                    const mv = await callJSX(`Clips.moveToRange(${trackIdx}, ${idx}, ${c.start}, ${c.end}, 'video')`);
                    log(`🎬 [${tag}] retornant clip a V${trackIdx}@${c.start.toFixed(2)}s → ${mv}`);
                    if (String(mv).indexOf('OK') === 0) okCount++;
                } else {
                    log(`🚫 [${tag}] no es troba a V${trackIdx} el clip que havia de ser a ${(c.start + delta).toFixed(2)}s.`, "WARN");
                }
            }
            return okCount;
        },

        /**
         * _dpLogZona: Llista els clips (vídeo i àudio) que toquen la zona a partir de
         * desdeSec, per poder VEURE el resultat real de la DF a les pistes (diagnòstic).
         * Mostra per a cada clip: pista, índex, nom, start, end i durada.
         */
        _dpLogZona: async function (tag, desdeSec) {
            try {
                for (const kind of ['video', 'audio']) {
                    const r = await callJSX(`Clips.debugTracks('${kind}')`);
                    if (!r || String(r).indexOf('ERR') === 0) { log(`📋 [${tag}] ${kind} → ${r}`, "WARN"); continue; }
                    const d = JSON.parse(r);
                    const lines = [];
                    (d.tracks || []).forEach((t, ti) => {
                        if (!t || !t.clips) return;
                        for (const c of t.clips) {
                            if (c.end <= desdeSec - 1) continue;
                            if (lines.length >= 60) return;
                            lines.push(`  ${kind.toUpperCase()}${ti + 1}[${c.index}] "${c.name}" ${c.start.toFixed(2)}→${c.end.toFixed(2)} (${(c.end - c.start).toFixed(2)}s)`);
                        }
                    });
                    if (lines.length) {
                        log(`📋 [${tag}] ${kind} des de ${desdeSec.toFixed(2)}s (${lines.length} clips):`);
                        for (const ln of lines) log(ln);
                    } else {
                        log(`📋 [${tag}] ${kind}: cap clip a la zona.`, "WARN");
                    }
                }
            } catch (e) { log(`📋 [${tag}] error llegint pistes: ${e.message}`, "WARN"); }
        },

        /**
         * Desbloqueja automàticament les pistes implicades (V1..V5, A1-A2).
         * Una pista bloquejada fa que overwriteClip/remove fallin EN SILENCI.
         * (2026-09-22) El límit de vídeo surt de la CONFIG: la DF fa servir `video2` (V5).
         */
        _dpUnlockTracks: async function () {
            try {
                const _vid = FASTPASS_UI.Config.get().tracks.video;
                const vMax = Math.max(4, _vid.video1 || 4, _vid.video2 || 5);
                const vRaw = await callJSX("Tracks.count('video')");
                const aRaw = await callJSX("Tracks.count('audio')");
                const vN = Math.min(parseInt(vRaw) || 0, vMax);
                const aN = Math.min(parseInt(aRaw) || 0, 2);
                let anyLocked = false;
                for (let t = 1; t <= vN; t++) {
                    const st = await callJSX(`Tracks.lock(${t}, false, 'video')`);
                    if (st === "ERR") anyLocked = true;
                }
                for (let t = 1; t <= aN; t++) {
                    const st = await callJSX(`Tracks.lock(${t}, false, 'audio')`);
                    if (st === "ERR") anyLocked = true;
                }
                log(`🔓 [DoblePantalla] Pistes desbloquejades (V1-V${vN}, A1-A${aN}).`);
            } catch (eU) {
                log(`⚠️ [DoblePantalla] no s'han pogut desbloquejar pistes: ${eU.message}`);
            }
        },

        /**
         * Respalda l'àudio que comença a v1Start (a A1 o A2) a l'altra pista d'àudio
         * i l'elimina de la pista original. Retorna { audioSrcTrack, audioRestore }.
         * Així, els overwriteClip/duplicate posteriors poden inserir l'àudio del vídeo
         * sense por de sobreescriure'l, i al final es restaura.
         */
        _dpProtegerAudio: async function (v1Start, srcInPoint, srcOutPoint, v1End) {
            const T_A1 = 1, T_A2 = 2;
            let audioSrcTrack = 0;
            let audioRestore = null;
            try {
                for (const aTrack of [T_A1, T_A2]) {
                    const auds = await getClipsLogic().getTrackClips(aTrack, 'audio');
                    const found = auds.find(c => Math.abs(c.start - v1Start) < 0.1);
                    if (found) {
                        audioSrcTrack = aTrack;
                        const backupTrack = (aTrack === T_A1) ? T_A2 : T_A1;
                        const dupBak = await callJSX(`Clips.duplicate(${aTrack}, ${found.index}, ${backupTrack}, 'audio', 0)`);
                        const bakIdx = this._dpParseOk(dupBak);
                        if (bakIdx !== null) {
                            log(`🎬 [DoblePantalla]   àudio respaldat a A${backupTrack}[${bakIdx}]`);
                            await callJSX(`Clips.remove(${aTrack}, ${found.index}, 'audio')`);
                            await getUtils().delay(200);
                            // El duplicate no ajusta trims: forçar-los al clip d'àudio respaldat
                            const rt = await callJSX(`Clips.retrim(${backupTrack}, ${bakIdx}, ${srcInPoint}, ${srcOutPoint}, ${v1End}, 'audio')`);
                            log(`🎬 [DoblePantalla]   retrim àudio respaldat A${backupTrack}[${bakIdx}] → ${rt}`);
                            audioRestore = { track: backupTrack };
                        } else {
                            log(`⚠️ [DoblePantalla]   no s'ha pogut respaldar l'àudio (${dupBak})`);
                        }
                        break;
                    }
                }
            } catch (eAudio) {
                log(`⚠️ [DoblePantalla]   gestió d'àudio (backup): ${eAudio.message}`);
            }
            return { audioSrcTrack: audioSrcTrack, audioRestore: audioRestore };
        },

        /**
         * Després de duplicar/moure un vídeo (que crea àudio automàtic a la pista destí),
         * elimina l'àudio duplicat sobrant i restaura l'àudio respaldat a la pista original.
         */
        _dpNetejarIRestaurarAudio: async function (audioSrcTrack, audioRestore, v1Start, srcInPoint, srcOutPoint, v1End) {
            const T_A1 = 1, T_A2 = 2;
            try {
                if (audioRestore !== null) {
                    const backupTrack = audioRestore.track;
                    const otherTrack = (backupTrack === T_A1) ? T_A2 : T_A1;
                    const otherAuds = await getClipsLogic().getTrackClips(otherTrack, 'audio');
                    const otherDup = otherAuds.find(c => Math.abs(c.start - v1Start) < 0.1);
                    if (otherDup) {
                        const rmO = await callJSX(`Clips.remove(${otherTrack}, ${otherDup.index}, 'audio')`);
                        log(`🎬 [DoblePantalla]   àudio duplicat eliminat d'A${otherTrack} → ${rmO}`);
                    }
                    const backupAuds = await getClipsLogic().getTrackClips(backupTrack, 'audio');
                    const backupDups = backupAuds.filter(c => Math.abs(c.start - v1Start) < 0.1);
                    if (backupDups.length > 1) {
                        const extra = backupDups[backupDups.length - 1];
                        const rmB = await callJSX(`Clips.remove(${backupTrack}, ${extra.index}, 'audio')`);
                        log(`🎬 [DoblePantalla]   àudio duplicat eliminat d'A${backupTrack} → ${rmB}`);
                    }
                } else {
                    // Sense respaldo (A2 no disponible o clip sense àudio): NO eliminar res,
                    // només avisar. Si hi ha un àudio duplicat, l'operador el pot treure a mà.
                    log(`ℹ️ [DoblePantalla]   sense respaldo d'àudio: no s'elimina cap àudio.`);
                }
            } catch (eAudio2) {
                log(`⚠️ [DoblePantalla]   gestió d'àudio (neteja): ${eAudio2.message}`);
            }
            try {
                if (audioRestore !== null && audioSrcTrack !== 0) {
                    const backupAuds = await getClipsLogic().getTrackClips(audioRestore.track, 'audio');
                    const respaldo = backupAuds.find(c => Math.abs(c.start - v1Start) < 0.1);
                    if (respaldo) {
                        const mvA = await callJSX(`Clips.move(${audioRestore.track}, ${respaldo.index}, ${audioSrcTrack}, 'audio', 0)`);
                        log(`🎬 [DoblePantalla]   àudio restaurat a A${audioSrcTrack} → ${mvA}`);
                        // El move no ajusta trims: forçar-los al clip d'àudio restaurat
                        const rtIdx = this._dpParseOk(mvA);
                        if (rtIdx !== null) {
                            const rtA = await callJSX(`Clips.retrim(${audioSrcTrack}, ${rtIdx}, ${srcInPoint}, ${srcOutPoint}, ${v1End}, 'audio')`);
                            log(`🎬 [DoblePantalla]   retrim àudio restaurat A${audioSrcTrack}[${rtIdx}] → ${rtA}`);
                        }
                    } else {
                        log(`⚠️ [DoblePantalla]   no es troba l'àudio respaldat per restaurar.`);
                    }
                } else {
                    log(`ℹ️ [DoblePantalla]   sense àudio a restaurar (o no respaldat).`);
                }
            } catch (eAudio3) {
                log(`⚠️ [DoblePantalla]   gestió d'àudio (restaura): ${eAudio3.message}`);
            }
        },

        runDoblePantalla: async function (event) {
            if (!(await getUtils().validateActiveSequence())) return;
            if (event && (event.ctrlKey || event.metaKey)) { await this.resetDoblePantalla(); return; }
            if (this._dpBusy) { getUtils().status("Doble pantalla ja en curs…", "warn"); return; }
            try {
                this._dpBusy = true;
                this._dp = { step: 0, done: false, data: {} };
                const dp = this._dp;
                this._dpBtnSet('DblPant…');   // text temporal mentre treballa (es restaura al final)
                log("🔁 [DoblePantalla] Cicle complet PAS0→PAS4 en 1 clic (Ctrl+clic = reset).");

                await this._dpUnlockTracks();
                const steps = [this._dpPaso0, this._dpPaso1, this._dpPaso2, this._dpPaso3, this._dpPaso4];
                for (const fn of steps) {
                    const result = await fn.call(this, dp);
                    if (result === false) {
                        this._dpBtnReset();
                        log("❌ [DoblePantalla] Procés aturat per l'error anterior (mira el log).", "ERROR");
                        return;
                    }
                    await getUtils().delay(350); // aire entre passos per al motor NewWorld
                }
                dp.done = true;
                // Verificació final: estat real del timeline després de tota la DF.
                if (dp.data && typeof dp.data.v1Start === 'number') {
                    await this._dpLogZona("DF FINAL", dp.data.v1Start);
                }
                this._dpBtnReset();   // (2026-09-21) botó com a l'inici ('🪟🪟'), no 'DblPant ✓'
                getUtils().status("Doble pantalla completa", "exito");
            } catch (e) {
                this._dpBtnReset();
                getUtils().handleError(e, "runDoblePantalla");
            } finally {
                this._dpBusy = false;
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // (2026-09-23) IPD+ · doble finestra VERTICAL per INTERVAL (TOGGLE)
        //   APLICAR (interval seleccionat; el clip a transformar és a V2):
        //     1. Es recorta el clip de V2 a l'interval i es mou a V3 (1 sol clip).
        //     2. Es duplica V1 → V2 dins l'interval.
        //     3. Motion: V1 = capa INFERIOR · V2 = capa SUPERIOR (SENSE recortes).
        //   REVERTIR (si ja hi ha clips a V3 dins l'interval):
        //     1. S'esborra V2 a l'interval · 2. V3 → V2 · 3. V1 torna a l'estat normal.
        //   NO es posa cap fons PNG: el "fons" de la composició és el mateix clip
        //   original aparcat a V3.
        // ═══════════════════════════════════════════════════════════════
        IPDPLUS: {
            SRC: 2,        // pista del clip que es transforma (es recorta i s'aparca a V3)
            PARK: 3,       // pista on s'aparca el clip original (sense atributs)
            BASE: 1,       // pista del material base (es duplica a SRC i rep INFERIOR)
            // Atributs: `position` en px del frame · `scale` en % · crops en %
            // (2026-09-23) SUPERIOR: Y = 197 (dada per l'usuari) i retall inferior del 15,1%.
            INFERIOR: { position: [1058, 812], scale: 110 },
            SUPERIOR: { position: [161, 197], scale: 50, cropBottom: 15.1 }
        },
        // Estat "normal" del material de BASE en revertir (canvas vertical 608×1080)
        _ipdPlusNormal: { scale: 100, scaleWidth: 100, position: [304, 540], cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
        // Estats previs guardats per revertir exacte (clau = rang de l'interval)
        _ipdPlusStates: {},

        /**
         * runIpdPlus: TOGGLE de l'IPD+ per a l'INTERVAL seleccionat.
         *  - Si a la pista PARK (V3) NO hi ha clips a l'interval → APLICAR.
         *  - Si n'hi ha → REVERTIR (esborrar SRC, tornar PARK → SRC i treure els atributs).
         */
        runIpdPlus: async function (event) {
            if (!(await getUtils().validateActiveSequence())) return;
            try {
                // (2026-09-23) SENSE desbloqueig de pistes: l'usuari les deixa desbloquejades al
                // projecte plantilla (el desbloqueig des del panell no li funciona i no cal).
                const rng = await this._ipdPlusRango();
                if (!rng) {
                    getUtils().status('IPD+: selecciona el clip(s) de V' + this.IPDPLUS.SRC, 'warn');
                    return;
                }
                log(`🎬 [IPD+] interval ${rng.start.toFixed(2)}s → ${rng.end.toFixed(2)}s (${(rng.end - rng.start).toFixed(2)}s)`);
                const park = await this._ipdPlusClipsEnRango(this.IPDPLUS.PARK, rng);
                if (park.length > 0) {
                    log(`🎬 [IPD+] ja hi ha ${park.length} clip(s) a V${this.IPDPLUS.PARK} a l'interval → REVERTIR`);
                    await this._ipdPlusRevertir(rng);
                    getUtils().status('IPD+ revertit', 'exito');
                } else {
                    log('🎬 [IPD+] APLICAR: V' + this.IPDPLUS.SRC + ' → V' + this.IPDPLUS.PARK + ' i duplicar V' + this.IPDPLUS.BASE + ' → V' + this.IPDPLUS.SRC);
                    await this._ipdPlusAplicar(rng);
                    getUtils().status('IPD+ aplicat', 'exito');
                }
                // (2026-09-23) NETJA FINAL d'àudio: les insercions d'IPD+ deixen clips d'àudio a
                // A2+ dins l'interval (el vídeo va enllaçat amb el seu so). **A1 no es toca**.
                await this._ipdPlusLimpiarAudio(rng);
                try { await getUtils().targetOnlyV1('IPD+'); await getUtils().focusV1('IPD+', rng.start); } catch (eF) {}
            } catch (e) { getUtils().handleError(e, 'runIpdPlus'); }
        },

        /**
         * _ipdPlusPoner: (2026-09-23 v2) Copia un clip d'una pista a una altra amb
         * **INSERT + RIPPLE** (`Clips.insertClipFrom` → `Track.insertClip`), que **NO pisa**:
         * desplaça els clips posteriors de la pista destí i aquests es tornen al seu lloc.
         * ABANS s'usava `Clips.insert` per nom: l'overwrite s'estenia la durada SENCERA del
         * media (200 s) i s'enduia els altres talls d'IPD+ (queixa d'usuari).
         * Després de l'insert: es lleva l'àudio enllaçat del clip nou (només el seu) i es retalla
         * a [inPt, outPt, end] amb els in/out reals del clip font.
         */
        _ipdPlusPoner: async function (srcTrack, srcIdx, dstTrack, start, inPt, outPt, end) {
            const cola = await this._dpColaPosterior(dstTrack, end);
            const rI = await callJSX(`Clips.insertClipFrom(${srcTrack}, ${srcIdx}, ${dstTrack}, ${start.toFixed(4)}, 'video')`);
            if (String(rI).indexOf('OK') !== 0) return { ok: false, res: rI, idx: null, audio: '-' };
            await getUtils().delay(200);
            const delta = await this._dpMesurarDelta(dstTrack, cola, end);
            const raw = await callJSX(`Clips.at(${dstTrack}, ${(start + 0.05).toFixed(4)}, 'video')`);
            if (!raw || raw === 'null') return { ok: false, res: 'NO_CLIP', idx: null, audio: '-' };
            const idx = JSON.parse(raw).index;
            const audio = await callJSX(`Clips.removeLinkedAudio(${dstTrack}, ${idx})`);
            const rT = await callJSX(`Clips.retrim(${dstTrack}, ${idx}, ${inPt.toFixed(4)}, ${outPt.toFixed(4)}, ${end.toFixed(4)}, 'video')`);
            if (delta > 0) await this._dpDevolverCola(dstTrack, cola, delta, 'IPD+');
            return { ok: true, idx: idx, res: rT, audio: audio, delta: delta };
        },

        /**
         * _ipdPlusLlegirMotion: Llegeix el Motion d'un clip (en PX, tal com el mostra la UI)
         * i el torna com a objecte. Si no és llegible torna `null` i el flux CONTINUA
         * (pitjor un clip amb el Motion per defecte que un IPD+ avortat).
         * Àtom existent: `Anim.getMotionValues` (ZERO JSX nou).
         * @returns {Promise<Object|null>} {position, scale, scaleWidth, cropLeft..Bottom} o null
         */
        _ipdPlusLlegirMotion: async function (track, idx, tag) {
            try {
                const raw = await callJSX(`Anim.getMotionValues(${track}, ${idx})`);
                if (raw && String(raw).indexOf('ERR') !== 0) {
                    log(`🎬 [IPD+]   Motion ${tag} V${track}[${idx}]: ${raw}`);
                    return JSON.parse(raw);
                }
                log(`⚠️ [IPD+]   Motion ${tag} V${track}[${idx}] no llegible (${raw}) → quedarà el Motion per defecte`, 'WARN');
            } catch (e) {
                log(`⚠️ [IPD+]   Motion ${tag} V${track}[${idx}]: ${e.message}`, 'WARN');
            }
            return null;
        },

        /**
         * _ipdPlusHeredarMotion: Aplica a un clip el Motion llegit d'un altre (mateix patró
         * del fix #124 de la portada): només s'envien les claus que s'han pogut llegir
         * (les `null` s'ometen i no es toquen). Els àtoms get/set treballen en les mateixes
         * unitats (get torna PÍXELS · set els normalitza ell mateix dividint per frameSize).
         */
        _ipdPlusHeredarMotion: async function (track, idx, mv, tag) {
            if (!mv) {
                log(`⚠️ [IPD+]   sense Motion per heretar a V${track}[${idx}] (${tag}) → queda amb el Motion per defecte`, 'WARN');
                return false;
            }
            const vals = {};
            ['position', 'scale', 'scaleWidth', 'cropLeft', 'cropTop', 'cropRight', 'cropBottom']
                .forEach(function (k) { if (mv[k] !== null && mv[k] !== undefined) vals[k] = mv[k]; });
            try {
                const res = await callJSX(`Anim.setMotionValues(${track}, ${idx}, '${getUtils().escape(JSON.stringify(vals))}')`);
                log(`🎬 [IPD+]   Motion heretat → V${track}[${idx}] (${tag}): ${JSON.stringify(vals)} → ${res}`);
                log(`   · comprovació V${track}[${idx}] → ${await callJSX(`Anim.getMotionValues(${track}, ${idx})`)}`);
                if (String(res).indexOf('OK') !== 0) {
                    log(`⚠️ [IPD+]   V${track}[${idx}] NO ha pogut heretar el Motion (${res})`, 'WARN');
                    return false;
                }
                return true;
            } catch (e) {
                log(`⚠️ [IPD+]   aplicant el Motion heretat a V${track}[${idx}]: ${e.message}`, 'WARN');
                return false;
            }
        },

        /**
         * _ipdPlusLimpiarAudio: (2026-09-23) Esborra els clips d'ÀUDIO que les insercions
         * d'IPD+ deixen a les pistes **A2 i següents** dins l'interval (el vídeo inserit hi
         * arrossega el seu so). **A1 NO es toca mai** (és l'àudio del programa).
         * Es crida al FINAL del procés (aplicar i revertir).
         * @returns {Promise<number>} quants clips d'àudio s'han eliminat
         */
        _ipdPlusLimpiarAudio: async function (rng) {
            let n = 0;
            try {
                const aN = parseInt(await callJSX("Tracks.count('audio')") || '0', 10) || 0;
                for (let t = 2; t <= aN; t++) {
                    const clips = await getClipsLogic().getTrackClips(t, 'audio');
                    for (let i = clips.length - 1; i >= 0; i--) {
                        const c = clips[i];
                        if (c.end <= rng.start + 0.001 || c.start >= rng.end - 0.001) continue;
                        const r = await callJSX(`Clips.removeAt(${t}, ${c.start.toFixed(4)}, 'audio')`);
                        log(`🎬 [IPD+]   àudio netejat A${t} "${c.name}" @${c.start.toFixed(2)}s → ${r}`);
                        n++;
                    }
                }
            } catch (e) { log("⚠️ [IPD+] neteja d'àudio: " + e.message, 'WARN'); }
            log(n === 0
                ? '🎬 [IPD+]   cap àudio a A2+ per netejar'
                : `🎬 [IPD+]   ${n} clip(s) d'àudio eliminat(s) a A2+`);
            return n;
        },

        /**
         * _ipdPlusRango: INTERVAL de treball a partir de la SELECCIÓ de clips (1 o més) de
         * la pista SRC. Fallback: el clip de SRC sota el cabezal.
         * @returns {Promise<Object|null>} { start, end } o null
         */
        _ipdPlusRango: async function () {
            const P = this.IPDPLUS;
            let sel = [];
            try {
                const raw = await callJSX('Clips.getSelection()');
                if (raw && String(raw).indexOf('ERR') !== 0) sel = JSON.parse(raw || '[]');
            } catch (eS) { log('⚠️ [IPD+] no puc llegir la selecció: ' + eS.message, 'WARN'); }
            // (2026-09-23) La SELECCIÓ és SEMPRE de V1 (BASE) — és l'interval que mana: el
            // retall de V2 (SRC) es fa respecte a aquest interval. Si hi ha selecció en
            // altres pistes s'ignora (l'operador selecciona el tram a V1).
            const p = this.IPDPLUS;
            if (sel && sel.length) {
                const baseSel = sel.filter(c => c && c.track === p.BASE);
                if (baseSel.length !== sel.length) {
                    log(`ℹ️ [IPD+] de ${sel.length} clip(s) seleccionat(s), només ${baseSel.length} són de V${p.BASE} (la resta s'ignoren)`);
                }
                if (baseSel.length) {
                    const start = Math.min.apply(null, baseSel.map(c => c.start));
                    const end = Math.max.apply(null, baseSel.map(c => c.end));
                    log(`🎬 [IPD+] selecció V${p.BASE}: ${baseSel.length} clip(s) → interval ${start.toFixed(2)}s→${end.toFixed(2)}s (el retall de V${p.SRC} es farà respecte a això)`);
                    return { start: start, end: end };
                }
            }
            // Sense selecció a V1: clip de BASE (V1) sota el cabezal — és una peça trocejada
            // i curta. ⚠️ ABANS s'agafava el clip de SRC (V2), que pot durar tot el bloc
            // (cas real 2026-09-23: 200,28 s → 28 clips tractats sense voler).
            const cti = parseFloat(await callJSX('Timeline.get()') || '0');
            const raw2 = await callJSX(`Clips.at(${p.BASE}, ${cti}, 'video')`);
            if (raw2 && raw2 !== 'null' && String(raw2).indexOf('ERR') !== 0) {
                const c2 = JSON.parse(raw2);
                log(`ℹ️ [IPD+] sense selecció a V${p.BASE} → ús el clip sota el cabezal (${c2.start.toFixed(2)}s→${c2.end.toFixed(2)}s)`);
                return { start: c2.start, end: c2.end };
            }
            return null;
        },

        /**
         * _ipdPlusClipsEnRango: clips d'una pista de vídeo que SOLAPEN l'interval.
         */
        _ipdPlusClipsEnRango: async function (track, rng) {
            const out = [];
            try {
                const clips = await getClipsLogic().getTrackClips(track, 'video');
                for (const c of clips) {
                    if (c.end > rng.start + 0.001 && c.start < rng.end - 0.001) out.push(c);
                }
            } catch (e) { log(`⚠️ [IPD+] llegint V${track}: ${e.message}`, 'WARN'); }
            return out;
        },

        /**
         * _ipdPlusMotion: Aplica els atributs a TOTS els clips d'una pista dins l'interval,
         * desant l'estat previ de cada clip (clau "pista:start") per poder revertir exacte.
         */
        _ipdPlusMotion: async function (track, vals, tag, rng) {
            const clips = await this._ipdPlusClipsEnRango(track, rng);
            for (const c of clips) {
                const key = track + ':' + c.start.toFixed(3);
                const cur = await callJSX(`Anim.getMotionValues(${track}, ${c.index})`);
                try {
                    if (cur && String(cur).indexOf('ERR') !== 0 && !this._ipdPlusStates[key]) {
                        this._ipdPlusStates[key] = JSON.parse(cur);
                    }
                } catch (eS) {}
                const res = await callJSX(`Anim.setMotionValues(${track}, ${c.index}, '${JSON.stringify(vals).replace(/'/g, "\\'")}')`);
                log(`🎬 [IPD+]   V${track}[${c.index}] ${tag} ${JSON.stringify(vals)} → ${res}`);
                // (2026-09-23) Lectura de control: el JSX normalitza la `position` dividint
                // per `frameSize` (X per l'amplada, Y per l'alçada). Amb aquest log es veu
                // QUÈ ha quedat realment i si el motor NewWorld espera una altra escala a la Y.
                const chk = await callJSX(`Anim.getMotionValues(${track}, ${c.index})`);
                log(`🎬 [IPD+]   V${track}[${c.index}] ${tag} llegit → ${chk}`);
            }
        },

        /**
         * _ipdPlusAplicar:
         *  1. V2 (SRC): em quedo 1 sol clip, retallat a l'interval, i el moc a V3 (PARK).
         *  2. V1 (BASE) → V2 (SRC): duplico els clips de l'interval.
         *  3. Motion: V1 = INFERIOR · V2 = SUPERIOR.
         */
        _ipdPlusAplicar: async function (rng) {
            const P = this.IPDPLUS;
            const src = await this._ipdPlusClipsEnRango(P.SRC, rng);
            if (!src.length) { getUtils().status("IPD+: no hi ha clip a V" + P.SRC + " a l'interval", 'error'); return; }
            log(`🎬 [IPD+] V${P.SRC}: ${src.length} clip(s) a l'interval → em quedo 1 i el retallo a l'interval`);

            // ── 1. V2 (SRC) → V3 (PARK): el fragment de l'interval, amb el CONTINGUT correcte ──
            // (2026-09-23) ABANS es recortava el clip de V2 «in place» amb `Clips.retrim`, però
            // Premiere no sempre accepta el nou inPoint en un clip JA existent → el clip pujava
            // a V3 sense tallar-se pel davant (queixa d'usuari). Ara es fa igual que la còpia
            // de V1: s'insereix el fragment per nom (insertNoAudio, sense àudio) i es retalla
            // amb `retrim` amb els in/out desplaçats per l'inici de l'interval.
            const first = src[0];
            const ip0 = (first.inPoint != null) ? first.inPoint : 0;
            const inPt = ip0 + Math.max(0, rng.start - first.start);
            const outPt = ip0 + Math.max(0.04, rng.end - first.start);
            // (2026-10-01 · #129) MOTION DE L'ORIGINAL: es llegeix ARA, amb el clip de SRC
            // encara intacte a la pista (després de `_ipdPlusPoner` ja és a PARK).
            // `Clips.insertClipFrom` fa `tgtTrack.insertClip(projectItem)` → el clip de PARK
            // neix amb el Motion PER DEFECTE (centrat, 100%, sense retalls; MATEIX root cause
            // que #124 a la portada): el Motion viu a la INSTÀNCIA DE PISTA, no a l'ítem.
            // Si el clip de SRC duu la MÀSCARA posicionada/escalada, a V3 sortia descol·locada.
            const mvSrc = await this._ipdPlusLlegirMotion(P.SRC, first.index, 'ORIGINAL');
            // Estat del clip original de SRC (per poder-lo restaurar al revertir)
            this._ipdPlusStates['src'] = {
                name: first.name, inPoint: ip0,
                outPoint: (first.outPoint != null) ? first.outPoint : (ip0 + (first.end - first.start)),
                start: first.start, end: first.end,
                motion: mvSrc
            };
            const put = await this._ipdPlusPoner(P.SRC, first.index, P.PARK, rng.start, inPt, outPt, rng.end);
            if (!put.ok) {
                getUtils().status("IPD+: no s'ha pogut pujar el clip a V" + P.PARK + " (" + put.res + ")", 'error');
                return;
            }
            log(`🎬 [IPD+]   V${P.SRC}[${first.index}] → V${P.PARK}[${put.idx}] retallat [in=${inPt.toFixed(2)} out=${outPt.toFixed(2)} end=${rng.end.toFixed(2)}] → ${put.res} · àudio=${put.audio}`);
            // 1b. (2026-10-01 · #129) El clip aparcat a PARK HERETA el Motion de l'original
            // (posició + escala + retalls): l'insertClip no el porta pas.
            await this._ipdPlusHeredarMotion(P.PARK, put.idx, mvSrc, 'PARK');
            await getUtils().delay(250);

            // ── 2. V2 (SRC): deixar-hi NOMÉS el tros ANTERIOR a l'interval ──
            // (2026-09-23 v3) En lloc de borrar i reposar trossos amb `Clips.insert` (que pisa
            // cap endavant), es RETALLA el clip original: si comença abans de l'interval es
            // queda com a tros anterior; si no, s'elimina. El tros POSTERIOR es reposa al final.
            for (const c of src) {
                const cIn2 = (c.inPoint != null) ? c.inPoint : 0;
                if (c.start < rng.start - 0.05) {
                    const outA = cIn2 + (rng.start - c.start);
                    const rT2 = await callJSX(`Clips.retrim(${P.SRC}, ${c.index}, ${cIn2.toFixed(4)}, ${outA.toFixed(4)}, ${rng.start.toFixed(4)}, 'video')`);
                    log(`🎬 [IPD+]   V${P.SRC}[${c.index}] retallat al tros ANTERIOR ${c.start.toFixed(2)}s→${rng.start.toFixed(2)}s → ${rT2}`);
                } else {
                    const rR = await callJSX(`Clips.removeAt(${P.SRC}, ${c.start.toFixed(4)}, 'video')`);
                    log(`🎬 [IPD+]   V${P.SRC}[${c.index}] eliminat (no té tros anterior) → ${rR}`);
                }
            }
            await getUtils().delay(250);

            // ── 2. Copiar V1 (BASE) → V2 (SRC) els fragments de l'interval, SENSE àudio ──
            // (2026-09-23) `insertClipFrom`/`duplicate` copiaven el MEDIA SENCER i amb àudio
            // vinculat → contingut equivocat i clips d'àudio bruts. Ara: `insertNoAudio`
            // (insereix per nom i elimina l'àudio enllaçat) + `Clips.retrim` amb els in/out
            // REALS del clip font, de manera que la còpia mostra exactament el mateix.
            const base = await this._ipdPlusClipsEnRango(P.BASE, rng);
            log(`🎬 [IPD+] V${P.BASE}: ${base.length} clip(s) a l'interval → copiant a V${P.SRC} (sense àudio)`);
            for (const c of base) {
                const cIn = (c.inPoint != null) ? c.inPoint : 0;
                const cOut = (c.outPoint != null) ? c.outPoint : (cIn + (c.end - c.start));
                const putC = await this._ipdPlusPoner(P.BASE, c.index, P.SRC, c.start, cIn, cOut, c.end);
                if (!putC.ok) {
                    log(`⚠️ [IPD+]   no s'ha pogut copiar V${P.BASE}[${c.index}] (${putC.res})`, 'WARN');
                    continue;
                }
                log(`🎬 [IPD+]   copiat V${P.BASE}[${c.index}]@${c.start.toFixed(2)}s → V${P.SRC}[${putC.idx}] [in=${cIn.toFixed(2)} out=${cOut.toFixed(2)} end=${c.end.toFixed(2)}] → ${putC.res} · àudio=${putC.audio}`);
            }
            await getUtils().delay(250);

            // ── 2b. Reposar el tros POSTERIOR dels clips originals de V2 (fora de l'interval) ──
            // (2026-09-23) Es fa DESPRÉS de les còpies de V1: `Clips.insert` fa overwrite des del
            // start, així que si es fes abans, les còpies s'endurien aquest tros. Sent l'últim
            // material de la pista, aquí no destrueix res.
            for (const c of src) {
                if (!(c.end > rng.end + 0.05)) continue;
                const cIn = (c.inPoint != null) ? c.inPoint : 0;
                const cOut = (c.outPoint != null) ? c.outPoint : (cIn + (c.end - c.start));
                const inB = cIn + (rng.end - c.start);
                const escB = getUtils().escape(c.name);
                const rIB = await callJSX(`Clips.insert('${escB}', ${P.SRC}, ${rng.end.toFixed(4)}, null, 'video')`);
                if (String(rIB).indexOf('OK') !== 0) {
                    log(`⚠️ [IPD+]   no s'ha pogut reposar el tros posterior de V${P.SRC} (${rIB})`, 'WARN');
                    continue;
                }
                const rawB = await callJSX(`Clips.at(${P.SRC}, ${(rng.end + 0.05).toFixed(4)}, 'video')`);
                if (!rawB || rawB === 'null') continue;
                const idxB = JSON.parse(rawB).index;
                await callJSX(`Clips.removeLinkedAudio(${P.SRC}, ${idxB})`);
                const rB = await callJSX(`Clips.retrim(${P.SRC}, ${idxB}, ${inB.toFixed(4)}, ${cOut.toFixed(4)}, ${c.end.toFixed(4)}, 'video')`);
                log(`🎬 [IPD+]   V${P.SRC} MANTINGUT tros posterior ${rng.end.toFixed(2)}s→${c.end.toFixed(2)}s → ${rB}`);
            }
            await getUtils().delay(200);

            // ── 3. Motion: BASE = INFERIOR · SRC = SUPERIOR (es desen els estats previs) ──
            await this._ipdPlusMotion(P.BASE, P.INFERIOR, 'INFERIOR', rng);
            await this._ipdPlusMotion(P.SRC, P.SUPERIOR, 'SUPERIOR', rng);
        },

        /**
         * _ipdPlusRevertir (toggle):
         *  1. Esborrar els clips de SRC (V2) dins l'interval.
         *  2. Tornar el clip de PARK (V3) a SRC (V2), al seu rang.
         *  3. Treure els atributs de BASE (V1): estat previ guardat o estat normal.
         */
        _ipdPlusRevertir: async function (rng) {
            const P = this.IPDPLUS;
            // 1. Esborrar SRC (V2) i PARK (V3) dins l'interval (de darrere cap endavant)
            const src = await this._ipdPlusClipsEnRango(P.SRC, rng);
            for (let i = src.length - 1; i >= 0; i--) {
                const r = await callJSX(`Clips.removeAt(${P.SRC}, ${src[i].start.toFixed(4)}, 'video')`);
                log(`🎬 [IPD+]   esborrat V${P.SRC}@${src[i].start.toFixed(2)}s → ${r}`);
            }
            await getUtils().delay(200);
            const park = await this._ipdPlusClipsEnRango(P.PARK, rng);
            for (let i = park.length - 1; i >= 0; i--) {
                const r = await callJSX(`Clips.removeAt(${P.PARK}, ${park[i].start.toFixed(4)}, 'video')`);
                log(`🎬 [IPD+]   esborrat V${P.PARK}@${park[i].start.toFixed(2)}s → ${r}`);
            }
            await getUtils().delay(250);

            // 2. Restaurar el clip ORIGINAL a SRC (V2) amb els seus in/out i rang d'abans
            //    (2026-09-23) ABANS es movia el fragment de PARK a SRC, cosa que deixava V2
            //    amb només l'interval. Ara es re-insereix l'original guardat a _ipdPlusStates.
            const st = this._ipdPlusStates['src'];
            if (st && st.name) {
                const escR = getUtils().escape(st.name);
                const rIR = await callJSX(`Clips.insert('${escR}', ${P.SRC}, ${st.start.toFixed(4)}, null, 'video')`);
                if (String(rIR).indexOf('OK') === 0) {
                    const rawR = await callJSX(`Clips.at(${P.SRC}, ${(st.start + 0.05).toFixed(4)}, 'video')`);
                    if (rawR && rawR !== 'null') {
                        const idxR = JSON.parse(rawR).index;
                        await callJSX(`Clips.removeLinkedAudio(${P.SRC}, ${idxR})`);
                        const rR = await callJSX(`Clips.retrim(${P.SRC}, ${idxR}, ${st.inPoint.toFixed(4)}, ${st.outPoint.toFixed(4)}, ${st.end.toFixed(4)}, 'video')`);
                        log(`🎬 [IPD+]   V${P.SRC} restaurat "${st.name}" [in=${st.inPoint.toFixed(2)} out=${st.outPoint.toFixed(2)} end=${st.end.toFixed(2)}] → ${rR}`);
                        // (2026-10-01 · #129) El clip restaurat neix de `Clips.insert` → Motion PER
                        // DEFECTE: es torna a aplicar el Motion que duia l'original (si no, la
                        // màscara quedaria descol·locada després d'un cicle aplicar/revertir).
                        await this._ipdPlusHeredarMotion(P.SRC, idxR, st.motion, 'RESTAURAT');
                    }
                } else {
                    log(`⚠️ [IPD+]   no s'ha pogut restaurar "${st.name}" a V${P.SRC} (${rIR})`, 'WARN');
                }
                delete this._ipdPlusStates['src'];
            } else {
                log('ℹ️ [IPD+]   sense estat guardat de V' + P.SRC + " → V" + P.SRC + " queda buit a l'interval");
            }
            await getUtils().delay(250);

            // 3. BASE (V1) → estat previ (o normal)
            const base = await this._ipdPlusClipsEnRango(P.BASE, rng);
            for (const c of base) {
                const key = P.BASE + ':' + c.start.toFixed(3);
                const prev = this._ipdPlusStates[key];
                const vals = prev || this._ipdPlusNormal;
                const res = await callJSX(`Anim.setMotionValues(${P.BASE}, ${c.index}, '${JSON.stringify(vals).replace(/'/g, "\\'")}')`);
                log(`🎬 [IPD+]   V${P.BASE}[${c.index}] ${prev ? 'estat previ' : 'normal'} → ${res}`);
                if (prev) delete this._ipdPlusStates[key];
            }
        },

        /**
         * PAS0: Detecta el clip 16:9 sota el CTI i fa diagnòstic de les pistes
         * (especialment si alguna està BLOQUEJADA, que fa fallar overwrite/remove).
         */
        _dpPaso0: async function (dp) {
            // (2026-09-22) Pistes des de la CONFIG (mapa final): el MP4 viu a `mp4` (V1).
            const T_V1 = FASTPASS_UI.Config.get().tracks.video.mp4;
            const cti = parseFloat(await callJSX('Timeline.get()') || "0");
            const infoRaw = await callJSX(`Clips.at(${T_V1}, ${cti}, 'video')`);
            if (!infoRaw || infoRaw === "null") {
                getUtils().status("Col·loca el CTI sobre el clip 16:9", "warn");
                return false;
            }
            const info = JSON.parse(infoRaw);
            dp.data.info = info;
            dp.data.cti = cti;
            dp.data.v1Start = info.start;
            dp.data.v1End = info.end;
            dp.data.srcInPoint = info.inPoint;
            dp.data.srcOutPoint = info.inPoint + (info.end - info.start);
            dp.data.v2NewIdx = null;
            dp.data.v3NewIdx = null;
            dp.data.audioSrcTrack = 0;
            dp.data.audioRestore = null;
            log(`🎬 [DoblePantalla] PAS0: clip V1[${info.index}] "${info.name}" ${info.start.toFixed(2)}s→${info.end.toFixed(2)}s (${(info.end - info.start).toFixed(2)}s)`);

            // Diagnòstic de pistes (bloquejades?)
            const vRaw = await callJSX('Clips.debugTracks(\'video\')');
            const aRaw = await callJSX('Clips.debugTracks(\'audio\')');
            log(`🎬 [DoblePantalla] PAS0: VÍDEO → ${vRaw}`);
            log(`🎬 [DoblePantalla] PAS0: ÀUDIO → ${aRaw}`);
            try {
                const v = JSON.parse(vRaw);
                const a = JSON.parse(aRaw);
                const lockedV = (v.tracks || []).filter(t => t.locked);
                const lockedA = (a.tracks || []).filter(t => t.locked);
                if (lockedV.length) log(`⚠️ [DoblePantalla] PISTES DE VÍDEO BLOQUEJADES: V${lockedV.map(t => t.index + 1).join(', V')} — Desbloqueja-les (icona cadenat) perquè overwrite/remove funcionin.`, "WARN");
                if (lockedA.length) log(`⚠️ [DoblePantalla] PISTES D'ÀUDIO BLOQUEJADES: A${lockedA.map(t => t.index + 1).join(', A')}`, "WARN");
            } catch (eDiag) { log(`⚠️ [DoblePantalla] PAS0: no s'ha pogut analitzar el diag: ${eDiag.message}`); }

            getUtils().status("PAS0 OK: clip 16:9 detectat", "exito");
            return true;
        },

        /**
         * Nota: el PAS automàtic de la MASCARA PER REELS (recortar i pujar a V4) s'ha
         * OMIÉS del flujo perquè l'operador ja la col·loca manualment a V4.
         * El flujo comença directament amb el MP4: PAS1 = moure V1→V2.
         */

        _dpPaso1: async function (dp) {
            // (2026-09-22) MAPA FINAL de pistes: l'origen és el MP4 (`mp4`, V1) i la 1a
            // finestra de la Doble Finestra va a `video1` (V4). El fons (PAS3) → `fondos` (V3).
            const _vid = FASTPASS_UI.Config.get().tracks.video;
            const T_V1 = _vid.mp4, T_V2 = _vid.video1;
            const { info, cti, v1Start, v1End, srcInPoint, srcOutPoint } = dp.data;

            log(`🎬 [DoblePantalla] PAS1: moure V${T_V1}[${info.index}] "${info.name}" → V${T_V2}`);
            // ⚠️ duplicate re-insereix el MP4 sencer i pisa el que hi hagi a V2. Per això
            // s'usa INSERT amb ripple (insertClipFrom): la cola de V2 es desplaça sola.
            const v2cola = await this._dpColaPosterior(T_V2, v1Start);
            log(`🎬 [DoblePantalla]   clips posteriors a V2 → ${v2cola.length}`);
            const ires2 = await callJSX(`Clips.insertClipFrom(${T_V1}, ${info.index}, ${T_V2}, ${v1Start}, 'video')`);
            log(`🎬 [DoblePantalla]   insertClipFrom V1[${info.index}] → V2@${v1Start.toFixed(2)}s → ${ires2}`);
            if (ires2 !== "OK" && String(ires2).indexOf('ERR') === 0) {
                getUtils().status("PAS1 ERROR: insertClip a V2", "error"); return false;
            }
            const v2ok = await this._waitClipAt(T_V2, cti, true, 3000);
            if (!v2ok) { getUtils().status("PAS1 ERROR: no apareix clip a V2", "error"); return false; }
            const newV2Raw = await callJSX(`Clips.at(${T_V2}, ${v1Start + 0.1}, 'video')`);
            if (!newV2Raw || newV2Raw === "null") { getUtils().status("PAS1 ERROR: no es troba el clip inserit a V2", "error"); return false; }
            const newV2 = JSON.parse(newV2Raw);
            const v2NewIdx = newV2.index;
            log(`🎬 [DoblePantalla]   clip a V2 localitzat → V2[${v2NewIdx}]`);

            // Mesurar el desplaçament real de la cola de V2 (per retornar-la després).
            // ⚠️ sense fallback: si el delta és 0 vol dir que la cola NO s'ha mogut
            // (l'insert va cabre sense ripple) → no cal devoldre res. Un fallback amb la
            // durada del clip mouria clips que no s'han desplaçat (bug DF 2026-09-04).
            const v2delta = await this._dpMesurarDelta(T_V2, v2cola, v1End);
            if (v2delta > 0) log(`🎬 [DoblePantalla]   desplaçament cola V2 → ${v2delta.toFixed(2)}s`);

            // Retrim del clip duplicat amb crida JSX SEPARADA (fiabilitat de l'inPoint)
            const rtV2 = await callJSX(`Clips.retrim(${T_V2}, ${v2NewIdx}, ${srcInPoint}, ${srcOutPoint}, ${v1End}, 'video')`);
            log(`🎬 [DoblePantalla]   retrim V2 → ${rtV2}`);
            await getUtils().delay(200);
            const v2Check = await callJSX(`Clips.at(${T_V2}, ${cti}, 'video')`);
            log(`🎬 [DoblePantalla]   V2 verificat → ${v2Check}`);
            try {
                const v2Data = JSON.parse(v2Check);
                if (v2Data && v2Data.name && v2Data.name !== info.name) {
                    log(`⚠️ [DoblePantalla]   ATENCIÓ: V2 conté "${v2Data.name}" i no "${info.name}"`, "WARN");
                }
            } catch (e2) {}

            // Tornar la cola de V2 al seu lloc (començant pel primer clip).
            await this._dpDevolverCola(T_V2, v2cola, v2delta, "DoblePantalla PAS1");

            dp.data.v2NewIdx = v2NewIdx;

            // Desvincular l'àudio del clip V1 abans d'eliminar-lo: així el remove només
            // treu el VÍDEO i l'àudio es queda a A1 (sense duplicar, moure ni machacar).
            const unl = await callJSX(`Clips.unlink(${T_V1}, ${info.index}, 'video')`);
            log(`🎬 [DoblePantalla]   unlink V1[${info.index}] → ${unl}`);
            await getUtils().delay(200);

            let rmV1 = await callJSX(`Clips.remove(${T_V1}, ${info.index})`);
            await getUtils().delay(300);
            let v1Gone = await this._waitClipAt(T_V1, cti, false, 2500);
            if (!v1Gone) {
                log("⚠️ [DoblePantalla]   V1 encara té el clip; reintentant remove...");
                rmV1 = await callJSX(`Clips.remove(${T_V1}, ${info.index})`);
                await getUtils().delay(300);
                v1Gone = await this._waitClipAt(T_V1, cti, false, 2500);
            }
            log(`🎬 [DoblePantalla]   remove V1 → ${rmV1} | verificació: ${v1Gone ? 'OK' : 'TIMEOUT'}`);

            // Neteja final: els overwriteClip del MP4 deixen clips d'àudio "flotants" a A1.
            // Deduplicar: conservar l'àudio ORIGINAL (el primer a la posició) i eliminar els
            // duplicats que hagin creat els duplicate. NOTA: l'àudio original es queda a A1.
            const dda = await callJSX(`Clips.dedupeAudioAt(${v1Start})`);
            log(`🎬 [DoblePantalla]   dedupeAudioAt(${v1Start.toFixed(2)}) → ${dda}`);

            // DIAGNÒSTIC: què queda realment a A1/A2 al voltant del punt
            const aDiag = await callJSX(`Clips.audioAround(${v1Start})`);
            log(`🎬 [DoblePantalla] PAS1: ÀUDIO al voltant de ${v1Start.toFixed(2)} → ${aDiag}`);

            // NOTA: l'àudio del segmente es queda a A1 desvinculat (correcte: sona a la
            // seva posició). Els clips duplicats (V2) són només VÍDEO. No es toca A2.
            return true;
        },

        _dpPaso2: async function (dp) {
            // (2026-09-22) 2a finestra de la DF → `video2` (V5); la 1a ve de `video1` (V4).
            const _vid = FASTPASS_UI.Config.get().tracks.video;
            const T_V2 = _vid.video1, T_V3 = _vid.video2;
            const { v1Start, v1End, cti, v2NewIdx, srcInPoint, srcOutPoint } = dp.data;
            if (v2NewIdx === null) { getUtils().status("PAS2 ERROR: falta índex V2", "error"); return false; }

            // ⚠️ duplicate re-insereix el MP4 sencer i pisa el que hi hagi a V3. Per això
            // s'usa INSERT amb ripple (insertClipFrom): la cola de V3 es desplaça sola.
            const v3cola = await this._dpColaPosterior(T_V3, v1Start);
            log(`🎬 [DoblePantalla]   clips posteriors a V3 → ${v3cola.length}`);
            log(`🎬 [DoblePantalla] PAS2: duplicar V2[${v2NewIdx}] → V3`);
            const ires3 = await callJSX(`Clips.insertClipFrom(${T_V2}, ${v2NewIdx}, ${T_V3}, ${v1Start}, 'video')`);
            log(`🎬 [DoblePantalla]   insertClipFrom V2[${v2NewIdx}] → V3@${v1Start.toFixed(2)}s → ${ires3}`);
            if (ires3 !== "OK" && String(ires3).indexOf('ERR') === 0) { getUtils().status("PAS2 ERROR: insertClip a V3", "error"); return false; }
            const v3ok = await this._waitClipAt(T_V3, cti, true, 3000);
            if (!v3ok) { getUtils().status("PAS2 ERROR: no apareix clip a V3", "error"); return false; }
            const newV3Raw = await callJSX(`Clips.at(${T_V3}, ${v1Start + 0.1}, 'video')`);
            if (!newV3Raw || newV3Raw === "null") { getUtils().status("PAS2 ERROR: no es troba el clip inserit a V3", "error"); return false; }
            const newV3 = JSON.parse(newV3Raw);
            const v3NewIdx = newV3.index;
            log(`🎬 [DoblePantalla]   clip a V3 localitzat → V3[${v3NewIdx}]`);

            // Mesurar el desplaçament real de la cola de V3 (per retornar-la després).
            // ⚠️ sense fallback (delta 0 = la cola no s'ha mogut → no cal devoldre res).
            const v3delta = await this._dpMesurarDelta(T_V3, v3cola, v1End);
            if (v3delta > 0) log(`🎬 [DoblePantalla]   desplaçament cola V3 → ${v3delta.toFixed(2)}s`);

            // Retrim del clip duplicat amb crida JSX SEPARADA
            const rtV3 = await callJSX(`Clips.retrim(${T_V3}, ${v3NewIdx}, ${srcInPoint}, ${srcOutPoint}, ${v1End}, 'video')`);
            log(`🎬 [DoblePantalla]   retrim V3 → ${rtV3}`);
            await getUtils().delay(200);
            const v3Check = await callJSX(`Clips.at(${T_V3}, ${cti}, 'video')`);
            log(`🎬 [DoblePantalla]   V3 verificat → ${v3Check}`);
            try {
                const v3Data = JSON.parse(v3Check);
                if (v3Data && v3Data.name && v3Data.name.indexOf("MASCARA") !== -1) {
                    log(`⚠️ [DoblePantalla]   ATENCIÓ: V3 conté la MASCARA, no el MP4.`, "WARN");
                }
                // Diagnòstic: comparar in/out del V3 amb els del V2 origen
                const v2Raw = await callJSX(`Clips.get(${T_V2}, ${v2NewIdx}, 'video')`);
                log(`🎬 [DoblePantalla]   V2 origen (in/out) → ${v2Raw}`);
                if (v2Raw && v2Raw !== "null") {
                    const v2d = JSON.parse(v2Raw);
                    const diffIn = Math.abs((v3Data.inPoint || 0) - (v2d.inPoint || 0));
                    if (diffIn > 0.1) {
                        log(`⚠️ [DoblePantalla]   DESFASAMENT inPoint: V2=${v2d.inPoint.toFixed(2)} vs V3=${v3Data.inPoint.toFixed(2)}`, "WARN");
                    }
                }
            } catch (e3) {}

            // Tornar la cola de V3 al seu lloc (començant pel primer clip).
            await this._dpDevolverCola(T_V3, v3cola, v3delta, "DoblePantalla PAS2");

            dp.data.v3NewIdx = v3NewIdx;

            // Neteja: eliminar els clips d'àudio duplicats que el duplicate hagi deixat a A1
            const dda3 = await callJSX(`Clips.dedupeAudioAt(${v1Start})`);
            log(`🎬 [DoblePantalla]   dedupeAudioAt(${v1Start.toFixed(2)}) → ${dda3}`);

            // DIAGNÒSTIC: què queda realment a A1/A2 al voltant del punt
            const aDiag3 = await callJSX(`Clips.audioAround(${v1Start})`);
            log(`🎬 [DoblePantalla] PAS2: ÀUDIO al voltant de ${v1Start.toFixed(2)} → ${aDiag3}`);
            return true;
        },

        _dpPaso3: async function (dp) {
            // (2026-09-22) El fons de la DF va a la pista de FONS/GRAF (`fondos`, V3).
            const T_V1 = FASTPASS_UI.Config.get().tracks.video.fondos;
            const { v1Start, v1End } = dp.data;
            // Fons de la doble finestra (bin 3CatInfo/Grafisme/Background)
            const bgName = "3CatInfo_VERTICALITZACIO_Fons-per-videos.png";
            log(`🎬 [DoblePantalla] PAS3: fons "${bgName}" a V${T_V1} [${v1Start.toFixed(2)}, ${v1End.toFixed(2)}]`);

            // ⚠️ El fons (PNG) s'insereix amb la durada natural que decideix Premiere: un
            // overwrite directe al hueco pisa el clip posterior de la pista de fons. Si hi ha
            // cola posterior s'usa INSERT amb ripple (insertClipItem): la cola es desplaça
            // sola; després es retalla el fons a v1End i es retorna la cola al seu lloc.
            const v1cola = await this._dpColaPosterior(T_V1, v1End);
            log(`🎬 [DoblePantalla]   clips posteriors a V${T_V1} → ${v1cola.length}`);
            await this._dpLogZona("PAS3 pre-fons", v1Start);

            // 1. Insertar el PNG a l'inici del rang.
            const bgRes = (v1cola.length > 0)
                ? await callJSX(`Clips.insertClipItem('${getUtils().escape(bgName)}', ${T_V1}, ${v1Start}, 'video')`)
                : await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_V1}, ${v1Start}, 0, 'video')`);
            if (bgRes !== "OK" && String(bgRes).indexOf('ERR') === 0) {
                log(`⚠️ [DoblePantalla] PAS3: no s'ha pogut col·locar el fons (${bgRes}). Es continua sense fons.`, "WARN");
                return true;
            }
            log(`🎬 [DoblePantalla] PAS3: fons inserit → ${bgRes}`);

            // 2. Localitzar el clip del PNG (el que ara comença a v1Start)
            const bgRaw = await callJSX(`Clips.at(${T_V1}, ${v1Start + 0.1}, 'video')`);
            if (!bgRaw || bgRaw === "null") {
                log(`⚠️ [DoblePantalla] PAS3: no es troba el clip del fons a ${(v1Start + 0.1).toFixed(2)}s`, "WARN");
                return true;
            }
            const bg = JSON.parse(bgRaw);
            log(`🎬 [DoblePantalla] PAS3: clip fons localitzat → ${bgRaw}`);

            // Mesurar el desplaçament real de la cola de la pista de fons (per retornar-la després).
            // ⚠️ El PNG s'insereix amb la durada per defecte curta (0.6s a 25fps): cap dins
            // el forat [v1Start, v1End], així que el ripple NO desplaça la cola → delta = 0
            // i no cal devoldre res. NO fer fallback amb la durada del clip: mouria clips
            // que no s'han desplaçat i duplicaria el clip posterior (bug DF 2026-09-04).
            const v1delta = await this._dpMesurarDelta(T_V1, v1cola, v1End);
            if (v1delta > 0) log(`🎬 [DoblePantalla]   desplaçament cola V1 → ${v1delta.toFixed(2)}s`);
            await this._dpLogZona("PAS3 cola desplaçada", v1Start);

            // 3. Estirar-lo perquè ocupi tot el rang fins a v1End (trim normal: la cola no es mou).
            const endRes = await callJSX(`Clips.end(${T_V1}, ${bg.index}, ${v1End}, 'video')`);
            log(`🎬 [DoblePantalla] PAS3: estirar fons a ${v1End.toFixed(2)}s → ${endRes}`);

            // 3b. Tornar la cola de V1 al seu lloc (començant pel primer clip).
            await this._dpDevolverCola(T_V1, v1cola, v1delta, "DoblePantalla PAS3");

            // 3c. Estat real de les pistes després de la devolució (diagnòstic).
            await this._dpLogZona("PAS3 post-devolució", v1Start);

            // 4. Verificar
            const bgCheck = await callJSX(`Clips.at(${T_V1}, ${v1Start + 0.1}, 'video')`);
            log(`🎬 [DoblePantalla] PAS3: V${T_V1} verificat → ${bgCheck}`);
            return true;
        },

        _dpPaso4: async function (dp) {
            // (2026-09-22) Motion de les dues finestres: `video1` (V4) i `video2` (V5).
            const _vid = FASTPASS_UI.Config.get().tracks.video;
            const T_V2 = _vid.video1, T_V3 = _vid.video2;
            const { v2NewIdx, v3NewIdx } = dp.data;
            if (v2NewIdx === null || v3NewIdx === null) { getUtils().status("PAS4 ERROR: falten índexs V2/V3", "error"); return false; }
            const comuns = { scale: 68 };
            // V2 (capa inferior): SENSE recorte lateral (el clip de V3, en una capa
            // superior, és qui el limita a la part central del canvas). Simplificat.
            // ⚠️ SÍ porta recortes SUPERIOR/INFERIOR (cropTop/cropBottom) igual que V3:
            // sense ells la imatge de V2 ocupa tot l'alt del canvas i sembla tenir una
            // escala diferent de V3 (bug DF 2026-09-04).
            const infVals = Object.assign({}, comuns, { position: [141, 451], cropTop: 14, cropBottom: 15.5 });
            // V3 (capa superior): manté el recorte (limita la part central del canvas).
            // El recorte només va a la DRETA (cropRight ~64.5%): la finestra mostra la
            // franja esquerra del material (un dels 2 personatges del pla 16:9). El PAN
            // del slider desplaça el contingut dins d'aquesta finestra per reencuadrar-lo.
            const supVals = Object.assign({}, comuns, { position: [492, 451], cropRight: 64.5, cropTop: 14, cropBottom: 15.5 });

            // Guardar el preset DF al motor JSX: el slider l'usa per re-aplicar els
            // recortes de les 2 finestres si Premiere els ha perdut en seleccionar el clip.
            // (2026-09-22) Les claus són "v" + Nº DE PISTA (V4/V5): així el JSX les troba
            // amb `_pKey = "v" + target.track` (abans estaven fixades com a v2/v3).
            const dfPresetJson = JSON.stringify({ ['v' + T_V2]: infVals, ['v' + T_V3]: supVals });
            const presetRes = await callJSX(`Anim.setDfPreset('${dfPresetJson}')`);
            log(`🎬 [DoblePantalla] PAS4: preset DF guardat → ${presetRes}`);

            const infRes = await callJSX(`Anim.setMotionValues(${T_V2}, ${v2NewIdx}, '${JSON.stringify(infVals).replace(/'/g, "\\'")}')`);
            const supRes = await callJSX(`Anim.setMotionValues(${T_V3}, ${v3NewIdx}, '${JSON.stringify(supVals).replace(/'/g, "\\'")}')`);
            log(`🎬 [DoblePantalla] PAS4: Motion V2[${v2NewIdx}] → ${infRes} | V3[${v3NewIdx}] → ${supRes}`);

            const chkInf = await callJSX(`Anim.getMotionValues(${T_V2}, ${v2NewIdx})`);
            const chkSup = await callJSX(`Anim.getMotionValues(${T_V3}, ${v3NewIdx})`);
            log(`🎬 [DoblePantalla] PAS4: Motion V2 llegit → ${chkInf}`);
            log(`🎬 [DoblePantalla] PAS4: Motion V3 llegit → ${chkSup}`);

            // Refresc NewWorld: re-aplicar els Motion (toggle de selecció intern de
            // setMotionValues) perquè el monitor mostri l'escala real. Sense això, el
            // render pot quedar amb l'aspecte anterior (p. ex. V2 sense l'escala 68%).
            await getUtils().delay(250);
            const infRes2 = await callJSX(`Anim.setMotionValues(${T_V2}, ${v2NewIdx}, '${JSON.stringify(infVals).replace(/'/g, "\\\\'")}')`);
            await getUtils().delay(250);
            const supRes2 = await callJSX(`Anim.setMotionValues(${T_V3}, ${v3NewIdx}, '${JSON.stringify(supVals).replace(/'/g, "\\\\'")}')`);
            log(`🎬 [DoblePantalla] PAS4: refresc Motion V2/V3 → ${infRes2} / ${supRes2}`);

            // DIAGNÒSTIC crops (2026-09-04): comprovar si els recortes de V3 persisteixen
            // al cap d'uns ms (si el motor NewWorld els descarta, aquí es veurà cropR=0).
            await getUtils().delay(400);
            const lateV3 = await callJSX(`Anim.getMotionValues(${T_V3}, ${v3NewIdx})`);
            log(`🎬 [DoblePantalla] PAS4: V3 crops 400ms després → ${lateV3}`);

            getUtils().status("Doble pantalla processada (revisa el log)", "exito");

            // 🎯 Base de reencuadre del slider: ajust FI (±margen px) al voltant de la
            // posició del PAS4 per a cada capa. Així el slider NO pot arribar a mostrar
            // la imatge de l'altra finestra (límits hardcodeats, 2026-09-04).
            try {
                window.FASTPASS_UI._dfReencuadre = {
                    v2x: infVals.position[0],
                    v3x: supVals.position[0],
                    margen: 20
                };
                log(`🎬 [DoblePantalla] PAS4: base reencuadre slider → V2x=${infVals.position[0]}px V3x=${supVals.position[0]}px ±${20}px`);
            } catch (eBase) {}

            // 🎯 FOCUS + TARGETING V1 (2026-09-21): deixar V1/A1 com a ÚNIQUES pistes amb
            // targeting i el clip de V1 seleccionat (clip objectiu del panell). Abans el
            // targeting quedava en les pistes que havia tocat la DF (V2/V3) i el focus no
            // tornava a V1 (queixa d'usuari).
            await getUtils().targetOnlyV1("DoblePantalla");
            await getUtils().focusV1("DoblePantalla", dp.data.v1Start);

            // Diagnòstic: comprovar que el focus a V1 no ha fet perdre els crops de V3.
            const postV3 = await callJSX(`Anim.getMotionValues(${T_V3}, ${v3NewIdx})`);
            log(`🎬 [DoblePantalla] PAS4: V3 crops després del focus V1 → ${postV3}`);

            return true;
        },

        /**
         * _selectedVideoClip: Retorna el clip de VÍDEO seleccionat al timeline (o null).
         */
        _selectedVideoClip: async function () {
            const selRaw = await callJSX('Clips.getSelectedVideo()');
            if (!selRaw || selRaw === "null") return null;
            return JSON.parse(selRaw);
        },

        /**
         * _aplicarMotionAClip: Aplica valors de Motion al clip seleccionat i ho loga.
         * Els px de position es normalitzen dins d'Anim.setMotionValues.
         */
        _aplicarMotionAClip: async function (nom, sel, vals) {
            const res = await callJSX(`Anim.setMotionValues(${sel.track}, ${sel.index}, '${JSON.stringify(vals).replace(/'/g, "\\'")}')`);
            log(`🎬 [${nom}] Motion V${sel.track}[${sel.index}] → ${res}`);
            if (String(res).indexOf('OK') !== 0) { getUtils().status(nom + ": no s'ha pogut aplicar Motion (" + res + ")", "error"); return false; }
            const chk = await callJSX(`Anim.getMotionValues(${sel.track}, ${sel.index})`);
            log(`🎬 [${nom}] Motion llegit → ${chk}`);
            return true;
        },

        /**
         * runIpd: TOGGLE IPD ↔ NORMAL sobre el clip seleccionat.
         *  - Si el clip NO està en estat IPD → aplica escala 144% + pos [-94.5, 562] px
         *    i guarda l'estat Motion previ per poder revertir.
         *  - Si el clip JA està en estat IPD → reverteix a l'estat previ guardat
         *    (o a l'estat normal per defecte si no n'hi ha de guardat).
         *  A més, en aplicar IPD canvia el color d'etiqueta del clip al timeline.
         */
        runIpd: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            try {
                const sel = await this._selectedVideoClip();
                if (!sel) { getUtils().status("IPD: selecciona el clip de vídeo", "warn"); return; }
                log(`🎬 [IPD] clip seleccionat → V${sel.track}[${sel.index}] "${sel.name}" (${sel.start.toFixed(2)}s→${sel.end.toFixed(2)}s)`);

                const IPD_VALS = { scale: 144, position: [-94.5, 562] };
                // Estat "normal" per defecte (canvas 608×1080, centre): s'usa només quan
                // es reverteix un clip IPD sense tenir guardat l'estat previ (p. ex. sessió nova).
                const NORMAL_VALS = { scale: 100, position: [304, 540], scaleWidth: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 };
                const stateKey = sel.track + ':' + sel.start.toFixed(3);
                const states = (window.FASTPASS_UI._ipdStates = window.FASTPASS_UI._ipdStates || {});

                // Llegir valors Motion actuals per decidir si ja està en IPD.
                const curRaw = await callJSX(`Anim.getMotionValues(${sel.track}, ${sel.index})`);
                let curScale = null;
                try { if (curRaw && String(curRaw).indexOf('ERR') !== 0) curScale = JSON.parse(curRaw).scale; } catch (eCur) {}
                const isIpd = (states[stateKey] !== undefined) || (curScale !== null && Math.abs(curScale - 144) < 3);

                if (isIpd) {
                    // ── REVERTIR a normal ──
                    const prev = states[stateKey] || NORMAL_VALS;
                    const restore = {
                        scale: (prev.scale != null) ? prev.scale : NORMAL_VALS.scale,
                        position: (prev.position && prev.position.length === 2) ? prev.position : NORMAL_VALS.position,
                        scaleWidth: (prev.scaleWidth != null) ? prev.scaleWidth : 100,
                        cropLeft: (prev.cropLeft != null) ? prev.cropLeft : 0,
                        cropTop: (prev.cropTop != null) ? prev.cropTop : 0,
                        cropRight: (prev.cropRight != null) ? prev.cropRight : 0,
                        cropBottom: (prev.cropBottom != null) ? prev.cropBottom : 0
                    };
                    delete states[stateKey];
                    const ok = await this._aplicarMotionAClip("IPD↩", sel, restore);
                    if (ok) getUtils().status("IPD revertit a normal", "exito");
                    return;
                }

                // ── APLICAR IPD ──
                // Guardar estat previ real (per poder revertir exacte).
                if (curRaw && String(curRaw).indexOf('ERR') !== 0) {
                    try {
                        const c = JSON.parse(curRaw);
                        states[stateKey] = {
                            scale: c.scale, position: c.position, scaleWidth: c.scaleWidth,
                            cropLeft: c.cropLeft, cropTop: c.cropTop, cropRight: c.cropRight, cropBottom: c.cropBottom
                        };
                    } catch (eS) {}
                }
                const ok = await this._aplicarMotionAClip("IPD", sel, IPD_VALS);
                if (ok) getUtils().status("IPD aplicat: 144% · pos -94.5, 562", "exito");
            } catch (e) { getUtils().handleError(e, "runIpd"); }
        },

        /**
         * _colocarFonsMapa: Col·loca el fons PNG a V1 DINS del rang [sel.start, sel.end]
         * sense machacar cap clip aliè.
         * Mètode (cola): l'overwriteClip insereix el PNG amb la durada que decideix
         * Premiere, així que MAI es fa overwrite dins del hueco si hi ha clips al darrere.
         * En lloc d'això:
         *   1) es llegeixen els clips posteriors de V1 (cola) i es desplacen +10s cap
         *      endavant COMENÇANT PEL DARRER (obrint espai sense trepitjar res),
         *   2) s'insereix el fons al hueco (ara no pisa res) i es retalla a sel.end,
         *   3) es torna la cola al seu lloc COMENÇANT PEL PRIMER.
         * @param {number} T_V1 - Pista de VÍDEO del fons (1-based; `tracks.video.fondos` = V3)
         * @param {object} sel - { start, end, track, index } del clip del mapa
         * @param {string} BG - Nom del PNG del fons
         * @returns {Promise<boolean>} true si el fons ha quedat col·locat al hueco
         */
        _colocarFonsMapa: async function (T_V1, sel, BG) {
            try {
                // 0. Hueco buit i sense fons previ: protecció.
                const existBgRaw = await callJSX(`Clips.at(${T_V1}, ${sel.start + 0.1}, 'video')`);
                if (existBgRaw && existBgRaw !== "null") {
                    try {
                        const eb = JSON.parse(existBgRaw);
                        if (eb.name && String(eb.name).indexOf("Fons-per-videos") !== -1) {
                            log(`🎬 [MAPA] ja hi ha el fons a V${T_V1} en aquest rang. S'omet la inserció.`);
                            return true;
                        }
                        log(`⚠️ [MAPA] a V${T_V1} dins del rang hi ha "${eb.name}": el hueco no està buit. S'omet la inserció del fons per no pisar-lo.`, "WARN");
                        return false;
                    } catch (eBg) {}
                }

                const huecoDur = sel.end - sel.start;
                if (huecoDur <= 0.05) {
                    log(`⚠️ [MAPA] el clip és massa curt (${huecoDur.toFixed(2)}s) per posar-hi el fons.`, "WARN");
                    return false;
                }

                // 1. Llegir els clips posteriors de V1 (start >= sel.end) i guardar-ne l'estat.
                let cola = [];
                try {
                    const dtRaw = await callJSX(`Clips.debugTracks('video')`);
                    if (dtRaw && String(dtRaw).indexOf('ERR') !== 0) {
                        const dt = JSON.parse(dtRaw);
                        const v1 = (dt.tracks || [])[T_V1 - 1];
                        if (v1 && v1.clips) {
                            cola = v1.clips.filter(c => c.start >= sel.end - 0.05);
                            cola.sort((a, b) => a.start - b.start);
                        }
                    }
                } catch (eDT) {}
                log(`🎬 [MAPA] clips posteriors a V1: ${cola.length}${cola.length ? ' (primer a ' + cola[0].start.toFixed(2) + 's)' : ''}`);

                // Helper: llista actual de clips de V1 (per re-localitzar després de moure).
                const listarV1 = async () => {
                    try {
                        const r = await callJSX(`Clips.debugTracks('video')`);
                        if (!r || String(r).indexOf('ERR') === 0) return [];
                        const d = JSON.parse(r);
                        const v1 = (d.tracks || [])[T_V1 - 1];
                        return (v1 && v1.clips) ? v1.clips : [];
                    } catch (e) { return []; }
                };

                const colaData = cola.map(c => ({ name: c.name, start: c.start, end: c.end }));
                let deltaCola = 0;

                // Helper: tornar la cola al seu lloc (començant pel primer clip) fent servir
                // el desplaçament real deltaCola mesurat després de l'insertClip.
                const tornarCola = async (motiu) => {
                    if (deltaCola <= 0) return;
                    for (let i = 0; i < colaData.length; i++) {
                        const c = colaData[i];
                        const cur = await listarV1();
                        const target = cur.find(x => Math.abs(x.start - (c.start + deltaCola)) < 0.5);
                        if (!target) {
                            log(`🚫 [MAPA] (${motiu}) no es troba el clip "${c.name}" que havia de ser a ${(c.start + deltaCola).toFixed(2)}s.`, "WARN");
                            continue;
                        }
                        const mv = await callJSX(`Clips.moveToRange(${T_V1}, ${target.index}, ${c.start}, ${c.end}, 'video')`);
                        log(`🎬 [MAPA] (${motiu}) retornant clip "${c.name}" a ${c.start.toFixed(2)}s → ${mv}`);
                    }
                };

                // 2. Inserir el fons: si hi ha cola posterior s'usa INSERT amb ripple
                //    (insertClipItem): Premiere desplaça la cola sola, sense pisar res.
                //    Si no hi ha cola, overwrite directe al hueco (no pisa res).
                const bgRes = (colaData.length > 0)
                    ? await callJSX(`Clips.insertClipItem('${getUtils().escape(BG)}', ${T_V1}, ${sel.start}, 'video')`)
                    : await callJSX(`Clips.insert('${getUtils().escape(BG)}', ${T_V1}, ${sel.start}, 0, 'video')`);
                log(`🎬 [MAPA] fons "${BG}" inserit a V1@${sel.start.toFixed(2)}s (${colaData.length > 0 ? 'ripple insert' : 'overwrite'}) → ${bgRes}`);
                if (bgRes !== "OK" && String(bgRes).indexOf('ERR') === 0) {
                    log(`⚠️ [MAPA] no s'ha pogut col·locar el fons (${bgRes}).`, "WARN");
                    return false;
                }
                const bgRaw = await callJSX(`Clips.at(${T_V1}, ${sel.start + 0.1}, 'video')`);
                if (!bgRaw || bgRaw === "null") {
                    log(`🚫 [MAPA] no es troba el fons al hueco després d'inserir-lo.`, "WARN");
                    return false;
                }
                const bg = JSON.parse(bgRaw);

                // Mesurar el desplaçament real de la cola (si n'hi havia): el primer clip de
                // la cola ara és el primer clip que comença just després del forat
                // (start >= sel.end - 0.05). Si el fons (PNG, durada curta 0.6s) ha cabut
                // dins el forat, la cola NO s'ha mogut → deltaCola = 0 (no cal tornar res).
                // ⚠️ El criteri antic ("start > sel.end + 0.2") saltava el primer clip no
                // desplaçat i mesurava la distància al SEGON → delta espuri que feia tornar
                // clips EQUIVOCATS (mateix bug que DoblePantalla 2026-09-04).
                if (colaData.length > 0) {
                    const cur = await listarV1();
                    const candidatsM = cur.filter(x => x.start >= sel.end - 0.05);
                    if (candidatsM.length) {
                        candidatsM.sort((a, b) => a.start - b.start);
                        const dM = candidatsM[0].start - colaData[0].start;
                        if (dM > 0.2) deltaCola = dM;
                    }
                    log(`🎬 [MAPA] desplaçament real de la cola mesurat → ${deltaCola.toFixed(2)}s`);
                }

                // 3. Trims del final: retallar el fons fins a sel.end. És un trim NORMAL
                //    (la cola NO es mou amb el trim; queda desplaçada i la tornem al pas 4).
                const endRes = await callJSX(`Clips.end(${T_V1}, ${bg.index}, ${sel.end}, 'video')`);
                log(`🎬 [MAPA] fons retallat fins ${sel.end.toFixed(2)}s → ${endRes}`);

                // 4. Tornar la cola al seu lloc (començant pel primer clip).
                if (colaData.length > 0) {
                    await tornarCola("retorn");
                }

                // 5. Verificació final: fons al hueco i clip següent intacte.
                const bgFinal = await callJSX(`Clips.at(${T_V1}, ${sel.start + 0.1}, 'video')`);
                const nextFinal = await callJSX(`Clips.at(${T_V1}, ${sel.end + 0.05}, 'video')`);
                log(`🎬 [MAPA] V1 al hueco → ${bgFinal}`);
                log(`🎬 [MAPA] V1 just després del hueco → ${nextFinal}`);
                return true;
            } catch (eBg) {
                log(`⚠️ [MAPA] error col·locant el fons: ${eBg.message}`, "WARN");
                return false;
            }
        },
        /**
         * runMapa (MAPA ZOOM): Puja el clip seleccionat a la pista de VÍDEO 1 (`video1`, V4),
         * col·loca a la pista de FONS (`fondos`, V3) el mateix fons de la doble finestra en
         * el rang del clip, i aplica al clip (V4) escala 48% i posició Y=447 (la X no es
         * toca; l'usuari la pot ajustar amb el slider).
         * (2026-09-22) Pistes des de la CONFIG (abans fixades a V1/V2).
         */
        runMapa: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const _vid = FASTPASS_UI.Config.get().tracks.video;
            const T_V1 = _vid.mp4, T_V2 = _vid.video1, T_FONS = _vid.fondos;
            const BG = "3CatInfo_VERTICALITZACIO_Fons-per-videos.png";
            try {
                const sel = await this._selectedVideoClip();
                if (!sel) { getUtils().status("MAPA ZOOM: selecciona el clip de vídeo", "warn"); return; }
                log(`🎬 [MAPA] clip seleccionat → V${sel.track}[${sel.index}] "${sel.name}" (${sel.start.toFixed(2)}s→${sel.end.toFixed(2)}s)`);
                await this._dpUnlockTracks();

                // 1. Pujar el clip a V2 (duplicate + remove de l'origen)
                let idxV2 = null;
                if (sel.track === T_V2) {
                    idxV2 = sel.index;
                    log("🎬 [MAPA] el clip ja és a V2.");
                } else {
                    // Llegir l'origen (inPoint/outPoint) del clip ANTES de moure'l:
                    // duplicate no conserva els trims del source → cal retrim després.
                    let srcIn = null, srcOut = null;
                    try {
                        const srcRaw = await callJSX(`Clips.get(${sel.track}, ${sel.index}, 'video')`);
                        if (srcRaw && srcRaw !== "null") {
                            const src = JSON.parse(srcRaw);
                            if (src.inPoint != null) srcIn = src.inPoint;
                            if (src.outPoint != null) srcOut = src.outPoint;
                        }
                    } catch (eSrc) {}

                    // ⚠️ duplicate/overwrite re-insereix a V2 el MP4 SENZER i pisa el que hi
                    // hagi a V2 (mapes anteriors). Per això s'usa INSERT amb ripple
                    // (insertClipFrom): Premiere desplaça sols els clips posteriors de V2,
                    // sense pisar-los. Després del retrim es torna la cola al seu lloc.
                    let v2cola = [];
                    try {
                        const v2dtRaw = await callJSX(`Clips.debugTracks('video')`);
                        if (v2dtRaw && String(v2dtRaw).indexOf('ERR') !== 0) {
                            const v2dt = JSON.parse(v2dtRaw);
                            const v2t = (v2dt.tracks || [])[T_V2 - 1];
                            if (v2t && v2t.clips) {
                                v2cola = v2t.clips.filter(c => c.start >= sel.start - 0.05).map(c => ({ name: c.name, start: c.start, end: c.end }));
                                v2cola.sort((a, b) => a.start - b.start);
                            }
                        }
                    } catch (eV2) {}
                    log(`🎬 [MAPA] clips posteriors a V2: ${v2cola.length}${v2cola.length ? ' (primer a ' + v2cola[0].start.toFixed(2) + 's)' : ''}`);

                    // Inserir amb ripple el projectItem del clip font a V2 (no pisa res).
                    const ires = await callJSX(`Clips.insertClipFrom(${sel.track}, ${sel.index}, ${T_V2}, ${sel.start}, 'video')`);
                    log(`🎬 [MAPA] insertClipFrom V${sel.track}[${sel.index}] → V2@${sel.start.toFixed(2)}s → ${ires}`);
                    if (ires !== "OK" && String(ires).indexOf('ERR') === 0) {
                        getUtils().status("MAPA ZOOM: no s'ha pogut inserir el clip a V2 (insertClip)", "error");
                        return;
                    }
                    const okV2 = await this._waitClipAt(T_V2, sel.start + 0.1, true, 3000);
                    if (!okV2) { getUtils().status("MAPA ZOOM: no apareix el clip a V2", "error"); return; }
                    const newV2Raw = await callJSX(`Clips.at(${T_V2}, ${sel.start + 0.1}, 'video')`);
                    if (!newV2Raw || newV2Raw === "null") { getUtils().status("MAPA ZOOM: no es troba el clip inserit a V2", "error"); return; }
                    const newV2 = JSON.parse(newV2Raw);
                    idxV2 = newV2.index;
                    log(`🎬 [MAPA] clip a V2 localitzat → V2[${idxV2}] (start=${newV2.start.toFixed(2)}, dur=${newV2.duration.toFixed(2)})`);

                    // Mesurar el desplaçament real de la cola de V2 (si n'hi havia).
                    // Primer clip de la cola = primer clip que comença just després del forat
                    // (start >= sel.end - 0.05). Sense fallback (delta 0 = no s'ha mogut).
                    let v2delta = 0;
                    if (v2cola.length > 0) {
                        try {
                            const curV2Raw = await callJSX(`Clips.debugTracks('video')`);
                            if (curV2Raw && String(curV2Raw).indexOf('ERR') !== 0) {
                                const dV2 = JSON.parse(curV2Raw);
                                const tV2 = (dV2.tracks || [])[T_V2 - 1];
                                if (tV2 && tV2.clips) {
                                    const candV2 = tV2.clips.filter(x => x.start >= sel.end - 0.05);
                                    if (candV2.length) {
                                        candV2.sort((a, b) => a.start - b.start);
                                        const dV2m = candV2[0].start - v2cola[0].start;
                                        if (dV2m > 0.2) v2delta = dV2m;
                                    }
                                }
                            }
                        } catch (e2v) {}
                        log(`🎬 [MAPA] desplaçament de la cola de V2 mesurat → ${v2delta.toFixed(2)}s`);
                    }

                    // Retrim: conservar l'origen (in/out del source) i el final del clip.
                    if (srcIn != null && srcOut != null) {
                        const rt = await callJSX(`Clips.retrim(${T_V2}, ${idxV2}, ${srcIn}, ${srcOut}, ${sel.end}, 'video')`);
                        log(`🎬 [MAPA] retrim V2[${idxV2}] in=${srcIn} out=${srcOut} end=${sel.end} → ${rt}`);
                    } else {
                        log("⚠️ [MAPA] no s'han pogut llegir els trims originals; es manté el clip inserit.", "WARN");
                    }

                    // Tornar la cola de V2 al seu lloc (començant pel primer clip).
                    if (v2cola.length > 0 && v2delta > 0) {
                        for (let vi = 0; vi < v2cola.length; vi++) {
                            const vc = v2cola[vi];
                            const v2listRaw = await callJSX(`Clips.debugTracks('video')`);
                            let v2idx = -1;
                            if (v2listRaw && String(v2listRaw).indexOf('ERR') !== 0) {
                                try {
                                    const v2l = JSON.parse(v2listRaw);
                                    const v2tt = (v2l.tracks || [])[T_V2 - 1];
                                    if (v2tt && v2tt.clips) {
                                        const hit = v2tt.clips.find(x => Math.abs(x.start - (vc.start + v2delta)) < 0.5);
                                        if (hit) v2idx = hit.index;
                                    }
                                } catch (eV2b) {}
                            }
                            if (v2idx >= 0) {
                                const vmv = await callJSX(`Clips.moveToRange(${T_V2}, ${v2idx}, ${vc.start}, ${vc.end}, 'video')`);
                                log(`🎬 [MAPA]   V2 clip retornat a ${vc.start.toFixed(2)}s → ${vmv}`);
                            } else {
                                log(`🚫 [MAPA]   no es troba a V2 el clip que havia de ser a ${(vc.start + v2delta).toFixed(2)}s.`, "WARN");
                            }
                        }
                    }
                    // Eliminar l'origen (desvinculant l'àudio si venia de V1 per conservar-lo)
                    if (sel.track === T_V1) {
                        try { await callJSX(`Clips.unlink(${sel.track}, ${sel.index}, 'video')`); } catch (eU) {}
                        await getUtils().delay(150);
                    }
                    const rm = await callJSX(`Clips.remove(${sel.track}, ${sel.index}, 'video')`);
                    log(`🎬 [MAPA] remove original V${sel.track}[${sel.index}] → ${rm}`);
                    if (sel.track === T_V1) {
                        const dda = await callJSX(`Clips.dedupeAudioAt(${sel.start})`);
                        log(`🎬 [MAPA] dedupeAudioAt(${sel.start.toFixed(2)}) → ${dda}`);
                    }
                }

                // 2. Fons a la pista de FONS (config) dins del rang del clip (sense machacar el clip següent)
                const fonsOk = await this._colocarFonsMapa(T_FONS, sel, BG);

                // 3. Motion al clip de V2: scale 48%, Y=447; la X es manté intacta
                const vals = { scale: 48, positionY: 447 };
                const resM = await callJSX(`Anim.setMotionValues(${T_V2}, ${idxV2}, '${JSON.stringify(vals).replace(/'/g, "\\'")}')`);
                log(`🎬 [MAPA] Motion V2[${idxV2}] (scale 48 · Y=447, X sense tocar) → ${resM}`);
                const chkM = await callJSX(`Anim.getMotionValues(${T_V2}, ${idxV2})`);
                log(`🎬 [MAPA] Motion llegit → ${chkM}`);

                getUtils().status(fonsOk
                    ? `MAPA ZOOM: clip a V${T_V2} + fons + 48% / Y447`
                    : `MAPA ZOOM: clip a V${T_V2} + Motion aplicat (fons no inserit, mira el log)`, fonsOk ? "exito" : "warn");

                // (2026-09-21) Tornar la auto-selecció a V1: targeting només V1/A1 + clip de V1.
                await getUtils().targetOnlyV1("MAPA");
                await getUtils().focusV1("MAPA", sel.start);
            } catch (e) { getUtils().handleError(e, "runMapa"); }
        },
        /**
         * runTotem: Només toca l'escala X del clip seleccionat (Scale Width = 126%),
         * desactivant "Uniform Scale". La Y (Scale) i la posició queden com estan.
         */
        runTotem: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            try {
                const sel = await this._selectedVideoClip();
                if (!sel) { getUtils().status("TOTEM: selecciona el clip de vídeo", "warn"); return; }
                log(`🎬 [TOTEM] clip seleccionat → V${sel.track}[${sel.index}] "${sel.name}" (${sel.start.toFixed(2)}s→${sel.end.toFixed(2)}s)`);
                const ok = await this._aplicarMotionAClip("TOTEM", sel, { scaleWidth: 126 });
                if (ok) getUtils().status("TOTEM aplicat: escala X 126%", "exito");

                // (2026-09-21) Tornar la auto-selecció a V1: targeting només V1/A1 + clip de V1.
                await getUtils().targetOnlyV1("TOTEM");
                await getUtils().focusV1("TOTEM", sel.start);
            } catch (e) { getUtils().handleError(e, "runTotem"); }
        },

        /**
         * FASE 3a-b y 4a-b s'han mogut a flow_markers.js (placeCookedMarkers,
         * capturaUsuarioInOut, capturaUsuarioMarks)
         */
    };

    window.FASTPASS_UI.Workflows.Graphics = FASTPASS_UI.Workflows.Graphics;
})();
