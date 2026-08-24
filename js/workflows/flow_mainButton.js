/**
 * ============================================================================
 * WORKFLOW: MAIN BUTTON - v2.6.0 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const log = (...args) => getUtils().log(...args);
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.MainButton = {

        runMainAction: async function (action, data) {
            getUtils().clearLogFile();
            log(`⏯️ Iniciant workflow: [${action}]`);
            log(`🔧 [DIAG] FASTEPASS v2.6.0+EXTRACT | FlowMainButton carregat | Versió de codi: EXTRACT_2026-07-27`);
            log(`🔧 [DIAG] window.FASTPASS_UI.Logic.FFmpeg existeix? ${!!(window.FASTPASS_UI && window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.FFmpeg)}`);
            log(`🔧 [DIAG] FFmpeg.extractClip existeix? ${!!(window.FASTPASS_UI && window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.FFmpeg && typeof window.FASTPASS_UI.Logic.FFmpeg.extractClip === 'function')}`);
            getUtils().updateUIState('BUSY');

            try {
                switch (action) {
                    case 'NEW': await this._runNew(); break;
                    case 'UPDATE': await this._runUpdate(); break;
                    case 'LOAD': await this._runLoad(data); break;
                    case 'GO': await this._runGo(data); break;
                }
                getUtils().status('Procés completat!', 'exito');
            } catch (e) {
                getUtils().handleError(e, "MainAction");
            } finally {
                getUtils().updateUIState('READY');
            }
        },

        _runNew: async function () {
            try {
                const ctx = await this._setupContext();

                // ─── D7.1: Resoldre dateDir des de la data d'emissió de l'escaleta ──
                // La data d'emissió del bloc és la FONT ÚNICA de dateDir per a tots
                // els artefactes del projecte (directoris, manifests, .prproj, anàlisi).
                // S'extreu del nom del fitxer JSON d'escaleta abans de qualsevol save
                // per garantir coherència entre tots els artefactes persistits.
                try {
                    const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                    if (reader) {
                        // REGLA D'OR: NUNCA canviar de dia. El datePrefix restringeix
                        // la cerca al dia actual (o al que ja tingui ctx.dateDir).
                        // El fallback seqüencial V1→V5 dins de findLatest garanteix
                        // que si V1 no existeix, s'usi V2 del MATEIX dia (no d'un altre).
                        var datePrefixD71 = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                        var earlyMeta = await reader.findLatest(ctx.progData.archivo, ctx.bloque, datePrefixD71);
                        // Fallback a ahir si avui no hi ha JSON (finestra 22h)
                        if (!earlyMeta && datePrefixD71) {
                            var yesterday = new Date();
                            yesterday.setDate(yesterday.getDate() - 1);
                            var dd2 = ('0' + yesterday.getDate()).slice(-2);
                            var mm2 = ('0' + (yesterday.getMonth() + 1)).slice(-2);
                            var datePrefixYesterday = '' + yesterday.getFullYear() + mm2 + dd2;
                            earlyMeta = await reader.findLatest(ctx.progData.archivo, ctx.bloque, datePrefixYesterday);
                            if (earlyMeta) {
                                log('📅 [dateDir] Cap JSON d\'avui. Intentant ahir (' + datePrefixYesterday + ')...');
                            }
                        }
                        if (earlyMeta && earlyMeta.filename) {
                            const emissionDate = getUtils().extractDateFromEscaletaFilename(earlyMeta.filename);
                            if (emissionDate && getUtils().isDateDirInTemporalWindow(emissionDate)) {
                                const oldDate = ctx.dateDir;
                                ctx.dateDir = emissionDate;
                                if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                                    window.FASTPASS_UI.State.dateDir = emissionDate;
                                }
                                log(`📅 [dateDir] Data d'emissió del bloc: ${emissionDate} (corregida des de ${oldDate} del sistema)`);
                            } else {
                                log(`⚠️ [dateDir] No s'ha pogut extreure data del fitxer: ${earlyMeta.filename}. Usant data del sistema: ${ctx.dateDir}`);
                            }
                        } else {
                            log(`⚠️ [dateDir] Cap escaleta trobada per a ${ctx.progData.archivo}. Usant data del sistema: ${ctx.dateDir}`);
                        }
                    }
                } catch (eDate) {
                    log(`⚠️ [dateDir] Error determinant data d'emissió: ${eDate.message}. Usant data del sistema: ${ctx.dateDir}`);
                }

                // ─── Extreure el TEMA del primer ítem estructural del bloc ──
                // Mateixa lògica que l'extracció de tema dels chyrons:
                // primer ítem amb teVideo=true o isItemEstructural=true el
                // títol del qual no sigui una paraula reservada.
                var sanitizedTheme = null;
                var jsonData = null;
                var jsonMeta = null;
                var RESERVED_THEMES = [
                    'INTR', 'LÍNIA', 'CHYRON', 'GF', 'PG', 'TD', 'TE',
                    'P2', 'P5', 'P7', 'LEAD', 'BD', 'BON DIA', 'CHYRONS',
                    'GUIO', 'COL.LECCIO', 'OFF', 'CURT', 'INTRO', 'CARETA',
                    'DIFERIT', 'INSERT', 'CONN', 'CONNEXIO', 'IPD', 'DONA PAS', 'MOLINET'
                ];
                try {
                    const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                    if (reader) {
                        var datePrefixJson = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                        // Usar findLatestValid per evitar JSONs d'error del servidor
                        // (ex: TNC V3 06/07 sense cleanFeed/escaleta)
                        var validResult = await reader.findLatestValid(ctx.progData.archivo, ctx.bloque, datePrefixJson);
                        if (validResult && validResult.valid) {
                            jsonMeta = { path: validResult.path, filename: validResult.filename };
                            jsonData = validResult.data || await reader.load(validResult.path);
                        } else {
                            // Fallback: findLatest tradicional si findLatestValid falla
                            jsonMeta = await reader.findLatest(ctx.progData.archivo, ctx.bloque, datePrefixJson);
                            if (jsonMeta) {
                                jsonData = await reader.load(jsonMeta.path);
                            }
                        }
                        if (jsonMeta && jsonData) {
                            if (jsonData) {
                                var lines = reader.getLinesForBlock(jsonData, ctx.bloque);
                                lines.sort(function (a, b) {
                                    var ta = reader.tcToSeconds(a.horaEntradaOnAir || a.horaEntradaPrevista || '00:00:00');
                                    var tb = reader.tcToSeconds(b.horaEntradaOnAir || b.horaEntradaPrevista || '00:00:00');
                                    return ta - tb;
                                });
                                for (var li = 0; li < lines.length; li++) {
                                    var item = lines[li];
                                    if (!item.titol) continue;
                                    if (item.flotant === true) continue;
                                    var isStructural = reader.isItemEstructural(item) || item.teVideo === true;
                                    if (!isStructural) continue;
                                    var upper = item.titol.toUpperCase().trim();
                                    var isReserved = false;
                                    for (var ri = 0; ri < RESERVED_THEMES.length; ri++) {
                                        if (upper.indexOf(RESERVED_THEMES[ri]) !== -1) {
                                            isReserved = true;
                                            break;
                                        }
                                    }
                                    if (!isReserved && upper.length > 2) {
                                        sanitizedTheme = getUtils().sanitizeName(item.titol).toUpperCase();
                                        log('🏷️ [Theme] Tema extret del JSON: "' + sanitizedTheme + '" (item ' + (item.num || '?') + ')');
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    log('⚠️ [Theme] Error extraient tema del JSON: ' + e.message);
                }

                const assets = await this._fullScan(ctx);
                
                // Si no s'ha pogut extraure del JSON, fallback als chyrons
                if (!sanitizedTheme) {
                    sanitizedTheme = getUtils().sanitizeName(assets.wotts.tema).toUpperCase();
                    log('🏷️ [Theme] Tema extret dels chyrons (fallback): "' + sanitizedTheme + '"');
                }
                const shortProg = ctx.progData.wott || "TNV";
                // Determinar hora d'inici del programa (per inserir el MP4 desde l'inici del informatiu)
                const PROGRAM_START_HOURS = {
                    TNV: 21.0,   // TN Vespre → 21:00
                    TNM: 14.5,   // TN Migdia → 14:30
                    TNC: 13.8333 // TN Comarques → 13:50
                };
                const worldProgramStartHour = PROGRAM_START_HOURS[shortProg] || 0;
                const projSlug = `${shortProg}_${ctx.bloque}_${sanitizedTheme}`;
                
                const fileName = `Pruebas_${projSlug}.prproj`;
                const folderPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir;
                const fullDestPath = (folderPath + "/" + fileName).replace(/\\/g, "/");

                const paths = {
                    plantillaPath: ctx.config.rutas.plantilla_net,
                    fullDestPath: fullDestPath,
                    folderPath: folderPath,
                    sanitizedTheme: sanitizedTheme
                };

                // ─── Inicialitzar fitxer de log per a aquest projecte ──────────────
                getUtils()._setLogPath(folderPath, fileName);

                // ─── NOU: Inicialitzar Manifest de Sessió ──────────────────────────
                // Registrem l'inici del procés per tenir una font de veritat persistent
                const manifest = await FASTPASS_UI.SessionManifest.save(ctx, {
                    program: {
                        projectFile: fileName,
                        projectFolder: folderPath
                    }
                });

                // ─── NOU: Intentar carregar dades de l'escaleta JSON ──────────────────────
                // Usa el sistema de 3 tiers (calcPrecisionTrimBounds) per obtenir
                // els TCs reals basats en items emesos, no en blocs amb handles.
                let cleanFeedData = null;
                try {
                    const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                    if (reader) {
                        // handles es llegeixen de Config.get().handles (font única: 11_Configuracio.js)
                        // _getHandleSecs() a escaleta_reader.js consulta Config automàticament

                        // jsonMeta i jsonData ja estan carregats (extrets abans per al tema)
                        // Si no es van carregar, tornar-ho a intentar
                        // També si jsonData és null (JSON descartat per load), usar findLatestValid
                        if (!jsonMeta || !jsonData) {
                            var datePrefixJson2 = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                            var validResult2 = await reader.findLatestValid(ctx.progData.archivo, ctx.bloque, datePrefixJson2);
                            if (validResult2 && validResult2.valid) {
                                jsonMeta = { path: validResult2.path, filename: validResult2.filename };
                                jsonData = validResult2.data;
                            } else {
                                // Fallback a findLatest tradicional
                                if (!jsonMeta) {
                                    jsonMeta = await reader.findLatest(ctx.progData.archivo, ctx.bloque, datePrefixJson2);
                                }
                                if (jsonMeta && !jsonData) {
                                    jsonData = await reader.load(jsonMeta.path);
                                }
                            }
                        }
                        if (jsonMeta && jsonData) {
                            if (jsonData) {
                                // Tots els ítems de l'escaleta (per persistir al manifest)
                                const allItems = jsonData.escaleta?.liniesEscaleta || [];

                                // ─── SISTEMA DE 3 TIERS: Precisió de trim ─────────────────
                                const bounds = reader.calcPrecisionTrimBounds(
                                    jsonData,
                                    ctx.bloque,
                                    jsonData.cleanFeed.mediaStart,
                                    jsonData.cleanFeed.mediaStop,
                                    ctx.config
                                );

                                if (bounds) {
                                    const lines = reader.getLinesForBlock(jsonData, ctx.bloque);

                                    // ─── DETECCIÓ DE FALLBACK: Bounds fora del rang del MP4 cleanFeed ───
                                    // Quan un bloc s'emet fora de l'horari programat (ex: TNM V2 a les
                                    // 15:44 amb cleanFeed que acaba a 15:29), els bounds relatius al
                                    // MP4 excedeixen la seva duració. En aquest cas, s'usa el MP4
                                    // individual del bloc des de la ruta de verticalització.
                                    let useBlockMedia = false;
                                    let blockMediaPath = null;
                                    const outOfRangeCheck = reader.isBoundsOutOfCleanFeedRange(
                                        bounds,
                                        jsonData.cleanFeed.mediaStart,
                                        jsonData.cleanFeed.mediaStop
                                    );

                                    if (outOfRangeCheck.outOfRange) {
                                        log(`⚠️ [FALLBACK] ${outOfRangeCheck.reason} → Buscant MP4 individual del bloc...`);

                                        // Buscar el MP4 del bloc a rutas.verticalitzacio
                                        try {
                                            const scanner = window.FASTPASS_UI && window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.Scan;
                                            if (scanner && scanner.mediaAssets) {
                                                const blockAssets = await scanner.mediaAssets(ctx);
                                                if (blockAssets && blockAssets.mp4) {
                                                    blockMediaPath = blockAssets.mp4.path;
                                                    useBlockMedia = true;
                                                    log(`✅ [FALLBACK] MP4 del bloc trobat: ${blockAssets.mp4.name}`);
                                                } else {
                                                    log(`⚠️ [FALLBACK] No s'ha trobat MP4 individual del bloc a ${ctx.config.rutas.verticalitzacio}. Es continuarà amb el cleanFeed (pot fallar).`);
                                                }
                                            }
                                        } catch (eScan) {
                                            log(`⚠️ [FALLBACK] Error escanejant MP4 del bloc: ${eScan.message}`);
                                        }

                                        if (useBlockMedia && blockMediaPath) {
                                            // Recalcular bounds per al MP4 del bloc:
                                            // mp4ExpandedInPoint=0 (inici del fitxer del bloc)
                                            // mp4Duration es preserva idèntic (el contingut no canvia)
                                            const fallbackBounds = reader.calcFallbackBoundsForBlockMedia(bounds);
                                            if (fallbackBounds) {
                                                bounds.mp4ExpandedInPoint  = fallbackBounds.mp4ExpandedInPoint;
                                                bounds.mp4ExpandedOutPoint = fallbackBounds.mp4ExpandedOutPoint;
                                                bounds.mp4Duration         = fallbackBounds.mp4Duration;

                                                // Ajustar worldSecMediaStart al ref per al MP4 del bloc.
                                                // En el cas normal, worldSecMediaStart és l'inici del cleanFeed.
                                                // En el fallback, el MP4 del bloc comença al seu propi TC,
                                                // per tant worldSecMediaStart s'ajusta a worldBlockStartSec - handles
                                                // perquè l'offsetSec resultant segueixi sent correcte.
                                                // Fórmula dels marcadors:
                                                //   (worldSecOnAir - worldSecMediaStart) + offsetSec
                                                //   on offsetSec = -mp4ExpandedInPoint = 0
                                                //   → worldSecOnAir - (worldBlockStartSec - handles) + 0
                                                //   = worldSecOnAir - worldBlockStartSec + handles  ✓
                                                const fbWorldSecMediaStart = (bounds.ref.worldBlockStartSec != null)
                                                    ? bounds.ref.worldBlockStartSec - (ctx.config.handles || 0)
                                                    : bounds.ref.worldSecMediaStart;
                                                bounds.ref.worldSecMediaStart = fbWorldSecMediaStart;

                                                log(`📐 [FALLBACK] Bounds recalculats per al MP4 del bloc: IN=0s OUT=${fallbackBounds.mp4ExpandedOutPoint.toFixed(1)}s dur=${fallbackBounds.mp4Duration.toFixed(1)}s | ref.worldSecMediaStart ajustat a ${fbWorldSecMediaStart.toFixed(1)}s`);
                                            }
                                        }
                                    }

                                    // Calcular el "punt dulce" (sense handles): temps OnAir real relatiu al MP4.
                                    // bounds.mp4ExpandedInPoint = sweetPoint - handles (3s marge previ)
                                    // bounds.mp4ExpandedOutPoint = sweetPoint + handles (3s marge posterior)
                                    // bounds.ref.worldBlockStartSec/worldBlockEndSec són els temps OnAir absoluts.
                                    // Restem worldSecMediaStart per obtindre valors relatius al MP4.
                                    // NOTA: En mode fallback, aquests valors seran relatius al MP4 del bloc,
                                    //       però worldBlockStartSec/worldBlockEndSec (absoluts) no canvien.
                                    const worldSecMediaStart = bounds.ref.worldSecMediaStart;
                                    let mp4SweetInPoint  = (bounds.ref.worldBlockStartSec != null) ? bounds.ref.worldBlockStartSec - worldSecMediaStart : bounds.mp4ExpandedInPoint;
                                    let mp4SweetOutPoint = (bounds.ref.worldBlockEndSec   != null) ? bounds.ref.worldBlockEndSec   - worldSecMediaStart : bounds.mp4ExpandedOutPoint;
                                    // Guardar el valor pre-offset de mp4SweetInPoint per a tlBlockInPointSecRaw
                                    // (necessitem el valor SENSE offset per al càlcul de offsetSec)
                                    const mp4SweetInPointRaw = mp4SweetInPoint;
                                    // Aplicar offset global de TC als punts dolços per corregir deriva d'ingesta.
                                    // mp4SweetInPoint/mp4SweetOutPoint (amb offset) es guarden a cleanFeedData
                                    // per a referència de debug. El source IN real del clip és mp4ExpandedInPoint
                                    // (amb handle) + offset global, aplicat a 3_Project_Logic.js.
                                    // L'offset desplaça el RANG SOURCE del clip dins del MP4 (on es llegeix
                                    // el contingut). Els delimitadors de seqüència es fixen als sweet points
                                    // (≈handleSecs i clipDuration-handleSecs) via cleanFeedData.handleSecs.
                                    mp4SweetInPoint  = getUtils().applyGlobalOffsetSec(mp4SweetInPoint);
                                    mp4SweetOutPoint = getUtils().applyGlobalOffsetSec(mp4SweetOutPoint);
                                    // Calcular el punt d'inici del MP4 per si es volgués començar des de l'inici
                                    // del programa (actualment no s'usa per a inserció, es guarda com a referència).
                                    // NOTA: Ja NO s'aplica offset global aquí perquè l'offset només es aplica
                                    // als marcadors a flow_assembly.js via applyGlobalOffsetSec().
                                    const worldProgramStartSec = worldProgramStartHour * 3600;
                                    let mp4ProgramInPoint = worldProgramStartSec - worldSecMediaStart;
                                    // No pot ser negatiu (el MP4 comença després de l'hora objectiu)
                                    if (mp4ProgramInPoint < 0) mp4ProgramInPoint = 0;
                                    // No pot ser posterior a l'inPoint calculat (per no perdre el bloc)
                                    if (mp4ProgramInPoint > bounds.mp4ExpandedInPoint) mp4ProgramInPoint = bounds.mp4ExpandedInPoint;
                                    log(`📡 [ProgramStart] ${shortProg}: targetHour=${worldProgramStartHour}h → targetSec=${worldProgramStartSec}s, worldSecMediaStart=${worldSecMediaStart.toFixed(0)}s, mp4ProgramInPoint=${mp4ProgramInPoint.toFixed(2)}s (original mp4ExpandedInPoint=${bounds.mp4ExpandedInPoint.toFixed(2)}s)`);

                                    // NOTA: El clip s'insereix amb mp4ExpandedInPoint (amb handle) + offset global
                                    // com a source IN a 3_Project_Logic.js. L'offset desplaça el RANG SOURCE
                                    // dins del MP4 per corregir deriva d'ingesta. El clip es col·loca a start=0
                                    // al timeline. Els delimitadors de seqüència es fixen als sweet points
                                    // (≈3s i clipDuration-3s) per marcar on comença i acaba el contingut real,
                                    // no als extrems del clip amb handles.
                                    // En mode fallback, usar el MP4 individual del bloc en lloc del cleanFeed
                                    const effectiveMediaPath = useBlockMedia ? blockMediaPath : jsonData.cleanFeed.mediaPath;
                                    if (useBlockMedia) {
                                        log(`🔄 [FALLBACK] Usant MP4 del bloc: ${blockMediaPath}`);
                                    }

                                    cleanFeedData = {
                                        mediaPath: effectiveMediaPath,
                                        _isFallbackBlockMedia: useBlockMedia || false,  // flag per a diagnòstic
                                        mp4ProgramInPoint: mp4ProgramInPoint,
                                        mp4ExpandedInPoint: bounds.mp4ExpandedInPoint,    // Inclou -3s handle, SENSE offset global
                                        mp4ExpandedOutPoint: bounds.mp4ExpandedOutPoint,  // Inclou +3s handle, SENSE offset global
                                        mp4SweetInPoint: mp4SweetInPoint,
                                        mp4SweetInPointRaw: mp4SweetInPointRaw,  // sense offset global, per a càlcul de tlBlockInPointSec
                                        mp4SweetOutPoint: mp4SweetOutPoint,
                                        mp4Duration: bounds.mp4Duration,
                                        handleSecs: ctx.config.handles,   // font única de veritat (Config.get().handles)
                                        escaletaLines: lines,
                                        precisionTiers: {
                                            in: bounds.InTier,
                                            out: bounds.OutTier
                                        }
                                    };

                                    // Desar tota la info base al manifest i actualitzar la variable en memòria
                                    // NOTA: tlBlockInPointSec es guarda SENSE offset global (mp4ExpandedInPoint).
                                    // Amb handles=3s, mp4ExpandedInPoint = sweetPoint - 3s. Això és el punt
                                    // d'inici del clip al source MP4 (incloent el marge de handle).
                                    // L'offset global (tcOffset) s'aplica al clip origen via mp4ExpandedInPoint
                                    // + globalOffset com a source IN a 3_Project_Logic.js. El tlBlockInPointSec
                                    // es manté sense offset per al càlcul de offsetSec, que converteix posicions
                                    // source a posicions de timeline: offsetSec = tlClipStartSec - tlBlockInPointSec.
                                    // Com que el clip s'inserta a start=0, offsetSec = -mp4ExpandedInPoint, i els
                                    // marcadors a flow_assembly.js es calculen com (worldSecOnAir - mediaStart) + offsetSec.
                                    // mp4ExpandedInPoint NO porta offset global (s'aplica després a 3_Project_Logic.js).
                                    Object.assign(manifest, await FASTPASS_UI.SessionManifest.save(ctx, {
                                        program: { escaletaFile: jsonMeta.filename },
                                        cleanFeed: jsonData.cleanFeed,
                                        blockBounds: bounds,  // inclou mp4ExpandedInPoint, mp4ExpandedOutPoint, tiers...
                                        ref: {
                                            ...bounds.ref,  // { worldSecMediaStart, mp4ExpandedInPoint, worldBlockStartSec, worldBlockEndSec, InTier, OutTier, tlClipStartSec:null, offsetSec:null }
                                            tlBlockInPointSec: bounds.mp4ExpandedInPoint  // mp4ExpandedInPoint SENSE offset global (sweet - handle)
                                        },
                                        escaletaItems: allItems.map(l => ({
                                            sequencia: l.sequencia,
                                            num: l.num,
                                            titol: l.titol,
                                            teVideo: l.teVideo,
                                            horaEntradaOnAir: l.horaEntradaOnAir,
                                            horaEntradaPrevista: l.horaEntradaPrevista,
                                            horaSortidaPrevista: l.horaSortidaPrevista,
                                            duradaOnAir: l.duradaOnAir,
                                            durada: l.durada,
                                            agrupacio: l.agrupacio,
                                            flotant: l.flotant || false
                                        })),
                                        phases: { boundsCalculated: true }
                                    }));

                                    log(`📡 [PrecisionTrim] cleanFeed: in=${bounds.mp4ExpandedInPoint.toFixed(1)}s out=${bounds.mp4ExpandedOutPoint.toFixed(1)}s (InTier=${bounds.InTier}, OutTier=${bounds.OutTier})`);

                                    // ─── FASE 0: Extracció de clip via ffmpeg (si possible) ──
                                    try {
                                        const ffmpeg = window.FASTPASS_UI.Logic.FFmpeg;
                                        if (ffmpeg && ffmpeg.extractClip) {
                                            const clipName = `${ctx.progData.wott || "TNV"}_${ctx.bloque}_CLIP.mp4`;
                                            // Destí: DIRECTORI DEL PROJECTE (folderPath = on neix el .prproj a _runNew).
                                            // El clip del bloc, l'AUDIO_REF.bin i el .prproj queden sempre junts
                                            // i la importació es fa des d'aquesta ruta (cleanFeedData.mediaPath).
                                            // NOTA: no usem Context.folder() aquí perquè a _runNew el projecte nou
                                            // encara no existeix (retornaria la carpeta del projecte ANTERIOR).
                                            // ffmpeg/PowerShell necessiten backslashes; Premiere, forward slashes (després).
                                            const projFolder = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir;
                                            const clipPath = (projFolder + "\\" + clipName).replace(/\//g, "\\");
                                            log(`🎬 [EXTRACT] Clip del bloc → directori del projecte: ${clipPath}`);

                                            // mp4Duration es necessita per a l'extracció i el recàlcul de bounds
                                            const mp4Duration = bounds.mp4Duration;
                                            let useExtractedClip = false;

                                            // Estratègia: EXTREURE SEMPRE. Si el clip ja existeix, ffmpeg -y el sobreescriu.
                                            // Si el cleanFeed és massa petit, l'extracció fallarà (timeout a waitForFile).
                                            // Evitem checkSourceDuration perquè IO.executeShell amb pipes/fitxers temporals
                                            // no funciona correctament a ExtendScript (afegeix cometes extra als paths).
                                            log(`🎬 [EXTRACT] Extraient clip: input=${effectiveMediaPath}, start=${bounds.mp4ExpandedInPoint.toFixed(2)}s, dur=${mp4Duration.toFixed(2)}s, output=${clipPath}`);
                                            getUtils().status("🎬 Extraient clip via ffmpeg...", "info");
                                            const extractResult = await ffmpeg.extractClip(
                                                effectiveMediaPath,
                                                bounds.mp4ExpandedInPoint,
                                                mp4Duration,
                                                clipPath
                                            );
                                            if (extractResult.ok) {
                                                useExtractedClip = true;
                                                log(`✅ [EXTRACT] Clip extret correctament: ${clipPath}`);
                                            } else {
                                                // NO FALLBACK: si l'extracció falla, error fatal
                                                const errMsg = `Error extraient clip: ${extractResult.error}`;
                                                log(`❌ [EXTRACT] ${errMsg}`);
                                                getUtils().status(errMsg, "error");
                                                throw new Error(errMsg);
                                            }

                                            if (useExtractedClip) {
                                                // ─── RECALCULAR BOUNDS PER AL CLIP EXTRET ────────
                                                // El clip extret comença a 0 (gràcies a -avoid_negative_ts make_zero).
                                                // Per tant, els bounds relatius al clip són:
                                                //   clipExpandedInPoint  = handleSecs   (el contingut real comença a handleSecs)
                                                //   clipExpandedOutPoint = mp4Duration - handleSecs
                                                //   clipDuration         = mp4Duration (el segment extret té exactament mp4Duration)
                                                const h = ctx.config.handles || 0;
                                                const clipExpandedInPoint  = h;
                                                const clipExpandedOutPoint = mp4Duration;
                                                const clipDuration         = mp4Duration;

                                                // worldSecMediaStart s'ajusta per al clip extret:
                                                // El clip extret comença a mp4ExpandedInPoint del cleanFeed.
                                                // worldBlockStartSec - handleSecs = punt d'inici del clip al món real.
                                                // Com que el clip comença a 0, worldSecMediaStart = worldBlockStartSec - handleSecs.
                                                const fbWorldSecMediaStart = (bounds.ref.worldBlockStartSec != null)
                                                    ? bounds.ref.worldBlockStartSec - h
                                                    : bounds.ref.worldSecMediaStart;

                                                log(`📐 [EXTRACT] Bounds recalculats per al clip extret: IN=${clipExpandedInPoint.toFixed(1)}s OUT=${clipExpandedOutPoint.toFixed(1)}s dur=${clipDuration.toFixed(1)}s | worldSecMediaStart ajustat a ${fbWorldSecMediaStart.toFixed(1)}s | handleSecs=${h}s`);
                                                log(`🔍 [EXTRACT] cleanFeedData PRE-extracció: mediaPath=${cleanFeedData.mediaPath}, mp4ExpandedInPoint=${cleanFeedData.mp4ExpandedInPoint.toFixed(1)}s, mp4ExpandedOutPoint=${cleanFeedData.mp4ExpandedOutPoint.toFixed(1)}s`);

                                                // Actualitzar cleanFeedData amb el clip local i els nous bounds
                                                // NOTA: clipPath té backslashes (per a ffmpeg/PowerShell/Windows UNC).
                                                // Premiere necessita forward slashes per obrir el fitxer correctament.
                                                const premClipPath = clipPath.replace(/\\/g, "/");
                                                cleanFeedData.mediaPath           = premClipPath;
                                                log(`🔍 [EXTRACT] clipPath (backslash, per a ffmpeg)=${clipPath}`);
                                                log(`🔍 [EXTRACT] premClipPath (forward slash, per a Premiere)=${premClipPath}`);
                                                cleanFeedData.mp4ExpandedInPoint  = clipExpandedInPoint;   // ara relativament al clip (comença a 0)
                                                cleanFeedData.mp4ExpandedOutPoint = clipExpandedOutPoint;
                                                cleanFeedData.mp4Duration         = clipDuration;
                                                cleanFeedData._isExtractedClip    = true;  // flag per a diagnòstic
                                                // Actualitzar ref.worldSecMediaStart per a marcadors
                                                cleanFeedData._extractedWorldSecMediaStart = fbWorldSecMediaStart;
                                                // ⚠️ CRÍTIC: Actualitzar mp4SweetInPointRaw per al càlcul d'offsetSec posterior.
                                                // El clip extret comença a 0, per tant el "sweet point" sense offset = handleSecs.
                                                // Això és necessari perquè la fórmula offsetSec = tlClipStartSec - tlBlockInPointSec
                                                // faci servir el valor correcte (handleSecs) en lloc del valor original del cleanFeed.
                                                cleanFeedData.mp4SweetInPointRaw = h;
                                                log(`📐 [EXTRACT] mp4SweetInPointRaw actualitzat a ${h.toFixed(2)}s (handleSecs) per al clip extret`);

                                                // Actualitzar també les referències del manifest (en memòria)
                                                if (manifest && manifest.ref) {
                                                    manifest.ref.worldSecMediaStart = fbWorldSecMediaStart;
                                                    log(`📐 [EXTRACT] manifest.ref.worldSecMediaStart actualitzat a ${fbWorldSecMediaStart.toFixed(2)}s`);
                                                }

                                                log(`✅ [EXTRACT] cleanFeedData actualitzat: mediaPath=${cleanFeedData.mediaPath}, mp4ExpandedInPoint=${clipExpandedInPoint.toFixed(1)}s, mp4ExpandedOutPoint=${clipExpandedOutPoint.toFixed(1)}s, dur=${clipDuration.toFixed(1)}s`);
                                                getUtils().status(`✅ Clip extret: ${clipName}`, "exito");

                                                // Guardar al manifest: clipPath + ref actualitzat del clip extret
                                                try {
                                                    await FASTPASS_UI.SessionManifest.save(ctx, {
                                                        extractedClip: {
                                                            path: clipPath,
                                                            name: clipName,
                                                            isExtracted: true,
                                                            extractedWorldSecMediaStart: fbWorldSecMediaStart
                                                        },
                                                        ref: {
                                                            worldSecMediaStart: fbWorldSecMediaStart,
                                                            mp4ExpandedInPoint: clipExpandedInPoint,
                                                            mp4ExpandedOutPoint: clipExpandedOutPoint,
                                                            mp4Duration: clipDuration
                                                        }
                                                    });
                                                    log(`✅ [EXTRACT] Manifest actualitzat amb ref del clip extret: worldSecMediaStart=${fbWorldSecMediaStart.toFixed(2)}s, mp4ExpandedInPoint=${clipExpandedInPoint.toFixed(2)}s`);
                                                } catch(eManifest) {
                                                    log(`⚠️ [EXTRACT] Error guardant dades del clip al manifest: ${eManifest.message}`);
                                                }
                                            } else {
                                                log(`ℹ️ [EXTRACT] No s'usa clip extret. Es manté el comportament actual (MP4 complet).`);
                                            }
                                        } else {
                                            log(`ℹ️ [EXTRACT] FFmpegLogic.extractClip no disponible. Usant MP4 complet (fallback).`);
                                        }
                                    } catch (eExtract) {
                                        log(`⚠️ [EXTRACT] Error durant extracció de clip: ${eExtract.message}. Continuant sense clip extret.`);
                                    }
                                    // ─── FI FASE 0 ───────────────────────────────────────────

                                    // ─── FASE 1: Volcado de escaleta al JSON de análisis ──────
                                    try {
                                        const contextItems = {};
                                        // Extraer items de contexto (prev/next video item)
                                        const allEscaletaItems = jsonData.escaleta ? (jsonData.escaleta.liniesEscaleta || []) : [];
                                        if (allEscaletaItems.length > 0) {
                                            const sortedAll = allEscaletaItems.slice().filter(function(l) {
                                                return l.horaEntradaOnAir && l.horaEntradaOnAir !== '00:00:00';
                                            }).sort(function(a, b) {
                                                return reader.tcToSeconds(a.horaEntradaOnAir) - reader.tcToSeconds(b.horaEntradaOnAir);
                                            });
                                            if (sortedAll.length > 0) {
                                                // Primer item del bloque actual
                                                const firstBlockLine = lines[0];
                                                const firstBlockIdx = sortedAll.indexOf(firstBlockLine);
                                                if (firstBlockIdx > 0) {
                                                    const prevItem = sortedAll[firstBlockIdx - 1];
                                                    contextItems.prevVideoItem = {
                                                        num: prevItem.num || '',
                                                        titol: prevItem.titol || '',
                                                        agrupacio: prevItem.agrupacio || null,
                                                        horaEntradaOnAir: prevItem.horaEntradaOnAir,
                                                        duradaOnAir: prevItem.duradaOnAir || '0:00'
                                                    };
                                                }
                                                // Último item del bloque actual
                                                const lastBlockLine = lines[lines.length - 1];
                                                const lastBlockIdx = sortedAll.indexOf(lastBlockLine);
                                                if (lastBlockIdx >= 0 && lastBlockIdx < sortedAll.length - 1) {
                                                    const nextItem = sortedAll[lastBlockIdx + 1];
                                                    contextItems.nextVideoItem = {
                                                        num: nextItem.num || '',
                                                        titol: nextItem.titol || '',
                                                        agrupacio: nextItem.agrupacio || null,
                                                        horaEntradaOnAir: nextItem.horaEntradaOnAir,
                                                        duradaOnAir: nextItem.duradaOnAir || '0:00'
                                                    };
                                                }
                                            }
                                        }
                                        await FASTPASS_UI.Logic.Analysis.saveEscaleta(
                                            ctx, jsonMeta.filename, lines, contextItems, bounds
                                        );
                                    } catch (eAnalysis) {
                                        log("⚠️ [Analysis] Error guardant escaleta: " + eAnalysis.message);
                                    }
                                    // ─────────────────────────────────────────────────────────
                                } else {
                                    // Fallback al sistema anterior si el nou no funciona
                                    log(`⚠️ calcPrecisionTrimBounds ha retornat null. Usant calcOnAirBounds com a fallback.`);
                                    const fallbackBounds = reader.calcOnAirBounds(
                                        jsonData,
                                        ctx.bloque,
                                        jsonData.cleanFeed.mediaStart,
                                        jsonData.cleanFeed.mediaStop,
                                        ctx.config
                                    );
                                    if (fallbackBounds) {
                                        const lines = reader.getLinesForBlock(jsonData, ctx.bloque);
                                        // Calcular el punt d'inici del MP4 per al fallback
                                        const fbWorldSecMediaStart = fallbackBounds.ref ? fallbackBounds.ref.worldSecMediaStart : 0;
                                        let fbProgramInPoint = worldProgramStartSec - fbWorldSecMediaStart;
                                        // Aplicar offset global de TC per corregir deriva sistemàtica d'ingesta
                                        fbProgramInPoint = getUtils().applyGlobalOffsetSec(fbProgramInPoint);
                                        if (fbProgramInPoint < 0) fbProgramInPoint = 0;
                                        if (fbProgramInPoint > fallbackBounds.mp4ExpandedInPoint) fbProgramInPoint = fallbackBounds.mp4ExpandedInPoint;
                                        log(`📡 [ProgramStart-Fallback] ${shortProg}: mp4ProgramInPoint=${fbProgramInPoint.toFixed(2)}s (original fallbackInPoint=${fallbackBounds.mp4ExpandedInPoint.toFixed(2)}s)`);

                                        const fbHandleSecs = ctx.config.handles || 0;   // font única (Config.get().handles)
                                        cleanFeedData = {
                                            handleSecs: fbHandleSecs,   // font única de veritat (escaleta_reader.js)
                                            mediaPath: jsonData.cleanFeed.mediaPath,
                                            mp4ProgramInPoint: fbProgramInPoint,
                                            mp4ExpandedInPoint: fallbackBounds.mp4ExpandedInPoint,   // expanded (amb handle), SENSE offset
                                            mp4ExpandedOutPoint: fallbackBounds.mp4ExpandedOutPoint, // expanded (amb handle), SENSE offset
                                            mp4Duration: fallbackBounds.mp4Duration,
                                            escaletaLines: lines
                                        };
                                        await FASTPASS_UI.SessionManifest.save(ctx, {
                                            program: { escaletaFile: jsonMeta.filename },
                                            cleanFeed: jsonData.cleanFeed,
                                            blockBounds: fallbackBounds,
                                            ref: {
                                                ...fallbackBounds.ref,
                                                tlBlockInPointSec: fallbackBounds.mp4ExpandedInPoint  // expanded SENSE offset (consistent amb path principal)
                                            },
                                            escaletaItems: allItems.map(l => ({
                                                sequencia: l.sequencia,
                                                num: l.num,
                                                titol: l.titol,
                                                teVideo: l.teVideo,
                                                horaEntradaOnAir: l.horaEntradaOnAir,
                                                horaEntradaPrevista: l.horaEntradaPrevista,
                                                horaSortidaPrevista: l.horaSortidaPrevista,
                                                duradaOnAir: l.duradaOnAir,
                                                durada: l.durada,
                                                agrupacio: l.agrupacio,
                                                flotant: l.flotant || false
                                            })),
                                            phases: { boundsCalculated: true }
                                        });
                                        log(`📡 [Fallback] cleanFeed: in=${fallbackBounds.mp4ExpandedInPoint.toFixed(1)}s out=${fallbackBounds.mp4ExpandedOutPoint.toFixed(1)}s`);

                                        // ─── FASE 1: Volcado de escaleta al JSON de análisis (fallback) ──────
                                        try {
                                            const contextItems = {};
                                            const allEscaletaItems = jsonData.escaleta ? (jsonData.escaleta.liniesEscaleta || []) : [];
                                            if (allEscaletaItems.length > 0) {
                                                const sortedAll = allEscaletaItems.slice().filter(function(l) {
                                                    return l.horaEntradaOnAir && l.horaEntradaOnAir !== '00:00:00';
                                                }).sort(function(a, b) {
                                                    return reader.tcToSeconds(a.horaEntradaOnAir) - reader.tcToSeconds(b.horaEntradaOnAir);
                                                });
                                                if (sortedAll.length > 0) {
                                                    const firstBlockLine = lines[0];
                                                    const firstBlockIdx = sortedAll.indexOf(firstBlockLine);
                                                    if (firstBlockIdx > 0) {
                                                        const prevItem = sortedAll[firstBlockIdx - 1];
                                                        contextItems.prevVideoItem = {
                                                            num: prevItem.num || '',
                                                            titol: prevItem.titol || '',
                                                            agrupacio: prevItem.agrupacio || null,
                                                            horaEntradaOnAir: prevItem.horaEntradaOnAir,
                                                            duradaOnAir: prevItem.duradaOnAir || '0:00'
                                                        };
                                                    }
                                                    const lastBlockLine = lines[lines.length - 1];
                                                    const lastBlockIdx = sortedAll.indexOf(lastBlockLine);
                                                    if (lastBlockIdx >= 0 && lastBlockIdx < sortedAll.length - 1) {
                                                        const nextItem = sortedAll[lastBlockIdx + 1];
                                                        contextItems.nextVideoItem = {
                                                            num: nextItem.num || '',
                                                            titol: nextItem.titol || '',
                                                            agrupacio: nextItem.agrupacio || null,
                                                            horaEntradaOnAir: nextItem.horaEntradaOnAir,
                                                            duradaOnAir: nextItem.duradaOnAir || '0:00'
                                                        };
                                                    }
                                                }
                                            }
                                            await FASTPASS_UI.Logic.Analysis.saveEscaleta(
                                                ctx, jsonMeta.filename, lines, contextItems, fallbackBounds
                                            );
                                        } catch (eAnalysis) {
                                            log("⚠️ [Analysis] Error guardant escaleta (fallback): " + eAnalysis.message);
                                        }
                                        // ─────────────────────────────────────────────────────────────────
                                    }
                                }
                            }
                        } else {
                            log(`⚠️ Cap JSON d'escaleta per a ${ctx.progData.archivo}. Usant mp4 estàndard.`);
                        }
                    }
                } catch (eReader) {
                    log(`⚠️ EscaletaReader: ${eReader.message}. Continuant sense dades OnAir.`);
                }
                // ─────────────────────────────────────────────────────────────────────────

                log(`🏗️ Generant projecte: ${fileName}`);

                // 1. CREACIÓ FÍSICA (Crea seqüencia i inserta MP4 amb els bounds calculats)
                await FASTPASS_UI.Logic.Project.create(ctx, assets.wotts, assets.media, paths, assets.portada, shortProg, cleanFeedData);

                // 2. FINALITZAR ref (Obtenir tlClipStartSec real post-inserció)
                if (cleanFeedData) {
                    log("📐 Finalitzant ref post-inserció...");
                    
                    // Llegir la posició real del clip al timeline via Clips.get()
                    // Usem start.seconds (posició al timeline), NO inPoint.seconds (relatiu al source)
                    const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
                    let tlClipStartSec = NaN;
                    try {
                        const clipData = JSON.parse(clipDataRaw);
                        tlClipStartSec = clipData.start;
                        log(`🔍 [LOG] Clips.get(1,0): start=${clipData.start}, inPoint=${clipData.inPoint}, end=${clipData.end}`);
                    } catch(e) {
                        log(`⚠️ Error parsejant clipData: ${clipDataRaw}`);
                    }
                    
                    if (!isNaN(tlClipStartSec)) {
                        // Usar tlBlockInPointSec (inici del bloc en source MP4, SENSE offset global)
                        // per al càlcul de offsetSec. La fórmula dels marcadors
                        // (worldSecOnAir - worldSecMediaStart) + offsetSec espera que
                        // offsetSec = tlClipStartSec - tlBlockInPointSec.
                        // NOTA: El clip s'inserta a start=0 amb source IN = mp4SweetInPoint (AMB offset).
                        // tlBlockInPointSec = mp4SweetInPointRaw (SENSE offset) perquè la fórmula
                        // offsetSec = tlClipStartSec - tlBlockInPointSec = 0 - mp4SweetInPointRaw
                        // ja reflecteix correctament la conversió source→timeline incloent l'offset
                        // (les marques de posicionament de Premiere es cancel·len amb l'offset aplicat al source).
                        const tlBlockInPointSec = (manifest.ref?.tlBlockInPointSec ?? cleanFeedData.mp4SweetInPointRaw) + (ctx.config.tcOffset || 0);
                        const offsetSec = tlClipStartSec - tlBlockInPointSec;
                        
                        log(`🔍 [LOG] CÀLCUL ref: tlClipStartSec=${tlClipStartSec.toFixed(4)}s - tlBlockInPointSec=${tlBlockInPointSec.toFixed(4)}s (inclou offset=${(ctx.config.tcOffset||0).toFixed(4)}s) = offsetSec=${offsetSec.toFixed(4)}s (mp4SweetInPoint=${cleanFeedData.mp4SweetInPoint.toFixed(4)}s, raw=${cleanFeedData.mp4SweetInPointRaw.toFixed(4)}s)`);
                        
                        // Actualitzar manifest amb la posició real i sincronitzar en memòria
                        Object.assign(manifest, await FASTPASS_UI.SessionManifest.save(ctx, {
                            ref: {
                                tlClipStartSec: tlClipStartSec,
                                offsetSec: offsetSec
                            },
                            phases: {
                                mp4Imported: true,
                                tcRefEstablished: true
                            }
                        }));
                        log(`📐 ref establert: offsetSec=${offsetSec.toFixed(3)}s (tlClipStartSec=${tlClipStartSec.toFixed(3)}s)`);
                    } else {
                        log("⚠️ No es pot llegir tlClipStartSec de V1. ref quedarà incomplet.");
                    }
                }

                // Registrar como último proyecto abierto
                if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                    window.FASTPASS_UI.State.lastOpenedProjectName = fileName;
                }

                log("✅ Workflow NOU completat amb èxit.");
                // Actualizar contexto
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
        
            } catch (e) {
                FASTPASS_UI.Utils.log("💥 Error crític a runNew: " + e.message, "ERROR");
            }
        },


        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            
            // 1. ESCANEIG I SYNC
            const assets = await this._fullScan(ctx);

            if (!assets.wotts || !assets.wotts.tema) {
                log("⚠️ Encara no hi ha rètols al NAS. Guardant progrés...");
                return await callJSX("Project.save()");
            }

            const currentPath = await callJSX("Project.path()");

            if (currentPath.indexOf("PENDENT") !== -1) {
                log("🧬 Projecte PENDENT detectat. Promocionant...");

                const sanitizedTema = getUtils().sanitizeName(assets.wotts.tema);
                const newProjectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
                const newPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + "Pruebas_" + newProjectName + ".prproj";

                // INGESTA I SYNC
                await this._completeSyncUI(ctx, assets);

                log(`💾 Guardant com a: ${newPath}`);
                const saveRes = await callJSX(`Project.saveAs('${getUtils().escape(newPath)}')`);

                if (saveRes === "OK") {
                    log(`🗑️ Eliminant rastre PENDENT...`);
                    getUtils().deleteFile(currentPath);
                    getUtils().deleteFile(currentPath + ".lock");
                    await FASTPASS_UI.Logic.Project.lock(newPath);
                    log("🟢 Projecte promocionat amb èxit!");
                    // Actualizar contexto para que el botón refleje el estado actual
                    if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                        await FASTPASS_UI.Core.Context.checkContext();
                    }
                }
            } else {
                // INGESTA I SYNC ESTÀNDARD
                await this._completeSyncUI(ctx, assets);
                await callJSX("Project.save()");
                log("✅ Actualització completada.");
                // Actualizar contexto para que el botón refleje el estado actual
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            }
        },

        _runGo: async function (data) {
            const projName = data.name;
            log(`🚀 Canviant focus a: ${projName}...`);
            // Intentar cambiar el foco via Context.set
            let setResult = await callJSX(`Context.set('${getUtils().escape(projName)}')`);
            
            // Construir ruta completa del proyecto
            const folderPath = data.config.rutas.destinoBase + data.progData.directorio + "/" + data.dateDir;
            const fullPath = (folderPath + "/" + projName).replace(/\\/g, "/");
            
            // Si Context.set falla, intentar con Project.open
            if (setResult !== "OK") {
                log(`⚠️ Context.set falló, intentando Project.open...`);
                const openResult = await callJSX(`FASTPASS.Project.open('${getUtils().escape(fullPath)}')`);
                if (openResult !== "OK") {
                    log(`❌ No se pudo cambiar el foco al proyecto.`);
                    return;
                }
            } else {
                // Aunque Context.set tuvo éxito, forzar apertura para asegurar foco visual
                const openResult = await callJSX(`FASTPASS.Project.open('${getUtils().escape(fullPath)}')`);
            }
            
            // Sincronizar assets (igual que antes)
            const ctx = await this._setupContext();
            const assets = await this._fullScan(ctx);
            await this._completeSyncUI(ctx, assets);
            
            if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                await FASTPASS_UI.Core.Context.checkContext();
            }
        },

        _runLoad: async function (data) {
            log("🚀 [FLOW-LOAD]");
            // Usar el proyecto existente pasado en data
            const projName = data.name; // Nombre completo del archivo .prproj
            const folderPath = data.config.rutas.destinoBase + data.progData.directorio + "/" + data.dateDir;
            const destPath = (folderPath + "/" + projName).replace(/\\/g, "/");
            log(`📂 Abriendo proyecto existente: ${destPath}`);

            // ─── Inicialitzar fitxer de log per a aquest projecte ──────────────────
            getUtils()._setLogPath(folderPath, projName);

            const forceOverride = data.forceOverride || false;
            
            // Verificar lock solo si no estamos forzando
            if (!forceOverride) {
                const lockPath = destPath + ".lock";
                // Lock debug comentado para reducir ruido
                // log(`🔍 [FLOW-LOAD] Verificando lock: ${lockPath}`);
                const lockExists = await callJSX(`IO.exists('${getUtils().escape(lockPath)}')`);
                // log(`🔍 [FLOW-LOAD] lockExists = ${lockExists}`);
                let lockOwner = null;
                if (lockExists === "true") {
                    lockOwner = await callJSX(`IO.readTxt('${getUtils().escape(lockPath)}')`);
                    lockOwner = lockOwner.trim();
                    // log(`🔍 [FLOW-LOAD] lockOwner = "${lockOwner}"`);
                }
                const currentUser = data.config.autor;
                // log(`🔍 [FLOW-LOAD] currentUser = "${currentUser}"`);
                if (lockOwner && lockOwner !== currentUser) {
                    log(`⚠️ [FLOW-LOAD] Lock pertenece a otro usuario. Mostrando alerta.`);
                    // Mostrar alerta
                    alert(`${lockOwner} ya está editando ${data.progData.archivo} ${data.bloque}.`);
                    // Cambiar botón a LOCKED
                    if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                        // Lock debug comentado para reducir ruido
                        // log(`🔍 [FLOW-LOAD] Actualizando botón a LOCKED.`);
                        FASTPASS_UI.Core.Context.updateButton('LOCKED', { ...data, lockOwner });
                    }
                    return;
                } else {
                    // Lock debug comentado para reducir ruido
                    // log(`🔍 [FLOW-LOAD] Lock propio o inexistente, continuando.`);
                }
            }
            
            // Bloquear el proyecto (lock) - sobrescribirá si forceOverride es true
            await FASTPASS_UI.Logic.Project.lock(destPath);
            
            // Abrir proyecto
            const openResult = await callJSX(`FASTPASS.Project.open('${getUtils().escape(destPath)}')`);
            log(`🔍 [FLOW-LOAD] Resultado de Project.open: ${openResult}`);
            
            if (openResult !== "OK") {
                log(`❌ [FLOW-LOAD] No se pudo abrir el proyecto.`);
                return;
            }
            
            // Sincronizar assets (importar solo los faltantes)
            const ctx = await this._setupContext();
            const assets = await this._fullScan(ctx);
            await this._completeSyncUI(ctx, assets);
            
            // Registrar como último proyecto abierto
            if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                window.FASTPASS_UI.State.lastOpenedProjectName = projName;
            }
            
            log("✅ Projecte obert.");
            // Actualizar contexto para que el botón cambie a UPDATE si el proyecto está abierto
            if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                await FASTPASS_UI.Core.Context.checkContext();
            }
        },

        /**
         * _fullScan: Escaneja rètols, media i portada, i actualitza flags de Context.
         */
        _fullScan: async function (ctx) {
            log("🔍 [SCAN] Analitzant context i materials...");
            
            // 1. Busquem materials al NAS
            const wotts = await window.Scan.wotts(ctx);
            const media = await window.Scan.mediaAssets(ctx);
            const portada = await window.Scan.portadas(ctx);
            
            // 2. Actualitzem State global
            window.FASTPASS_UI.State.detectedTheme = wotts.tema;
            window.FASTPASS_UI.State.hasMedia = !!media.mp4;
            // Generar estructura de bloques a partir de los Wotts
            if (wotts.list && wotts.list.length > 0) {
                window.FASTPASS_UI.State.structure = window.Parse.files(wotts.list, ctx.progData.wott, ctx.bloque);
                window.FASTPASS_UI.State.pieceIndex = 0;
                log(`🏗️ Estructura generada: ${window.FASTPASS_UI.State.structure.length} blocs`);
            } else {
                window.FASTPASS_UI.State.structure = [];
                window.FASTPASS_UI.State.pieceIndex = 0;
                log("⚠️ No hi ha Wotts per generar estructura");
            }
            
            // 3. Verificació de projecte existent al destí
            const folderDest = ctx.config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir;
            const projectFiles = await getUtils().readFolder(folderDest);
            const existingProj = window.Scan.selectedProject(projectFiles, ctx.progData.wott, ctx.bloque);
            
            window.FASTPASS_UI.State.activeProjectName = existingProj;
            window.FASTPASS_UI.State.buttonState = existingProj ? "OPEN" : "NEW";

            // Retornem el paquet d'assets per a ús immediat
            return { wotts, media, portada };
        },

        /**
         * _completeSyncUI: Ingesta assets, autocol·loca MP4 i activa targeting.
         */
        _completeSyncUI: async function(ctx, assets) {
            log("🎞️ [SYNC] Ingestant assets i fixant focus...");
            
            // 1. Ingesta (Rètols, Media)
            await FASTPASS_UI.Logic.Project.ingestAssets(ctx, assets.wotts, assets.media, assets.portada);

            // 2. Auto-Insert SRT via createCaptionTrack (API nativa Adobe, inline)
            if (assets.media && assets.media.srt) {
                log("🎞️ Autocol·locant SRT via createCaptionTrack natiu...");
                const escapedSrtName2 = encodeURIComponent(assets.media.srt.name);
                const result = await callJSX(`(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('${escapedSrtName2}'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()`);
                log("🎞️ Resultat autocol·locació SRT: " + result);
                // Desar path del SRT a State per a IN/OUT
                const srtNameEsc = encodeURIComponent(assets.media.srt.name);
                const srtPathRaw2 = await callJSX(`(function(){try{var p=app.project.rootItem;for(var i=0;i<p.children.numItems;i++){var c=p.children[i];if(c.name&&c.name.toUpperCase().indexOf('.SRT')>=0&&(c.type===1||c.type===2)){return c.name+'|'+c.getMediaPath()}}return''}catch(e){return'ERR:'+e.message}})()`);
                /*if (srtPathRaw2 && srtPathRaw2.indexOf('|') > 0) {
                    var parts2 = srtPathRaw2.split('|');
                    if (window.FASTPASS_UI.State) {
                        window.FASTPASS_UI.State.srt = window.FASTPASS_UI.State.srt || {};
                        window.FASTPASS_UI.State.srt.mediaPath = parts2[1];
                        window.FASTPASS_UI.State.srt.name = parts2[0];
                        log("🎞️ SRT mediaPath desat a State: " + parts2[1]);
                    }
                }*/
                // Habilitar botons IN/OUT
                const btnIn = document.getElementById('btnSrtIn');
                const btnOut = document.getElementById('btnSrtOut');
                if (btnIn) btnIn.disabled = false;
                if (btnOut) btnOut.disabled = false;
            }


            // 3. Focus i Targeting
            await callJSX("Tracks.target(1, true, 'video')");
            await callJSX("Tracks.target(1, true, 'audio')");
        },

        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            const idProg = document.getElementById('programa').value;
            const progData = config.mapeoProgramas[idProg];
            // D7.4: Preservar State.dateDir si ja va ser establert (ex: per _runNew() amb data d'emissió).
            // Això evita que _runUpdate/Load/Go sobrescribin la data d'emissió amb la del sistema.
            // Només s'usa getFormattedDate() com a fallback si State.dateDir no existeix (primera càrrega).
            const stateDateDir = (window.FASTPASS_UI && window.FASTPASS_UI.State && window.FASTPASS_UI.State.dateDir);
            const dateDir = stateDateDir || getUtils().getFormattedDate().replace(/["\s]/g, "").trim();

            return {
                config,
                progData,
                programa: idProg,
                bloque: document.getElementById('bloc').value,
                dateDir
            };
        }
    };

    window.FASTPASS_UI.Workflows.MainButton = FASTPASS_UI.Workflows.MainButton;
})();