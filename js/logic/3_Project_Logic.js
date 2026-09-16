/**
 * ============================================================================
 * LOGIC: PROJECT (Orquestació de Sesió)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = window.FASTPASS_UI.Utils;
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Logic.Project = {
        
        /**
         * activate: Orquestra l'activació d'un tema (Projecte + Seqüència).
         */
        activate: async function(projectPath, sequenceWildcard) {
            utils.log(`📁 Activant tema: ${projectPath}`);
            
            // 1. Obertura física literal
            const res = await callJSX(`$.global.Project.open('${projectPath.replace(/\\/g, '/').replace(/'/g, "\\'")}')`);
            if (res !== "OK") return { success: false, error: res };
            
            await utils.delay(1200);

            // 2. Cerca literal d'items
            const itemsRaw = await callJSX(`$.global.Project.items('')`);
            const items = JSON.parse(itemsRaw || "[]");
            
            const targetSeq = items.find(i => i.type === 3 && i.name.indexOf(sequenceWildcard) !== -1);
            
            if (targetSeq) {
                utils.log(`🎯 Seqüència trobada: ${targetSeq.name}. Obrint...`);
                await callJSX(`$.global.Project.openSeq('${targetSeq.name}')`);
                return { success: true, sequence: targetSeq.name };
            } else {
                utils.log(`⚠️ Seqüència no trobada amb prefix: ${sequenceWildcard}`, "WARN");
                return { success: false, error: "SEQUENCE_NOT_FOUND" };
            }
        },

        /**
        * create: Crea un nou tema a partir d'una plantilla (Lògica verificada v2.6.0)
        * @param {Object}      ctx
        * @param {Object}      wottData
        * @param {Object}      media
        * @param {Object}      paths
        * @param {Array}       portadaList
        * @param {string}      shortProg
        * @param {Object|null} cleanFeedData  - { mediaPath, mp4ProgramInPoint, mp4ExpandedOutPoint, mp4SweetInPoint, mp4SweetOutPoint, mp4Duration, escaletaLines[] } | null
        */
        create: async function(ctx, wottData, media, paths, portadaList, shortProg, cleanFeedData) {
            const { plantillaPath, fullDestPath, folderPath, sanitizedTheme } = paths;
            const config = ctx.config;

            // ─── DIAGNÒSTIC: Detectar mode clip extret ──────────────────────────
            const isExtractedClip = cleanFeedData && cleanFeedData._isExtractedClip === true;
            if (isExtractedClip) {
                utils.log(`🎬 [EXTRACT] Mode clip extret detectat. mediaPath=${cleanFeedData.mediaPath}, mp4ExpandedInPoint=${cleanFeedData.mp4ExpandedInPoint.toFixed(2)}s, mp4ExpandedOutPoint=${cleanFeedData.mp4ExpandedOutPoint.toFixed(2)}s, _extractedWorldSecMediaStart=${cleanFeedData._extractedWorldSecMediaStart ? cleanFeedData._extractedWorldSecMediaStart.toFixed(2) : 'N/A'}s`);
            }
            // ─────────────────────────────────────────────────────────────────────

            // 1. ABRIR PLANTILLA
            utils.log(`📂 Obrint plantilla: ${plantillaPath}`);
            const jsxCommand = `FASTPASS.Project.open('${plantillaPath.replace(/\\/g, "/").replace(/'/g, "\\'")}')`;
            utils.log(`🔍 JSX command: ${jsxCommand}`);
            const openResult = await callJSX(jsxCommand);
            utils.log(`📤 Resultado de Project.open: ${openResult}`);
            
            // 2. INGESTA GENERAL (Wotts, Media i Portada)
            // Si tenemos cleanFeed, no ingerir el MP4 estándar
            let mediaToIngest = media;
            if (cleanFeedData && cleanFeedData.mediaPath && media && media.mp4) {
                mediaToIngest = JSON.parse(JSON.stringify(media));
                delete mediaToIngest.mp4;
                if (isExtractedClip) {
                    utils.log(`🎬 [EXTRACT] MP4 estàndard exclòs de la ingesta. S'importarà el clip local: ${cleanFeedData.mediaPath}`);
                }
            }
            await this.ingestAssets(ctx, wottData, mediaToIngest, portadaList);

            // 3. CLONAR I RENOMBRAR SEQÜÈNCIA
            const plantillaSeq = "OTT VERTICAL"; 
            utils.log(`👥 Buscant i clonant: ${plantillaSeq}`);
            const resClone = await callJSX(`FASTPASS.Project.cloneSeq('${encodeURIComponent(plantillaSeq)}')`);
            
            if (resClone && resClone.indexOf("ERR") === -1) {
                // Usar sanitizedTheme (tema real extret del JSON), NO wottData.tema
                // (que pot ser "INTRO"/"PENDENT" quan el scanner no detecta tema als rètols).
                const temaNet = (sanitizedTheme && sanitizedTheme.length > 2)
                    ? sanitizedTheme.toUpperCase()
                    : (wottData && wottData.tema ? wottData.tema.toUpperCase() : "TEMA");
                const finalSeqName = `${shortProg}_${temaNet}`;
                
                utils.log(`📝 Seqüència clonada [${resClone}]. Renombrant a: ${finalSeqName}`);
                const safeResClone = encodeURIComponent(resClone).replace(/'/g, "\\'");
                const safeFinalSeqName = encodeURIComponent(finalSeqName).replace(/'/g, "\\'");
                await callJSX(`FASTPASS.Project.rename('${safeResClone}', '${safeFinalSeqName}')`);
            
                // 4. INSERTAR VÍDEO AL TIMELINE
                if (cleanFeedData && cleanFeedData.mediaPath) {
                    // ⏳ Si és clip extret, esperar que el fitxer existeixi (ffmpeg pot estar treballant)
                    if (isExtractedClip) {
                        const clipPath = cleanFeedData.mediaPath;
                        utils.log(`⏳ [EXTRACT] Esperant que el clip extret estigui disponible: ${clipPath}`);
                        for (let waitI = 0; waitI < 15; waitI++) {
                            const safeClip = JSON.stringify(clipPath);
                            const exists = await callJSX(`IO.exists(${safeClip})`);
                            if (exists === "true") {
                                utils.log(`✅ [EXTRACT] Clip disponible després de ${(waitI+1)*2}s`);
                                break;
                            }
                            await utils.delay(2000);
                        }
                    }
                    // ─── MODE ESCALETA: importar el cleanFeed MP4 AMB MÀRGENS ──
                    // El clip s'insereix amb insertWithBounds (inPoint/outPoint amb handles)
                    // exactament com abans. A més, es col·loquen marcadors d'IN i OUT
                    // a la seqüència per indicar visualment els punts detectats per
                    // l'algoritme calcPrecisionTrimBounds (sistema de 4 tiers IN / 3 tiers OUT).
                    const isFallbackBlockMedia = cleanFeedData._isFallbackBlockMedia === true;
                    utils.log(`📡 Usant ${isFallbackBlockMedia ? 'MP4 del bloc (FALLBACK)' : 'cleanFeed MP4 (amb marges)'}: ${cleanFeedData.mediaPath}`);

                    // 4a. Importar el cleanFeed (si no està ja importat)
                    const cfPathForward = cleanFeedData.mediaPath.replace(/\\/g, "/");
                    const cfName = cfPathForward.split('/').pop();
                    const existingItems = await callJSX("FASTPASS.Project.items('')");
                    let items = [];
                    try { items = JSON.parse(existingItems || "[]"); } catch(e) { items = []; }
                    const alreadyImported = items.some(i => i.name === cfName);

                    if (!alreadyImported) {
                        utils.log(`📥 Important ${isFallbackBlockMedia ? 'MP4 del bloc' : 'cleanFeed'}: ${cfName}`);
                        await utils.importList([cfPathForward], "root");
                        await utils.delay(500);
                    } else {
                        utils.log(`✅ ${isFallbackBlockMedia ? 'MP4 del bloc' : 'cleanFeed'} ja importat: ${cfName}`);
                    }

                    // 4b. Moure el CTI a 00:00 abans d'inserir el clip (per a que el cabezal
                    //     no interfereixi amb la col·locació i el zoom posterior)
                    await callJSX("Timeline.set(0)");
                    utils.log(`🎯 CTI mogut a 00:00 abans d'inserir el clip`);

                    let clipDuration;
                    const escapedCfName = encodeURIComponent(cfName);

                    if (isFallbackBlockMedia) {
                        // ─── MODE FALLBACK: MP4 individual del bloc ───────────────────
                        // S'insereix el clip complet sense trim perquè no coneixem
                        // la duració exacta del fitxer. La duració del clip es llegeix
                        // després de la inserció. Els sweet points es calculen amb
                        // la duració real.
                        utils.log(`🎬 [FALLBACK] Col·locant MP4 del bloc complet a V1 (sense trim)`);
                        const insertRes = await callJSX(
                            `Clips.insert('${escapedCfName}', 1, 0, 'video')`
                        );
                        if (insertRes && insertRes.indexOf('ERR') !== -1) {
                            utils.log(`⚠️ Error insertant MP4 del bloc: ${insertRes}`);
                        }

                        // Llegir la duració real del clip inserit
                        const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
                        let clipEnd = 0;
                        try {
                            const clipData = JSON.parse(clipDataRaw);
                            clipEnd = clipData.end;
                            clipDuration = clipData.end - clipData.start;
                            utils.log(`📐 [FALLBACK] Clip inserit: start=0s end=${clipEnd.toFixed(2)}s durActual=${clipDuration.toFixed(2)}s`);
                        } catch(e) {
                            clipDuration = cleanFeedData.mp4Duration || 60;
                            utils.log(`⚠️ [FALLBACK] No s'ha pogut llegir duració real del clip. Usant estimació: ${clipDuration.toFixed(2)}s`);
                        }
                    } else {
                        // ─── MODE NORMAL: cleanFeed amb bounds calculats ──────────────
                        // 4c. Insertar el MP4 a V1 amb insertWithBounds (recortat amb marges + handles)
                        // Amb handles=3s, el source IN del clip és mp4ExpandedInPoint (sweet - 3s handle)
                        // + globalOffset. L'offset global (tcOffset) s'aplica al clip origen per corregir
                        // deriva d'ingesta, desplaçant el rang source del MP4 (on es llegeix el contingut
                        // dins del fitxer). El clip es col·loca sempre a start=0 al timeline.
                        const globalOffset = config.tcOffset || 0;
                        // 🎛️ [IN-OFFSET 2026-09-04] Restar clipInOffset a l'IN (media origen)
                        // del clip: el punt real d'inici del bloc està ~8-10s ABANS del que
                        // el sistema calcula, així el clip s'insereix amb més marge per
                        // davant. Només MODE NORMAL. Config: Config.get().clipInOffset.
                        const clipInOffset = config.clipInOffset || 0;
                        const mp4InPt  = (cleanFeedData.mp4ExpandedInPoint || 0) + globalOffset - clipInOffset;  // expanded (amb handle), AMB offset i ajust IN
                        const mp4OutPt = (cleanFeedData.mp4ExpandedOutPoint || 0) + globalOffset;  // expanded (amb handle), AMB offset
                        clipDuration = mp4OutPt - mp4InPt;
                        utils.log(`🎬 Col·locant cleanFeed a V1 amb bounds: IN=${mp4InPt.toFixed(2)}s OUT=${mp4OutPt.toFixed(2)}s (start=0) | duradaEsperada=${clipDuration.toFixed(2)}s`);
                        utils.log(`🔍 [LOG] cleanFeedData.mp4ExpandedInPoint (BASE, amb handle)=${(cleanFeedData.mp4ExpandedInPoint||0).toFixed(4)}s + globalOffset=${globalOffset}s = ${mp4InPt.toFixed(4)}s, mp4ExpandedOutPoint (BASE)=${(cleanFeedData.mp4ExpandedOutPoint||0).toFixed(4)}s + globalOffset=${globalOffset}s = ${mp4OutPt.toFixed(4)}s`);
                        const insertRes = await callJSX(
                            `Clips.insertWithBounds('${escapedCfName}', 1, 0, ${mp4InPt.toFixed(4)}, ${mp4OutPt.toFixed(4)}, 'video')`
                        );
                        if (insertRes && insertRes.indexOf('ERR') !== -1) {
                            utils.log(`⚠️ Error insertant cleanFeed: ${insertRes}`);
                        }
                    }

                    // 4d. Establir punts IN/OUT de la SEQÜÈNCIA als "sweet points"
                    // El clip té handleSecs de marge a cada extrem (3s per defecte).
                    // Els delimitadors de seqüència (Work Area IN/OUT) es posicionen
                    // on comença i acaba el contingut REAL del bloc, ignorant els handles.
                    // Font única de veritat: Config.get().handles → cleanFeedData.handleSecs.
                    const h = cleanFeedData.handleSecs || 0;
                    // 🎛️ [ZONA-IN 2026-09-04] Adelantar el corchete IN de la zona de treball
                    // (sweetSeqIn) restant zonaInOffset (per defecte 10s) perquè quedi més a
                    // prop de l'inici real del bloc. Només en mode normal (no fallback).
                    // Config: Config.get().zonaInOffset.
                    const zonaInAdj = (isFallbackBlockMedia) ? 0 : (config.zonaInOffset || 0);
                    const sweetSeqIn  = Math.max(0, h - zonaInAdj);
                    const sweetSeqOut = clipDuration - h;
                    utils.log(`📍 [DEBUG] IN/OUT de seqüència (sweet points): seqIN=${sweetSeqIn.toFixed(2)}s seqOUT=${sweetSeqOut.toFixed(2)}s (durada=${clipDuration.toFixed(2)}s, handleSecs=${h}s${isFallbackBlockMedia ? ', mode=fallback' : ''})`);
                    const rangeRes = await callJSX(`Timeline.range(${sweetSeqIn.toFixed(4)}, ${sweetSeqOut.toFixed(4)})`);
                    utils.log(`🔍 Timeline.range resultat=${rangeRes}`);

                    // 4e. Fer zoom a la selecció IN/OUT per a que ocupi l'ample de la finestra
                    const zoomRes = await callJSX("Timeline.zoomToSelection()");
                    utils.log(`🔍 Zoom a selecció IN/OUT: resultat=${zoomRes}`);

                    // 4f. Col·locar marcadors d'IN i OUT a la seqüència
                    // NOTA: Estos marcadores se eliminan porque placeMarkers('estructura') ya hace Markers.clear() antes de crear los suyos.
                    // Si se mantienen aquí, generan marcadores fantasma cuando no se ejecuta placeMarkers('estructura').
                    // await callJSX(`Markers.set(${mp4InPt.toFixed(4)}, 'IN - Inici bloc (detectat)', 'color=3')`);
                    // await callJSX(`Markers.set(${mp4OutPt.toFixed(4)}, 'OUT - Fi bloc (detectat)', 'color=3')`);
                    utils.log(`📍 Marcadors IN/OUT col·locats a la seqüència (DESACTIVAT: es delega a placeMarkers('estructura'))`);

                    // Verificar el resultat
                    const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
                    let clipEnd = 0;
                    try {
                        const clipData = JSON.parse(clipDataRaw);
                        const clipActualDur = clipData.end - clipData.start;
                        clipEnd = clipData.end;
                        utils.log(`📐 Clip inserit: start=${clipData.start.toFixed(2)}s end=${clipData.end.toFixed(2)}s inPoint=${clipData.inPoint.toFixed(2)}s outPoint=${clipData.outPoint.toFixed(2)}s durActual=${clipActualDur.toFixed(2)}s (AMB MÀRGENS)`);
                        utils.log(`🔍 [LOG] Comparació: duradaEsperada=${clipDuration.toFixed(4)}s vs duradaReal=${clipActualDur.toFixed(4)}s | startClip=${clipData.start.toFixed(4)}s | INseq hauria de ser ~${clipData.start.toFixed(4)}s OUTseq hauria de ser ~${clipData.end.toFixed(4)}s`);
                    } catch(e) {
                        utils.log(`📐 Clip inserit: ${clipDataRaw}`);
                    }

                    // 4g. Retallar coles sobrants de TOTS els tracks al final físic del clip MP4
                    // Això farà que l'àrea de treball s'ajusti automàticament al final del clip,
                    // i donarà més opcions per a que el zoom funcioni correctament.
                    if (clipEnd > 0) {
                        utils.log(`✂️ [TRIM-TAILS] Retallant tots els tracks a end=${clipEnd.toFixed(2)}s (final físic del MP4)`);
                        const numVideoTracks = parseInt(await callJSX("Tracks.count('video')") || "0");
                        const numAudioTracks = parseInt(await callJSX("Tracks.count('audio')") || "0");
                        const videoTracks = [];
                        for (let vt = 1; vt <= numVideoTracks; vt++) videoTracks.push(vt);
                        const audioTracks = [];
                        for (let at = 1; at <= numAudioTracks; at++) audioTracks.push(at);
                        utils.log(`✂️ [TRIM-TAILS] Tracks a processar: video=${JSON.stringify(videoTracks)}, audio=${JSON.stringify(audioTracks)}`);
                        const trimResult = await FASTPASS_UI.Logic.Clips.rippleAllOut(clipEnd, videoTracks, audioTracks, false);
                        utils.log(`✂️ [TRIM-TAILS] Resultat: ${trimResult} clips retallats/eliminats`);

                        // 4h. Reintentar zoom després de retallar les coles
                        const zoomRes2 = await callJSX("Timeline.zoomToSelection()");
                        utils.log(`🔍 Zoom després de trim tails: resultat=${zoomRes2}`);
                    } else {
                        utils.log(`⚠️ [TRIM-TAILS] No s'ha pogut determinar el clipEnd, es salta el trim`);
                    }

                } else {
                    // Si no hi ha cleanFeedData, error fatal (no fallback)
                    utils.log(`❌ No hi ha dades de cleanFeed. No es pot inserir cap clip.`);
                }
            }

            // 5. ASEGURAR CARPETES I GUARDAR (SAVE AS)
            await utils.ensureFolders(folderPath);
            const escapedPath = fullDestPath.replace(/\\/g, "/").replace(/'/g, "\\'");

            utils.log(`🏗️ Guardant projecte final: ${escapedPath}`);
            let saveRes = await callJSX(`FASTPASS.Project.saveAs('${escapedPath}')`);
            
            if (saveRes && saveRes.indexOf("ERR") !== -1) {
                await utils.delay(2000);
                saveRes = await callJSX(`FASTPASS.Project.saveAs('${escapedPath}')`);
            }

            if (saveRes && saveRes.indexOf("ERR") !== -1) throw new Error("Premiere no ha permès guardar: " + saveRes);

            // 6. BLOQUEIG (LOCK)
            await this.lock(fullDestPath);
            
            return { success: true, path: fullDestPath };
        },


        /**
         * ingestAssets: Centralitza l'escaneig i ingesta de materials (Wotts, MP4, SRT, Portada).
         */
        ingestAssets: async function (ctx, wottData, media, portadas, opts) { // <--- Nombre unificado
            utils.log("🎞️ [SYNC] Iniciant ingesta segmentada...");
            // ── GUARDA "CAPA JA PRESENT" (només en ACTUALITZAR/LOAD/GO) ────────
            // Si el projecte ja té el clip de vídeo de treball a V1 i/o subtítols
            // montats, no cal importar MP4/SRT "equivalents" encara que el nom no
            // coincideixi (els fitxers d'emergència poden tenir noms diferents).
            const skipMedia = !!(opts && opts.skipMediaIfLayerPresent);
            let capaVideoPresent = false;
            let capaSrtPresent = false;
            if (skipMedia) {
                try { capaVideoPresent = (await callJSX("hasClips(1, 'video')")) === "true"; } catch (eCv) { }
                try { capaSrtPresent = (await callJSX("hasClips(1, 'subtitle')")) === "true"; } catch (eCs) { }
                if (capaVideoPresent || capaSrtPresent) {
                    utils.log(`[INGEST] Capa ja present al projecte (vídeo=${capaVideoPresent}, subtítols=${capaSrtPresent}). No es reimportaran MP4/SRT equivalents.`, 'INFO');
                }
            }

            // ── FILTRE FINAL DE SEGURETAT (2026-09-07) ─────────────────────────
            // Mecanisme ÚNIC d'ingesta: passi pel camí que passi (NEW, UPDATE, GO,
            // LOAD), aquí es torna a datar cada rètol contra ctx.dateDir abans
            // d'importar-lo. Si un fitxer no és del dia de treball (o no es pot
            // datar) es DESCARTÀ. Evita wotts/portades d'altres dies.
            const ScanAPI = (window.FASTPASS_UI && window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.Scan) || null;
            if (ScanAPI && typeof ScanAPI.filterByWorkDate === 'function' && ctx && ctx.dateDir) {
                try {
                    const chyFolder = ctx.config && ctx.config.rutas && ctx.config.rutas.chyrons;
                    if (chyFolder) {
                        const allChy = await utils.readFolder(chyFolder);
                        const statsByName = {};
                        (allChy || []).forEach(function (fc) { statsByName[fc.name] = fc; });

                        if (wottData && wottData.list && wottData.list.length > 0) {
                            const withStats = wottData.list.map(function (w) {
                                const st = statsByName[w.name] || {};
                                return { name: w.name, path: w.path, created: st.created, mtime: st.mtime };
                            });
                            const resFinal = ScanAPI.filterByWorkDate(withStats, ctx.dateDir);
                            utils.log('[INGEST] Filtre final wotts per data ' + ctx.dateDir + ': ' + withStats.length + ' -> ' + resFinal.keep.length +
                                (resFinal.dropped.length ? ' (descartats ' + resFinal.dropped.length + " d'altres dies: " + resFinal.dropped.slice(0, 3).map(function(x){ return x.name; }).join(', ') + '...)' : '') +
                                (resFinal.noDate.length ? ' (NO datables: ' + resFinal.noDate.slice(0, 3).map(function(x){ return x.name; }).join(', ') + '...)' : ''), 'INFO');
                            wottData.list = resFinal.keep;
                        }
                        if (portadas && portadas.length > 0) {
                            const withStatsP = portadas.map(function (p) {
                                const st = statsByName[p.name] || {};
                                return { name: p.name, path: p.path, created: st.created, mtime: st.mtime };
                            });
                            const resP = ScanAPI.filterByWorkDate(withStatsP, ctx.dateDir);
                            utils.log('[INGEST] Filtre final portades per data ' + ctx.dateDir + ': ' + withStatsP.length + ' -> ' + resP.keep.length +
                                (resP.dropped.length ? ' (descartades ' + resP.dropped.length + " d'altres dies)" : '') +
                                (resP.noDate.length ? ' (NO datables: ' + resP.noDate.length + ')' : ''), 'INFO');
                            portadas.length = 0;
                            resP.keep.forEach(function (p) { portadas.push(p); });
                        }
                    }
                } catch (eFiltre) {
                    utils.log('⚠️ [INGEST] Error al filtre final de seguretat: ' + eFiltre.message, 'WARN');
                }
            }

            // Obtener archivos ya presentes en el proyecto
            const existing = await this._getExistingAssets();
            utils.log(`🔍 Assets existentes: ${existing.wotts.length} wotts, ${existing.media.length} media, ${existing.portadas.length} portadas`);

            // A. RÈTOLS (Wotts) -> Bin CHY
            if (wottData && wottData.list && wottData.list.length > 0) {
                // ── Detecció robusta de duplicats ──────────────────────────────────
                // Un wott "ja existeix" si el seu ID numèric (darrera seqüència de 6+
                // dígits del nom) ja és al bin CHY, o si el nom base coincideix.
                // Evita reimportar quan Premiere ja el té (fins i tot amb sufix " 1"
                // que afegeix en importar dos cops el mateix fitxer).
                const idDe = function (n) {
                    const m = String(n).match(/(\d{6,})/g);
                    return m ? m[m.length - 1] : null;
                };
                const cleanBase = function (n) {
                    try { n = decodeURIComponent(n); } catch (e) { }
                    return String(n).replace(/\.(mov|mp4|png|srt)$/i, '').replace(/\s+\d+$/i, '').trim().toLowerCase();
                };
                const jaExisteix = function (w) {
                    const wName = (w && w.name) ? w.name : String(w);
                    const wId = idDe(wName);
                    return (existing.wotts || []).some(function (ew) {
                        const ewName = (ew && ew.name) ? ew.name : String(ew);
                        if (wId) { const eId = idDe(ewName); if (eId && eId === wId) return true; }
                        return cleanBase(ewName) === cleanBase(wName);
                    });
                };

                // Filtrar wotts que aún no están en el proyecto
                const newWotts = wottData.list.filter(w => !jaExisteix(w));
                if (newWotts.length === 0) {
                    utils.log("✅ Todos los wotts ya están en el proyecto. Se omite importación.");
                } else {
                    utils.log(`📥 Ingestant ${newWotts.length} rètols nuevos de ${wottData.list.length} detectados...`);

                    // 1. Primer creem el Bin (Això assegura que el destí existeix)
                    await callJSX(`FASTPASS.Project.bin('${encodeURIComponent('CHY')}')`);
                    
                    // 2. Importem la llista al Root
                    const safeWotts = newWotts.map(f => f.path.replace(/\\/g, "/"));
                    await utils.importList(safeWotts, "root");
                    // L'índex de durades del bin CHY ha canviat: invalidem la caché
                    // perquè el proper Tema‑Titol llegeixi els nous wotts.
                    this._wottIdxCache = null;
                    
                    // 3. Parem un segon per donar temps a Premiere a indexar (Opcional però segur)
                    await utils.delay(200);
                
                    // 4. Movem TOTS els fitxers de la llista del Scanner
                    for (const wott of newWotts) {
                        const escapedName = encodeURIComponent(wott.name);
                        const safeName = escapedName.replace(/'/g, "\\'");

                        // Intento 1: per nom exacte (pot fallar si el root encara indexa)
                        let moveRes = await callJSX(`FASTPASS.Project.move('${safeName}', 'CHY')`);
                        if (moveRes !== "OK") {
                            // Intento 2: extreiem l'ID (ex: 336346) i movem per ID
                            const idMatch = wott.name.match(/[0-9]{6}/);
                            if (idMatch) {
                                const wottID = idMatch[0];
                                const moveByRes = await callJSX(`FASTPASS.Project.moveByID('${wottID}', 'CHY')`);
                                if (moveByRes === "OK") {
                                    utils.log(`📦 [INGEST] Rètol mogut a CHY via ID: ${wott.name.substring(0, 60)}...`, "INFO");
                                } else {
                                    utils.log(`❌ [INGEST] No s'ha pogut moure rètol a CHY (ni per nom ni per ID): ${wott.name}`, "ERROR");
                                }
                            } else {
                                utils.log(`❌ [INGEST] No s'ha pogut moure rètol a CHY (sense ID al nom): ${wott.name}`, "ERROR");
                            }
                        }
                    }
                }
            }
        
            // B. MEDIA ASSETS (MP4 / SRT) -> Root
            const mediaList = [];

            // (TO DO UPDATE #1) NO reimportar el MP4 si ja existeix un clip al projecte.
            // A més, en actualitzar, si la CAPA de vídeo ja és present a V1 no es
            // reimporta cap MP4 equivalent encara que el nom no coincideixi.
            // BUG (2026-09-16): aquí hi havia un `if (... !mp4Exists ...)` ABANS de la
            // declaració de `mp4Exists` (let, més avall) → "Cannot access 'mp4Exists'
            // before initialization" i el flotge de CREAR/ACTUALITZAR s'aturava sense
            // importar el MP4. La comprovació viu ara una sola vegada, després de calcular-lo.
            let mp4Exists = false;
            if (media?.mp4?.path) {
                const mp4Enc = encodeURIComponent(media.mp4.name);
                const mp4Found = await callJSX(`FASTPASS.Project.find('${mp4Enc}')`);
                mp4Exists = !!mp4Found && mp4Found !== 'null' && mp4Found.indexOf('null') !== 0;
                if (!mp4Exists) {
                    const lastDot = media.mp4.name.lastIndexOf('.');
                    if (lastDot > 0) {
                        const mp4FoundNoExt = await callJSX(`FASTPASS.Project.find('${encodeURIComponent(media.mp4.name.substring(0, lastDot))}')`);
                        mp4Exists = !!mp4FoundNoExt && mp4FoundNoExt !== 'null' && mp4FoundNoExt.indexOf('null') !== 0;
                    }
                }
            }
            if (media?.mp4?.path && !mp4Exists && !(skipMedia && capaVideoPresent)) {
                mediaList.push(media.mp4.path.replace(/\\/g, "/"));
            }

            // SRT: es copia SEMPRE al directori del projecte (font única local).
            // Així CARREGAR troba exactament un .srt al costat del .prproj,
            // sense dependre del bin de Premiere (que pot tenir .srt residuals).
            let srtImportPath = null;
            // En actualitzar, si la capa de subtítols ja és present al projecte no es
            // copia ni s'importa cap SRT equivalent (el nom pot no coincidir).
            if (skipMedia && capaSrtPresent && media?.srt?.path) {
                utils.log("🟡 [INGEST] Ja hi ha subtítols montats al projecte. No s'importa el SRT equivalent.", 'INFO');
            }
            if (media?.srt?.path && !(skipMedia && capaSrtPresent)) {
                const destFolder = (ctx.config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir)
                    .replace(/\\/g, "/").replace(/\/+$/, "");
                const localSrt = destFolder + "/" + media.srt.name;
                const copyResult = await this._copySrtToProjectFolder(media.srt.path, localSrt);
                if (copyResult === "OK") {
                    srtImportPath = localSrt;
                    utils.log(`📥 SRT copiat al directori del projecte: ${localSrt}`);

                    // ── PROJECTE NOU: Netejar marcadors persistits d'una sessió anterior ──
                    // El SrtEditor restaura els marcadors des de C:/temp/fastpass_srt_markers_<nom>.json
                    // quan el nom del SRT coincideix. En un projecte nou volem començar de zero.
                    try {
                        const srtBase = media.srt.name.replace(/\.srt$/i, '');
                        const safeName = srtBase.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const markersFile = "C:/temp/fastpass_srt_markers_" + safeName + ".json";
                        const rmRes = await callJSX(`IO.remove('${markersFile.replace(/\\/g, '/')}')`);
                        if (rmRes !== 'NOT_EXISTS') {
                            utils.log(`🧹 Marcadors SRT anteriors eliminats (${rmRes}): ${markersFile}`);
                        }
                    } catch (eClean) {
                        utils.log(`⚠️ No s'han pogut netejar marcadors SRT: ${eClean.message}`, "WARN");
                    }
                } else {
                    srtImportPath = media.srt.path.replace(/\\/g, "/");
                    utils.log(`⚠️ No s'ha pogut copiar el SRT al projecte (${copyResult}). S'importarà des del NAS.`);
                }
                if (!existing.media.includes(media.srt.name)) {
                    mediaList.push(srtImportPath);
                }
            }

            if (mediaList.length > 0) {
                utils.log(`📥 Ingestant assets media al ROOT...`);
                await utils.importList(mediaList, "root");
            } else if (media?.mp4 || media?.srt) {
                utils.log("✅ Los assets de media ya están en el proyecto. Se omite importación.");
            }
        
            // C. PORTADES (Múltiples PNGs) -> Bin PORTADES
            if (portadas && portadas.length > 0) {
                // ── Detecció robusta de duplicats (mateixa lògica que els wotts) ──
                // Es compara pel darrer ID numèric de 6+ dígits del nom o pel nom base.
                const idDeP = function (n) {
                    const m = String(n).match(/(\d{6,})/g);
                    return m ? m[m.length - 1] : null;
                };
                const cleanNameP = function (n) {
                    try { n = decodeURIComponent(n); } catch (e) { }
                    return String(n).replace(/\.(png|jpg|jpeg)$/i, '').replace(/\s+\d+$/i, '').trim().toLowerCase();
                };
                const newPortadas = portadas.filter(p => !existing.portadas.some(function (ep) {
                    const epId = idDeP(ep);
                    const pId = idDeP(p.name);
                    if (pId && epId && epId === pId) return true;
                    return cleanNameP(ep) === cleanNameP(p.name);
                }));
                if (newPortadas.length === 0) {
                    utils.log("✅ Todas las portadas ya están en el proyecto. Se omite importación.");
                } else {
                    utils.log(`🖼️ Ingestant ${newPortadas.length} portades nuevas de ${portadas.length} detectades...`);
                    
                    // 1. Crear el Bin PORTADES
                    await callJSX(`FASTPASS.Project.bin('${encodeURIComponent('PORTADES')}')`);
            
                    // 2. Importar todas al Root primero
                    const safePortadas = newPortadas.map(p => p.path.replace(/\\/g, "/"));
                    await utils.importList(safePortadas, "root");
            
                    // 3. Moverlas una a una al Bin PORTADES (amb fallback per ID,
                    //    com es fa amb els wotts).
                    await utils.delay(200);
                    for (const p of newPortadas) {
                        const escapedName = encodeURIComponent(p.name);
                        const safeName = escapedName.replace(/'/g, "\\'");
                        const safeBinName = encodeURIComponent('PORTADES').replace(/'/g, "\\'");
                        let moveRes = await callJSX(`FASTPASS.Project.move('${safeName}', '${safeBinName}')`);
                        if (moveRes !== "OK") {
                            const idMatch = p.name.match(/[0-9]{6}/);
                            if (idMatch) {
                                const portId = idMatch[0];
                                const moveByRes = await callJSX(`FASTPASS.Project.moveByID('${portId}', '${safeBinName}')`);
                                if (moveByRes === "OK") {
                                    utils.log(`🖼️ [PORTADES] Portada moguda al bin via ID: ${p.name.substring(0, 70)}...`, "INFO");
                                } else {
                                    utils.log(`❌ [PORTADES] No s'ha pogut moure la portada al bin (ni per nom ni per ID): ${p.name}`, "ERROR");
                                }
                            } else {
                                utils.log(`❌ [PORTADES] No s'ha pogut moure la portada al bin (sense ID al nom): ${p.name}`, "ERROR");
                            }
                        }
                    }
                }
            }
        },

        /**
         * _getExistingAssets: Obtiene los nombres de archivos ya presentes en los bins del proyecto.
         * Retorna un objeto { wotts: [...], media: [...], portadas: [...] }.
         */
        _getExistingAssets: async function() {
            try {
                // Obtener items del bin CHY
                const chyItemsRaw = await callJSX("FASTPASS.Project.items('CHY')");
                const chyItems = JSON.parse(chyItemsRaw || "[]");
                const wotts = chyItems.map(item => item.name);

                // Obtener items del bin PORTADES
                const portadasItemsRaw = await callJSX("FASTPASS.Project.items('PORTADES')");
                const portadasItems = JSON.parse(portadasItemsRaw || "[]");
                const portadas = portadasItems.map(item => item.name);

                // Media (MP4/SRT) están en root; obtener todos los items del root
                const rootItemsRaw = await callJSX("FASTPASS.Project.items('')");
                const rootItems = JSON.parse(rootItemsRaw || "[]");
                const media = rootItems.map(item => item.name);

                return { wotts, media, portadas };
            } catch (e) {
                utils.log("⚠️ Error obteniendo assets existentes: " + e.message, "WARN");
                return { wotts: [], media: [], portadas: [] };
            }
        },

        /**
         * _copySrtToProjectFolder: Copia el .srt al directori del projecte via JSX (File.copy).
         * @returns {Promise<string>} "OK" si s'ha copiat, o "ERR:..." en cas contrari.
         */
        _copySrtToProjectFolder: async function (src, dst) {
            try {
                const srcEsc = String(src).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const dstEsc = String(dst).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const jsx = "(function(){try{var s=new File('" + srcEsc + "');var d=new File('" + dstEsc + "');if(!s.exists)return'ERR_SRC_NOT_FOUND';if(d.exists){try{d.remove()}catch(e){}}var ok=s.copy(d);return ok?'OK':'ERR_COPY'}catch(e){return'ERR:'+e.message}})()";
                return await callJSX(jsx);
            } catch (e) {
                return "ERR:" + e.message;
            }
        },

        /**
         * lock: Crea el fitxer .lock per marcar la propietat del projecte.
         */
        lock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                const user = window.FASTPASS_UI.Config.get().autor;
                const safeLockPath = lockPath.replace(/\\/g, "/").replace(/'/g, "\\'");
                const safeUser = String(user).replace(/'/g, "\\'");
                utils.log(`🔒 Escrivint bloqueig per a ${user}...`);
                const lockScript = `IO.writeTxt('${safeLockPath}', '${safeUser}')`;
                utils.log(`🔍 JSX lock script: ${lockScript}`);
                await callJSX(lockScript);
                utils.log("✅ Lock escrit correctament.");
            } catch (e) {
                utils.log("Error creant .lock: " + e.message, "WARN");
            }
        },

        /**
         * getDuration: Obté la durada en segons d'un element del projecte via JSX.
         * @param {string} itemName - Nom de l'element (amb extensió)
         * @returns {Promise<number>} Durada en segons, 0 si no es troba l'element
         */
        getDuration: async function(itemName) {
            const safeName = encodeURIComponent(itemName).replace(/'/g, "\\'");
            const raw = await callJSX(`FASTPASS.Project.itemDuration('${safeName}')`);
            const secs = parseFloat(raw);
            return isNaN(secs) ? 0 : secs;
        },

        /**
         * _normWottName: Clau de comparació ROBUSTA per a noms de wott.
         * Treu URL-encoding, extensió, sufix de duplicat (" 1") i col·lapsa
         * espais/guions baixos, en minúscules. Així el nom del chyron
         * (Parse.files: nom de fitxer) casa amb el nom de l'ítem del bin CHY
         * encara que Premiere hagi afegit sufix o canviï l'extensió.
         * @param {string} n
         * @returns {string}
         */
        _normWottName: function (n) {
            var s = String(n === null || n === undefined ? '' : n);
            try { s = decodeURIComponent(s); } catch (e) { }
            return s.replace(/\s+\d+$/i, '')   // sufix de duplicat de Premiere ("clip.mov 1")
                .replace(/\.(mov|mp4|png|srt|jpg|jpeg)$/i, '')
                .replace(/\.\d{6,}$/, '')       // sufix de fitxer del sistema de ròtols (.00590810)
                .replace(/[_\s]+/g, ' ')
                .replace(/^\s+|\s+$/g, '')
                .toLowerCase();
        },

        /**
         * _idsDeWott: TOTS els IDs numèrics llargs (6+ dígits) del nom.
         * El nom del wott en porta dos (id d'escaleta 590746 i id de fitxer
         * 00590810); indexar-los tots fa que el casat chyron ↔ bin surti per
         * qualsevol dels dos encara que un dels noms porti sufix.
         * @param {string} n
         * @returns {Array<string>}
         */
        _idsDeWott: function (n) {
            var m = String(n === null || n === undefined ? '' : n).match(/\d{6,}/g);
            return m || [];
        },

        /**
         * getWottIndex: Índex complet dels wotts del bin CHY.
         *   { byName, byNorm, byId, items, bytesPerSec }
         * - byName:  nom exacte → segons (font del DOM)
         * - byNorm:  nom normalitzat → segons
         * - byId:    cada ID llarg → segons
         * - items:   [{name, dur, size, id, mediaPath}]
         * - bytesPerSec: bitrate calibrat (mediana size/dur) per estimar durades
         *   quan el DOM no les dóna (projectItem.duration pot ser un TickTime).
         * @param {boolean} [forceReload]
         * @returns {Promise<Object>}
         */
        getWottIndex: async function (forceReload) {
            const st = window.FASTPASS_UI.State;
            const key = (st && st.lastOpenedProjectName) || '';
            if (!forceReload && this._wottIdxCache && this._wottIdxCache.key === key) {
                return this._wottIdxCache.index;
            }
            const byName = {}, byNorm = {}, byId = {}, items = [];
            let bytesPerSec = 0;
            try {
                const raw = await callJSX("FASTPASS.Project.items('CHY')");
                const list = JSON.parse(raw || "[]") || [];
                const ratios = [];
                for (const it of (list || [])) {
                    const name = String(it.name || "").trim();
                    if (!name) continue;
                    const dur = (typeof it.duration === 'number' && isFinite(it.duration) && it.duration > 0) ? it.duration : 0;
                    const size = (typeof it.size === 'number' && isFinite(it.size)) ? it.size : 0;
                    const norm = this._normWottName(name);
                    const ids = this._idsDeWott(name);
                    const rec = { name: name, dur: dur, size: size, id: (ids.length ? ids[0] : ''), mediaPath: it.mediaPath || '' };
                    items.push(rec);
                    if (byName[name] === undefined) byName[name] = dur;
                    if (norm && byNorm[norm] === undefined) byNorm[norm] = dur;
                    for (const id of ids) { if (byId[id] === undefined) byId[id] = dur; }
                    if (dur > 0.1 && size > 0) ratios.push(size / dur);
                }
                if (ratios.length > 0) {
                    ratios.sort((a, b) => a - b);
                    bytesPerSec = ratios[Math.floor(ratios.length / 2)];   // mediana
                }
                const ambDur = items.filter(i => i.dur > 0).length;
                utils.log(`⏱️ [Tema-Titol] Bin CHY: ${items.length} fitxers, ${ambDur} amb durada del DOM` +
                    (bytesPerSec > 0 ? ` · bitrate calibrat ~${(bytesPerSec / 1048576).toFixed(1)} MB/s` : ' (sense bitrate)'), 'DEBUG');
                if (items.length > 0 && ambDur === 0) {
                    utils.log("⚠️ [Tema-Titol] El DOM no ha donat cap durada (projectItem.duration no és numèric): s'estimarà per mida de fitxer.", 'WARN');
                }
            } catch (e) {
                utils.log("⚠️ [Tema-Titol] No s'han pogut llegir les durades del bin CHY: " + e.message, 'WARN');
            }
            const index = { key: key, byName: byName, byNorm: byNorm, byId: byId, items: items, bytesPerSec: bytesPerSec };
            this._wottIdxCache = { key: key, index: index };
            return index;
        },

        /**
         * getWottDurations: Mapa nom→durada (segons) dels wotts del bin CHY.
         * Es manté per compatibilitat; internament usa getWottIndex().
         * @param {boolean} [forceReload]
         * @returns {Promise<Object>}
         */
        getWottDurations: async function (forceReload) {
            const idx = await this.getWottIndex(forceReload);
            return idx.byName;
        },

        /**
         * _wottEntryFor: Troba l'entrada del bin que correspon a un chyron,
         * per nom exacte → nom normalitzat → qualsevol dels seus IDs.
         * @param {Object} index
         * @param {string} name
         * @returns {Object|null}
         */
        _wottEntryFor: function (index, name) {
            if (!index || !index.items) return null;
            const norm = this._normWottName(name);
            const ids = this._idsDeWott(name);
            for (const it of index.items) { if (it.name === name) return it; }
            for (const it of index.items) { if (norm && this._normWottName(it.name) === norm) return it; }
            for (const it of index.items) {
                for (const id of ids) { if (this._idsDeWott(it.name).indexOf(id) !== -1) return it; }
            }
            return null;
        },

        /**
         * _resolveWottDur: Durada fiable (segons) d'un chyron.
         * Ordre: durada del DOM (nom → norm → ID) → estimació per mida amb el
         * bitrate calibrat del propi bin → default ProRes (~43,5 MB/s) marcat
         * com a estimació.
         * @param {Object} index - getWottIndex()
         * @param {Object} chyron - {name, tc, rol, path}
         * @returns {{dur:number, src:string, size:number}}
         */
        _resolveWottDur: function (index, chyron) {
            const name = String((chyron && chyron.name) || '');
            if (index) {
                // 1) Mapes directes (inclou la compatibilitat amb el mapa pla nom → segons)
                if (index.byName && typeof index.byName[name] === 'number' && index.byName[name] > 0) {
                    return { dur: index.byName[name], src: 'bin', size: 0 };
                }
                const norm = this._normWottName(name);
                if (index.byNorm && norm && typeof index.byNorm[norm] === 'number' && index.byNorm[norm] > 0) {
                    return { dur: index.byNorm[norm], src: 'bin~norm', size: 0 };
                }
                for (const id of this._idsDeWott(name)) {
                    if (index.byId && typeof index.byId[id] === 'number' && index.byId[id] > 0) {
                        return { dur: index.byId[id], src: 'bin~id', size: 0 };
                    }
                }
            }
            // 2) Entrada del bin (per estimar la durada amb la mida del fitxer)
            const entry = this._wottEntryFor(index, name);
            if (entry && entry.dur > 0) return { dur: entry.dur, src: 'bin', size: entry.size };
            const size = entry ? (entry.size || 0) : 0;
            if (size > 0) {
                let bps = (index && index.bytesPerSec) ? index.bytesPerSec : 0;
                let src = 'mida';
                if (!(bps > 0)) { bps = 43500000; src = 'mida~est'; }   // ~43,5 MB/s (ProRes 422 HQ 1080x1920)
                return { dur: size / bps, src: src, size: size };
            }
            return { dur: 0, src: 'cap', size: 0 };
        },

        /**
         * normItemId: Normalitza un id d'ítem per comparar wott ↔ marcador.
         * Els noms dels wotts poden portar padding extra ('011i') i el marcador no
         * ('11i - INTRO'); també canvien les majúscules ('01Lead' vs '01lead').
         * @param {string} id
         * @returns {string}
         */
        normItemId: function (id) {
            return String(id === null || id === undefined ? '' : id)
                .trim().toUpperCase().replace(/^0+(?=\d)/, '');
        },

        /**
         * _wottIdNum: ID numèric intern del wott (part 6 del nom, ex: 589951).
         * Serveix per quedar-se amb la versió MÉS RECENT quan hi ha duplicats.
         * @param {string} wottName
         * @returns {number}
         */
        _wottIdNum: function (wottName) {
            const parts = String(wottName || '').split('_');
            let n = parseInt(parts[6], 10);
            if (isNaN(n) || n <= 0) {
                const ids = this._idsDeWott(wottName);   // primer ID llarg = id d'escaleta
                n = ids.length ? parseInt(ids[0], 10) : 0;
            }
            return isNaN(n) ? 0 : n;
        },

        /**
         * pickTemaTitols: Selecciona els Tema‑Titol VÀLIDS del bloc.
         *   1. Només Tema‑Titol amb durada de clip > minSec: els "petits" (~1 s)
         *      NO són un pla B (tenen altres usos).
         *   2. Referència: un per (ítem + tc). Si n'hi ha diversos (versions
         *      successives del mateix moment), es queda el d'ID més alt (recent).
         *   3. Ordre: el de State.structure (ítem) i, dins de l'ítem, pel tc.
         * @param {Array} structure - State.structure
         * @param {Object} durations - mapa nom→segons
         * @param {number} minSec
         * @returns {Array<{item:string, name:string, tc:string, dur:number, idNum:number}>}
         */
        pickTemaTitols: function (structure, durations, minSec) {
            const found = [];
            const index = {};
            const list = structure || [];
            // Compatibilitat: també accepta un mapa pla (nom → segons).
            const idx = (durations && durations.byName)
                ? durations
                : { byName: durations || {}, byNorm: {}, byId: {}, items: [], bytesPerSec: 0 };
            for (let ei = 0; ei < list.length; ei++) {
                const entry = list[ei];
                if (!entry || !entry.chyrons) continue;
                for (let ci = 0; ci < entry.chyrons.length; ci++) {
                    const c = entry.chyrons[ci];
                    const rol = String(c.rol || '').toUpperCase();
                    const isTT = (rol === 'TEMA-TITOL') || (String(c.name || '').toUpperCase().indexOf('TEMA-TITOL') !== -1);
                    if (!isTT) continue;
                    const res = this._resolveWottDur(idx, c);
                    if (!(res.dur > minSec)) continue;
                    const rec = {
                        item: String(entry.id || ''),
                        name: c.name,
                        path: c.path || '',
                        tc: String(c.tc || '000000'),
                        dur: res.dur,
                        durSrc: res.src,
                        size: res.size,
                        idNum: this._wottIdNum(c.name),
                        _ei: ei
                    };
                    const key = rec.item + '@' + rec.tc;
                    if (index[key] !== undefined) {
                        if (rec.idNum > found[index[key]].idNum) found[index[key]] = rec;
                        continue;
                    }
                    index[key] = found.length;
                    found.push(rec);
                }
            }
            found.sort(function (a, b) {
                if (a._ei !== b._ei) return a._ei - b._ei;
                return String(a.tc).localeCompare(String(b.tc));
            });
            return found;
        },

        /**
         * close: Tanca el projecte i elimina el lock.
         */
        close: async function () {
            try {
                utils.log("🔒 Tancant projecte i eliminant lock...", "INFO");
                // 1. Obtener ruta del proyecto activo
                const projectPath = await callJSX("FASTPASS.Project.path()");
                if (!projectPath) {
                    utils.log("⚠️ No hi ha projecte obert.", "WARN");
                    return;
                }
                utils.log(`🔍 Ruta del projecte: ${projectPath}`, "INFO");
                
                // 2. Borrar archivo .lock si existe
                const lockPath = projectPath + ".lock";
                const safeLockPath = lockPath.replace(/\\/g, "/").replace(/'/g, "\\'");
                const deleteScript = `IO.remove('${safeLockPath}')`;
                utils.log(`🗑️ Eliminant lock: ${deleteScript}`, "INFO");
                const deleteResult = await callJSX(deleteScript);
                if (deleteResult !== "OK") {
                    utils.log("⚠️ No s'ha pogut eliminar el lock (potser no existeix). Resultat: " + deleteResult, "INFO");
                } else {
                    utils.log("✅ Lock eliminat.", "INFO");
                }
                
                // 3. Guardar y cerrar proyecto via JSX
                const closeResult = await callJSX("FASTPASS.Project.close()");
                utils.log(`🔍 Resultat de tancament: ${closeResult}`, "INFO");
                
                if (closeResult !== "OK") {
                    throw new Error("Error al tancar el projecte: " + closeResult);
                }
                
                utils.log("✅ Projecte tancat correctament.", "INFO");
                // Limpiar último proyecto abierto
                if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                    window.FASTPASS_UI.State.lastOpenedProjectName = "";
                }
                // 4. Actualizar contexto
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            } catch (e) {
                utils.log("💥 Error en tancar projecte: " + e.message, "ERROR");
            }
        }
    };

    // Alias global literal
    window.Project = FASTPASS_UI.Logic.Project;

    window.FASTPASS_UI = FASTPASS_UI;
})();
