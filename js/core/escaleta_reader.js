/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader - v1.0.0
 * Mòdul de lectura i parseig dels fitxers JSON d'escaleta
 * Ruta font: \\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    const utils = () => window.FASTPASS_UI.Utils;
    const callJSX = (s) => window.FASTPASS_UI.Utils.callJSX(s);
    const log = (m) => window.FASTPASS_UI.Utils.log(m, 'DEBUG');

    FASTPASS_UI.EscaletaReader = {

        /**
         * Ruta d'escaletes al servidor.
         */
        ESCALETES_PATH: "\\\\public.ad-ccrtv.local\\Public\\VERTICALITZACIO_INFORMATIUS\\ESCALETES",

        /**
         * Handles en segons (marge de seguretat al voltant del TC d'emissió).
         * Es pot sobreescriure amb Config.get().handles
         */
        HANDLE_SECS: 1,

        /**
         * Mapa de duracions reals (en segons) per a cada tipus de careta.
         * La durada al JSON (camp `durada`) no és fiable; aquest mapa conté
         * els valors reals d'emissió coneguts.
         * La majoria de caretes duren 9 segons; CARETA TNV en dura 10.
         */
        CARETA_DURATIONS: {
            "CARETA TNV": 10,
            "CARETA TNMigdia INICI": 9,
            "CARETA ESPORTS": 9,
            "CARETA MÉTEO PRIMAVERA 1": 9,
            "CARETA MÉTEO PRIMAVERA 2": 9,
            "CARETA MÉTEO PRIMAVERA 3": 9,
            "CARETA MÉTEO ESTIU 1": 9,
            "CARETA MÉTEO ESTIU 2": 9,
            "CARETA MÉTEO ESTIU 3": 9,
            "CARETA MÉTEO TARDOR 1": 9,
            "CARETA MÉTEO TARDOR 2": 9,
            "CARETA MÉTEO TARDOR 3": 9,
            "CARETA MÉTEO HIVERN 1": 9,
            "CARETA MÉTEO HIVERN 2": 9,
            "CARETA MÉTEO HIVERN 3": 9,
            "CARETA MÉTEO HIVERN 4": 9,
            "CARETA ANADA A PUBLI": 9,
            "CARETA ANADA PUBLI": 9,
            "CARETA TORNADA PUBLI": 9,
            "CARETA AVANÇ INFORMATIU": 9,
            "CARETA ÚLTIMA HORA": 9,
            "CARETA TNC 3CatInfo": 9,
            "CARETA TNC 3CATINFO SENSE ALPHA": 9,
            "CARETA ENTRADA METEO nous TNS": 9,
            "CARETA MÉTEO ---- 04": 9
        },

        // ----------------------------------------------------------------
        // 1. DESCOBRIR EL JSON MÉS RECENT PER PROGRAMA
        // ----------------------------------------------------------------

        /**
         * findLatest: Llista la carpeta d'escaletes i troba el JSON més recent
         * per al programa indicat.
         * @param {string} programArchivo - e.g. "TN_MIGDIA", "TN_COMARQUES"
         * @returns {Promise<{path:string, filename:string}|null>}
         */
        findLatest: async function (programArchivo) {
            log(`📡 [EscaletaReader] Cercant JSON per a: ${programArchivo}`);
            try {
                // IO.listFolder retorna JSON amb array de {name, path, isDir}
                const raw = await callJSX(`IO.listFolder('${this._escapePath(this.ESCALETES_PATH)}')`);
                if (!raw || raw === '[]' || raw.startsWith('ERR')) {
                    log(`⚠️ [EscaletaReader] No s'ha pogut llistar: ${this.ESCALETES_PATH}`);
                    return null;
                }

                let files;
                try {
                    files = JSON.parse(raw);
                } catch (e) {
                    log(`⚠️ [EscaletaReader] Error parsejant llistat: ${e.message}`);
                    return null;
                }

                // Filtrar: nom que comenci per el prefix del programa i acabi en .json
                // Format: TN_MIGDIA_20260417_153009.json
                const prefix = programArchivo.toUpperCase() + '_';
                const candidates = files.filter(f =>
                    !f.isDir &&
                    f.name.toUpperCase().startsWith(prefix) &&
                    f.name.toLowerCase().endsWith('.json')
                );

                if (candidates.length === 0) {
                    log(`⚠️ [EscaletaReader] Cap JSON trobat per a ${programArchivo}`);
                    return null;
                }

                // Ordenar per nom descendent (el timestamp YYYYMMDD_HHMMSS garanteix ordre cronològic)
                candidates.sort((a, b) => b.name.localeCompare(a.name));
                const best = candidates[0];
                log(`✅ [EscaletaReader] JSON més recent: ${best.name}`);
                return { path: best.path, filename: best.name };

            } catch (e) {
                log(`❌ [EscaletaReader] Error en findLatest: ${e.message}`);
                return null;
            }
        },

        /**
         * getStatus: Obté un estat resumit per al semàfor.
         * @param {string} programArchivo 
         * @param {string} blockId 
         * @returns {Promise<{ found: boolean, ready: boolean, timestamp: string }>}
         */
        getStatus: async function(programArchivo, blockId) {
            const latest = await this.findLatest(programArchivo);
            if (!latest) return { found: false, ready: false };
            
            const data = await this.load(latest.path);
            if (!data) return { found: true, ready: false, filename: latest.filename };
            
            const block = this.getBlock(data, blockId);
            const mediaScan = data?.cleanFeed ?? {};
            
            // Llista de Wotts esperats (línies amb num i que tenen vídeo/gràfic)
            const lines = this.getLinesForBlock(data, blockId);
            const wottsExpected = lines
                .filter(l => l.num && (l.teVideo || ['OFT','BVI'].includes(l.font)))
                .map(l => l.num);

            return {
                found: true,
                ready: !!(block && block.ready),
                filename: latest.filename,
                timestamp: latest.filename.split('_').slice(-2).join('_').replace('.json', ''),
                // Dades per al Semàfor Plus
                mediaStop: mediaScan.mediaStop || null,
                blockOut: block ? block.out : null,
                wottsExpected: [...new Set(wottsExpected)], // Unificats
                totalExpected: wottsExpected.length
            };
        },

        // ----------------------------------------------------------------
        // 2. LLEGIR I PARSEJAR EL JSON
        // ----------------------------------------------------------------

        /**
         * load: Llegeix el JSON des de la ruta UNC via bridge JSX i el parseja.
         * @param {string} jsonPath - ruta UNC completa al fitxer
         * @returns {Promise<Object|null>} - { cleanFeed, parallelAntena, escaleta }
         */
        load: async function (jsonPath) {
            log(`📖 [EscaletaReader] Llegint JSON: ${jsonPath}`);
            try {
                const raw = await callJSX(`IO.readTxt('${this._escapePath(jsonPath)}')`);
                if (!raw || raw === '' || raw.startsWith('ERR')) {
                    log(`⚠️ [EscaletaReader] No s'ha pogut llegir: ${jsonPath}`);
                    return null;
                }
                const data = JSON.parse(raw);
                log(`✅ [EscaletaReader] JSON parsejat. Blocs cleanFeed: ${data?.cleanFeed?.clips?.length ?? 0}`);
                return data;
            } catch (e) {
                log(`❌ [EscaletaReader] Error en load: ${e.message}`);
                return null;
            }
        },

        // ----------------------------------------------------------------
        // 3. ACCESSORS DE DADES
        // ----------------------------------------------------------------

        /**
         * getCleanFeed: Retorna les dades del cleanFeed (MP4 del programa complet).
         * @param {Object} data - JSON parsejat
         * @returns {{ mediaPath, mediaStart, mediaStop, mediaDuration, clips[] }|null}
         */
        getCleanFeed: function (data) {
            return data?.cleanFeed ?? null;
        },

        /**
         * getBlock: Retorna el bloc VERTICAL per ID ("V1", "V2"...).
         * @param {Object} data - JSON parsejat
         * @param {string} blockId - e.g. "V1"
         * @returns {{ id, titol, in, out, ready, creat }|null}
         */
        getBlock: function (data, blockId) {
            const clips = data?.cleanFeed?.clips;
            if (!clips) return null;
            const block = clips.find(c => c.id === blockId);
            if (!block) {
                log(`⚠️ [EscaletaReader] Bloc "${blockId}" no trobat al cleanFeed`);
                return null;
            }
            return block;
        },

        /**
         * getLinesForBlock: Retorna les línies d'escaleta que pertanyen a un bloc.
         * Una línia pertany al bloc si agrupacio coincideix (case-insensitive).
         * Es descarten items amb flotant=true (s'han saltat en l'últim moment i no
         * tenen horaEntradaOnAir, per tant no són rellevants pel càlcul de TCs).
         * @param {Object} data - JSON parsejat
         * @param {string} blockId - e.g. "V1"
         * @returns {Array}
         */
        getLinesForBlock: function (data, blockId) {
            const lines = data?.escaleta?.liniesEscaleta;
            if (!lines) return [];
            const target = blockId.toLowerCase();
            log(`🔍 [EscaletaReader] getLinesForBlock: target="${target}", total lines=${lines.length}`);
            const filtered = lines.filter(l => {
                // Descartar items flotants (s'han saltat en emissió)
                if (l.flotant === true) return false;
                const ag = l.agrupacio;
                return ag && ag.toString().toLowerCase() === target;
            });
            log(`🔍 [EscaletaReader] Filtered count per bloc ${blockId}: ${filtered.length}`);
            return filtered;
        },

        /**
         * getBlockItems: Retorna una taula amb la informació dels items d'un bloc,
         * incloent número de línia, títol, durada, TC i offset relatiu al bloc.
         * @param {Object} data - JSON parsejat
         * @param {string} blockId - e.g. "V1"
         * @returns {Array<{sequencia: number, num: string, titol: string, durada: string, horaEntradaPrevista: string, horaSortidaPrevista: string, offset: number}>}
         */
        getBlockItems: function (data, blockId) {
            const block = this.getBlock(data, blockId);
            if (!block) {
                log(`⚠️ [EscaletaReader] Bloc "${blockId}" no trobat`);
                return [];
            }
            const lines = this.getLinesForBlock(data, blockId);
            const blockStartSec = this.tcToSeconds(block.in);
            const items = lines.map(line => {
                const entrySec = this.tcToSeconds(line.horaEntradaPrevista);
                const offset = entrySec - blockStartSec;
                return {
                    sequencia: line.sequencia,
                    num: line.num || '',
                    titol: line.titol || '',
                    durada: line.durada || '',
                    horaEntradaPrevista: line.horaEntradaPrevista || '',
                    horaSortidaPrevista: line.horaSortidaPrevista || '',
                    offset: offset >= 0 ? offset : 0
                };
            });
            // Ordenar per offset (cronològic)
            items.sort((a, b) => a.offset - b.offset);
            return items;
        },

        /**
         * getProgramName: Retorna el nom del programa (de parallelAntena).
         * @param {Object} data
         * @returns {string}
         */
        getProgramName: function (data) {
            return data?.parallelAntena?.nom ?? '';
        },

        /**
         * calcClipBounds: Calcula l'inPoint i outPoint dins del MP4 del cleanFeed,
         * aplicant els handles de seguretat indicats.
         *
         * Fórmula:
         *   inPoint  = (blockIn  - mediaStart) - handleSecs   [màx 0]
         *   outPoint = (blockOut - mediaStart) + handleSecs   [màx mediaDuration]
         *
         * @param {string} mediaStart - TC inici del MP4 "HH:MM:SS:FF" o "HH:MM:SS"
         * @param {string} blockIn    - Hora d'inici del bloc "HH:MM:SS"
         * @param {string} blockOut   - Hora de fi del bloc "HH:MM:SS"
         * @param {number} [handleSecs] - Handles en segons (per defecte HANDLE_SECS)
         * @param {string} [mediaStop]  - TC de fi del MP4 per truncar outPoint si cal
         * @returns {{ inPoint: number, outPoint: number, duration: number }}
         */
        calcClipBounds: function (mediaStart, blockIn, blockOut, handleSecs, mediaStop) {
            const handles = (handleSecs !== undefined ? handleSecs : this.HANDLE_SECS);
            const msStart = this.tcToSeconds(mediaStart);
            const bIn     = this.tcToSeconds(blockIn);
            const bOut    = this.tcToSeconds(blockOut);

            let inPoint  = Math.max(0, (bIn  - msStart) - handles);
            let outPoint = (bOut - msStart) + handles;

            // Truncar outPoint a la durada del MP4 si tenim mediaStop
            if (mediaStop) {
                const msStop = this.tcToSeconds(mediaStop);
                const maxDur = msStop - msStart;
                if (outPoint > maxDur) outPoint = maxDur;
            }

            const duration = outPoint - inPoint;

            log(`📐 [EscaletaReader] Bounds: mediaStart=${mediaStart} → in=${inPoint.toFixed(2)}s, out=${outPoint.toFixed(2)}s, dur=${duration.toFixed(2)}s (handles=${handles}s)`);
            return { inPoint, outPoint, duration };
        },

        /**
         * parseDurada: Converteix "M:SS" o "H:MM:SS" (formats de playout) a segons.
         * Diferent del TC estàndard perquè pot no tenir hores o frames.
         */
        parseDurada: function (str) {
            if (!str || str === "0:00") return 0;
            const parts = str.toString().split(':');
            if (parts.length === 2) {
                // M:SS
                return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            } else if (parts.length === 3) {
                // H:MM:SS
                return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
            }
            return 0;
        },

        /**
         * getOnAirVideoItems: Retorna els ítems del bloc que tenen vídeo i hora d'emissió real.
         */
        getOnAirVideoItems: function (data, blockId) {
            const lines = this.getLinesForBlock(data, blockId);
            return lines.filter(l => l.teVideo && l.horaEntradaOnAir);
        },

        /**
         * getNeighbourOnAirTimes: Busca els timestamps d'emissió dels blocs adjacents.
         * Útil per tancar fronteres quan el bloc actual comença o acaba sense vídeo.
         */
        getNeighbourOnAirTimes: function (data, blockId) {
            const clips = data?.cleanFeed?.clips || [];
            const idx = clips.findIndex(c => c.id === blockId);
            if (idx === -1) return { prevEnd: null, nextStart: null };

            const prevBlock = idx > 0 ? clips[idx - 1] : null;
            const nextBlock = idx < clips.length - 1 ? clips[idx + 1] : null;

            let prevEnd = null;
            if (prevBlock) {
                const prevLines = this.getOnAirVideoItems(data, prevBlock.id);
                if (prevLines.length > 0) {
                    const lastVid = prevLines[prevLines.length - 1];
                    prevEnd = this.tcToSeconds(lastVid.horaEntradaOnAir) + 
                              this.parseDurada(lastVid.duradaOnAir || lastVid.durada);
                }
            }

            let nextStart = null;
            if (nextBlock) {
                const nextLines = this.getOnAirVideoItems(data, nextBlock.id);
                if (nextLines.length > 0) {
                    nextStart = this.tcToSeconds(nextLines[0].horaEntradaOnAir);
                }
            }

            return { prevEnd, nextStart };
        },

        /**
         * hasNonVideoItemsBefore: Detecta si el bloc té ítems sense vídeo al principi o al final.
         */
        hasNonVideoItemsBefore: function (data, blockId) {
            const lines = this.getLinesForBlock(data, blockId);
            if (lines.length === 0) return { before: false, after: false };

            // Ordenar per sequencia
            lines.sort((a, b) => (a.sequencia || 0) - (b.sequencia || 0));

            const firstVideoIdx = lines.findIndex(l => l.teVideo);
            const lastVideoIdx = [...lines].reverse().findIndex(l => l.teVideo);
            const absoluteLastVideoIdx = lastVideoIdx === -1 ? -1 : lines.length - 1 - lastVideoIdx;

            return {
                before: firstVideoIdx > 0,
                after: absoluteLastVideoIdx !== -1 && absoluteLastVideoIdx < lines.length - 1
            };
        },

        /**
         * calcOnAirBounds: Calcula in/out basats en dades reals de playout (Capa 1+2).
         * Si no hi ha dades OnAir, fa fallback a calcClipBounds.
         */
        calcOnAirBounds: function (data, blockId, mediaStart, mediaStop, cfg) {
            const log = (m) => window.FASTPASS_UI.Utils.log(m, 'DEBUG');
            const videoItems = this.getOnAirVideoItems(data, blockId);
            const msStart = this.tcToSeconds(mediaStart);
            const handles = cfg?.handles || this.HANDLE_SECS;

            if (videoItems.length === 0) {
                log(`⚠️ [calcOnAirBounds] No hi ha ítems amb 'horaEntradaOnAir' al bloc ${blockId}. Usant fallback calcClipBounds.`);
                const block = this.getBlock(data, blockId);
                if (!block) return null;
                const b = this.calcClipBounds(mediaStart, block.in, block.out, handles, mediaStop);
                return { ...b, tcRef: { mediaStart: msStart, inPoint: b.inPoint, clipStart: null, offset: null } };
            }

            const lastVid = videoItems[videoItems.length - 1];
            const firstVideoOnAir = this.tcToSeconds(videoItems[0].horaEntradaOnAir);
            const lastVideoOnAirEnd = this.tcToSeconds(lastVid.horaEntradaOnAir) + 
                                      this.parseDurada(lastVid.duradaOnAir || lastVid.durada);

            const { prevEnd, nextStart } = this.getNeighbourOnAirTimes(data, blockId);
            const { before: hasNonVideoBefore, after: hasNonVideoAfter } = this.hasNonVideoItemsBefore(data, blockId);

            // Capa 1+2 integrada: Detecció de fronteres amb ítems no-video (intro, donapas...)
            let blockOnAirStart;
            if (hasNonVideoBefore && prevEnd != null) {
                blockOnAirStart = prevEnd;
                log(`📐 [calcOnAirBounds] Bloc ${blockId}: items no-video al principi → blockOnAirStart = prevEnd (${prevEnd.toFixed(2)}s)`);
            } else {
                blockOnAirStart = firstVideoOnAir;
            }

            let blockOnAirEnd;
            if (hasNonVideoAfter && nextStart != null) {
                blockOnAirEnd = nextStart;
                log(`📐 [calcOnAirBounds] Bloc ${blockId}: items no-video al final → blockOnAirEnd = nextStart (${nextStart.toFixed(2)}s)`);
            } else {
                blockOnAirEnd = lastVideoOnAirEnd;
            }

            let inPoint  = Math.max(0, (blockOnAirStart - msStart) - handles);
            let outPoint = (blockOnAirEnd - msStart) + handles;

            // Hard limits addicionals per seguretat (mai envair el bloc veí)
            const hardIn  = prevEnd   != null ? (prevEnd   - msStart) - 0.04 : null;
            const hardOut = nextStart != null ? (nextStart - msStart) + 0.04 : null;
            if (hardIn  != null && inPoint  < hardIn)  inPoint  = hardIn;
            if (hardOut != null && outPoint > hardOut) outPoint = hardOut;

            if (mediaStop) {
                const msStop  = this.tcToSeconds(mediaStop);
                const maxDur  = msStop - msStart;
                if (outPoint > maxDur) outPoint = maxDur;
            }

            const duration = outPoint - inPoint;
            const tcRef = {
                mediaStart: msStart,
                inPoint,
                clipStart:  null,
                offset:     null
            };

            log(`📐 [calcOnAirBounds] ${blockId}: inPoint=${inPoint.toFixed(2)}s, outPoint=${outPoint.toFixed(2)}s, dur=${duration.toFixed(2)}s`);
            return { inPoint, outPoint, duration, tcRef };
        },

        // ----------------------------------------------------------------
        // 5. SISTEMA DE PRECISIÓ DE TRIM (3+1 TIERS)
        // ----------------------------------------------------------------

        /**
         * _findCaretasBetween: Busca items amb títol de careta entre dos índexs
         * (exclusiu) dins de allLines i retorna la suma de les seves duracions reals.
         * Les duracions reals es llegeixen del mapa CARETA_DURATIONS (9s cadascuna).
         *
         * @param {Array} allLines - Array complet de liniesEscaleta
         * @param {number} fromIdx - Índex inicial (exclusiu, es busca desde fromIdx+1)
         * @param {number} toIdx   - Índex final (exclusiu, es busca fins a toIdx-1)
         * @returns {{ totalDur: number, names: string[] }}
         */
        _findCaretasBetween: function (allLines, fromIdx, toIdx) {
            let totalDur = 0;
            const names = [];
            for (let i = fromIdx + 1; i < toIdx; i++) {
                const item = allLines[i];
                if (!item || !item.titol) continue;
                // Saltar items flotants (s'han saltat en emissió, no rellevants)
                if (item.flotant === true) continue;
                // Buscar si el títol conté "CARETA" i coincideix amb alguna clau del mapa
                const title = item.titol.trim().toUpperCase();
                for (const key in this.CARETA_DURATIONS) {
                    // Solo match cuando el título del item CONTIENE el nombre de la careta
                    // (ej: "CARETA TNV" está dentro del título del item)
                    // NO al revés: evitar falsos positivos como "TE" → "CARETA MÉTEO..."
                    if (title.indexOf(key.toUpperCase()) !== -1) {
                        const dur = this.CARETA_DURATIONS[key];
                        totalDur += dur;
                        names.push(item.titol);
                        break;
                    }
                }
            }
            return { totalDur, names };
        },

        /**
         * calcPrecisionTrimBounds: Sistema de 4+1 passos per calcular els bounds
         * de trim del MP4 usant els TCs reals dels items emesos (horaEntradaOnAir)
         * en lloc dels TCs del bloc (que porten handles de -1min/+2min).
         *
         * ── Per a l'INICI (IN) ──
         *   Tier 0 (OnAir anterior + caretes): Item anterior (qualsevol bloc) amb
         *                            teVideo=true i horaEntradaOnAir. Es calcula el
         *                            seu final real (OnAir + duradaOnAir) i se li
         *                            SUMEN les duracions reals de les caretes que hi
         *                            hagi entre aquest item i el bloc actual (les
         *                            caretes ocorren just després, no se superposen).
         *                            S'executa SEMPRE en primer lloc.
         *                            Validació de proximitat (MAX_TIER0_GAP_SEC=70s):
         *                            si l'item anterior està massa lluny (ex: tall
         *                            publicitari), es descarta i es continua buscant.
         *   Tier 1 (OnAir al bloc):  Primer item del bloc amb teVideo=true i
         *                            horaEntradaOnAir (només si Tier 0 no ha trobat res).
         *   Tier 1b (block.in):      Quan el bloc NO té cap item amb OnAir, usa
         *                            block.in com a referència (temps planificat exacte).
         *                            Té prioritat sobre Tier 2 perquè block.in és més
         *                            fiable que dades previstes d'items anteriors.
         *   Tier 2 (TC previst):     Item anterior més proper, usant horaSortidaPrevista
         *                            (només si tiers anteriors no han trobat res).
         *
         * ── Per al FINAL (OUT) ──
         *   Tier 1 (OnAir al bloc):  Últim item del bloc amb teVideo=true i
         *                            horaEntradaOnAir + duradaOnAir
         *   Tier 2 (video següent):  Primer item del bloc següent amb teVideo=true
         *                            i horaEntradaOnAir (cerca a allLines)
         *   Tier 2b (bloc següent):  Primer video del bloc següent (per agrupacio)
         *                            amb horaEntradaOnAir
         *   Tier 3 (TC previst):     Últim item del bloc usant horaSortidaPrevista
         *
         * ── Límit superior ──
         *   En lloc d'usar mediaStop (final del MP4 complet, que pot no cobrir
         *   blocs tardans), s'usa block.out com a límit superior específic del bloc.
         *
         * @param {Object} data       - JSON parsejat de l'escaleta
         * @param {string} blockId    - "V1", "V2", etc.
         * @param {string} mediaStart - TC inici del MP4 (ex: "20:59:00:00")
         * @param {string} [mediaStop] - TC fi del MP4 (NO s'usa com a límit, es prefereix block.out)
         * @param {Object} [cfg]      - Configuració (handles en segons)
         *   cfg.inHandles  - Handles IN (marge abans del primer OnAir). Per defecte: 1
         *                     NOTA: En Tier 0 (item anterior amb OnAir), s'aplica un handle
         *                     fix de 2s addicional per marge de seguretat sobre el càlcul
         *                     basat en OnAir + duradaOnAir + caretes.
         *   cfg.outHandles - Handles OUT (marge després del darrer OnAir). Per defecte: 3
         * @returns {{ inPoint: number, outPoint: number, duration: number,
         *            tierIn: number, tierOut: number, tcRef: object }}
         */
        calcPrecisionTrimBounds: function (data, blockId, mediaStart, mediaStop, cfg) {
            const log = (m) => window.FASTPASS_UI.Utils.log(m, 'DEBUG');
            // Handles asimètrics: IN=1s (precisió), OUT=3s (marge)
            const inHandles  = (cfg && cfg.inHandles !== undefined)  ? cfg.inHandles  : 1;
            const outHandles = (cfg && cfg.outHandles !== undefined) ? cfg.outHandles : 3;
            const msStart = this.tcToSeconds(mediaStart);
            const allLines = data?.escaleta?.liniesEscaleta || [];
            const blockLines = this.getLinesForBlock(data, blockId);

            log(`🎯 [PrecisionTrim] Block=${blockId}, linesInBlock=${blockLines.length}, totalLines=${allLines.length}`);

            // ─── Determinar índexs del bloc dins d'allLines ───
            let blockStartIdx = -1;
            let blockEndIdx   = -1;
            if (blockLines.length > 0) {
                const firstBlockLine = blockLines[0];
                const lastBlockLine  = blockLines[blockLines.length - 1];
                blockStartIdx = allLines.indexOf(firstBlockLine);
                blockEndIdx   = allLines.indexOf(lastBlockLine);
            }

            // ================================================================
            // INICI: 4 TIERS (Tier 0 sempre s'intenta primer)
            // ================================================================
            let realStartSec = null;
            let tierIn = 0;

            // Items amb video i OnAir dins del bloc (es reutilitza als càlculs d'IN i OUT)
            const videoItemsInBlock = blockLines.filter(l =>
                l.teVideo === true && l.horaEntradaOnAir
            );

            // ── Tier 0: Item anterior (qualsevol bloc) amb teVideo=true i OnAir ──
            // Aquest Tier s'executa SEMPRE, independentment de si el bloc té video OnAir.
            // Usa el final real (OnAir + duradaOnAir) de l'item anterior amb dades
            // d'emissió, que és el punt més fiable per determinar l'inici del bloc.
            // A continuació, busca si hi ha caretes entre aquest item i el bloc actual
            // i suma les seves duracions reals (del mapa CARETA_DURATIONS).
            // Les caretes NO se superposen amb l'item anterior; ocorren just després.
            //
            // Ex: Si el bloc V1 comença amb "Donapas" (sense video), el Tier 0 troba
            //     l'item "SV ÈDIP I ANTÍGONA" anterior, calcula el seu final real
            //     (21:01:30 + 0:18 = 21:01:48), i suma la durada de la "CARETA TNV"
            //     (10s) que hi ha entremig → 21:01:58 → inPoint=177s.
            if (blockStartIdx > 0) {
                let prevVideoIdx = -1;
                // Obtenir el primer item del bloc per tenir una referència temporal
                const firstBlockItem = blockLines.length > 0 ? blockLines[0] : null;
                const blockRefSec = firstBlockItem && firstBlockItem.horaEntradaPrevista
                    ? this.tcToSeconds(firstBlockItem.horaEntradaPrevista)
                    : null;

                for (let i = blockStartIdx - 1; i >= 0; i--) {
                    const prev = allLines[i];
                    // Saltar items flotants (s'han saltat en emissió, no tenen OnAir real)
                    if (prev.flotant === true) continue;
                    if (prev.teVideo === true && prev.horaEntradaOnAir) {
                        const prevStart = this.tcToSeconds(prev.horaEntradaOnAir);
                        const prevDur   = this.parseDurada(prev.duradaOnAir || prev.durada);
                        const prevEndSec = prevStart + prevDur;

                        // ── Validació de proximitat ──
                        // Si el item anterior amb OnAir està massa lluny del bloc
                        // (ex: separats per un tall publicitari), el seu OnAir no és
                        // rellevant per al càlcul de l'inici del bloc.
                        // Usem com a referència l'horaEntradaPrevista del primer item
                        // del bloc. Si la distància supera els 70s (1 minut i 10s),
                        // descartem aquest item i continuem buscant un de més proper.
                        const MAX_TIER0_GAP_SEC = 70;
                        if (blockRefSec !== null) {
                            const gap = blockRefSec - prevEndSec;
                            if (gap > MAX_TIER0_GAP_SEC) {
                                log(`   ⏭️ Tier0-IN: item anterior "${prev.num}" massa lluny (gap=${gap.toFixed(0)}s > ${MAX_TIER0_GAP_SEC}s). Buscant un de més proper...`);
                                continue; // Seguir buscant un item més proper
                            }
                        }

                        realStartSec = prevEndSec;
                        prevVideoIdx = i;
                        tierIn = 10; // Valor > 0 per evitar que Tier 1/2 sobrescriguin
                        log(`   ✅ Tier0-IN: item anterior "${prev.num}" acaba a ${realStartSec.toFixed(2)}s (OnAir=${prev.horaEntradaOnAir} + dur=${prev.duradaOnAir || prev.durada})`);

                        // Buscar caretes entre l'item anterior i el bloc actual
                        // Les caretes ocorren just després de l'item anterior (no se superposen)
                        const caretas = this._findCaretasBetween(allLines, prevVideoIdx, blockStartIdx);
                        if (caretas.totalDur > 0) {
                            realStartSec += caretas.totalDur;
                            log(`   📺 Tier0-IN: +${caretas.totalDur}s per caretes trobades: [${caretas.names.join(', ')}] → realStartSec=${realStartSec.toFixed(2)}s`);
                        }

                        // Handle de seguretat de 2s per garantir que el clip comenci
                        // lleugerament abans del punt calculat (marge contra imprecisions
                        // de duradaOnAir, arrodoniments, etc.)
                        realStartSec -= 2;
                        log(`   🔧 Tier0-IN: handle -2s de seguretat → realStartSec=${realStartSec.toFixed(2)}s`);
                        break;
                    }
                }
            }

            // ── Tier 1: Primer video amb OnAir dins del bloc ──
            // Només si Tier 0 no ha trobat res (tierIn === 0)
            if (tierIn === 0) {
                if (videoItemsInBlock.length > 0) {
                    const firstVid = videoItemsInBlock[0];
                    realStartSec = this.tcToSeconds(firstVid.horaEntradaOnAir);
                    tierIn = 1;
                    log(`   ✅ Tier1-IN: "${firstVid.num}" OnAir=${firstVid.horaEntradaOnAir} → ${realStartSec.toFixed(2)}s`);
                }
            }

            // ── Tier 1b: Usar block.in com a referència ──
            // Quan el bloc NO té cap item amb OnAir (emissió real), els Tiers 0 i 1
            // no poden determinar l'inici. En aquest cas, block.in és la millor
            // referència perquè representa el temps planificat exacte del bloc.
            // Aquest Tier té prioritat sobre Tier 2 (que usa dades previstes d'items
            // anteriors) perquè block.in és més fiable per blocs sense OnAir.
            if (tierIn === 0 && videoItemsInBlock.length === 0) {
                const block = this.getBlock(data, blockId);
                if (block && block.in) {
                    realStartSec = this.tcToSeconds(block.in);
                    tierIn = 1;
                    log(`   ✅ Tier1b-IN: bloc sense OnAir, usant block.in="${block.in}" → ${realStartSec.toFixed(2)}s`);
                }
            }

            // ── Tier 2: Item anterior (qualsevol), usar horaSortidaPrevista ──
            // Només si Tier 0, Tier 1 i Tier 1b no han trobat res
            if (tierIn === 0 && blockStartIdx > 0) {
                // Buscar cap enrere el primer item NO flotant
                let prev = null;
                for (let i = blockStartIdx - 1; i >= 0; i--) {
                    const candidate = allLines[i];
                    if (candidate.flotant === true) continue;
                    prev = candidate;
                    break;
                }
                if (prev) {
                    if (prev.horaSortidaPrevista && prev.horaSortidaPrevista !== "00:00:00") {
                        realStartSec = this.tcToSeconds(prev.horaSortidaPrevista);
                        tierIn = 2;
                        log(`   ✅ Tier2-IN: item anterior sortida prevista="${prev.horaSortidaPrevista}" → ${realStartSec.toFixed(2)}s`);
                    } else if (prev.horaEntradaPrevista && prev.horaEntradaPrevista !== "00:00:00") {
                        const prevStart = this.tcToSeconds(prev.horaEntradaPrevista);
                        const prevDur   = this.parseDurada(prev.durada);
                        realStartSec = prevStart + prevDur;
                        tierIn = 2;
                        log(`   ⚠️ Tier2-IN: item anterior sense sortida, usant entrada+durada="${prev.horaEntradaPrevista}"+${prev.durada} → ${realStartSec.toFixed(2)}s`);
                    }
                }
            }

            // ── Fallback absolut: primer item del bloc, horaEntradaPrevista ──
            if (tierIn === 0 && blockLines.length > 0) {
                const first = blockLines[0];
                if (first.horaEntradaPrevista && first.horaEntradaPrevista !== "00:00:00") {
                    realStartSec = this.tcToSeconds(first.horaEntradaPrevista);
                    tierIn = -1;
                    log(`   ⚠️ Fallback-IN: primer item entrada prevista="${first.horaEntradaPrevista}" → ${realStartSec.toFixed(2)}s`);
                }
            }

            // ── Si encara no tenim start, usar block.in amb avís ──
            if (tierIn === 0) {
                const block = this.getBlock(data, blockId);
                if (block && block.in) {
                    realStartSec = this.tcToSeconds(block.in);
                    tierIn = -2;
                    log(`   ⚠️ Fallback-BLOCK: usant block.in="${block.in}" → ${realStartSec.toFixed(2)}s`);
                } else {
                    log(`   ❌ No es pot determinar l'inici del bloc ${blockId}`, 'ERROR');
                    return null;
                }
            }

            // ================================================================
            // FINAL: 3 TIERS
            // ================================================================
            let realEndSec = null;
            let tierOut = 0;

            // ── Tier 1: Últim video amb OnAir dins del bloc ──
            if (videoItemsInBlock.length > 0) {
                const lastVid = videoItemsInBlock[videoItemsInBlock.length - 1];
                const lastStart = this.tcToSeconds(lastVid.horaEntradaOnAir);
                const lastDur   = this.parseDurada(lastVid.duradaOnAir || lastVid.durada);
                realEndSec = lastStart + lastDur;
                tierOut = 1;
                log(`   ✅ Tier1-OUT: "${lastVid.num}" OnAir=${lastVid.horaEntradaOnAir}+dur=${lastVid.duradaOnAir || lastVid.durada} → ${realEndSec.toFixed(2)}s`);
            }

            // ── Tier 2: Primer item del bloc següent amb video i OnAir ──
            if (tierOut === 0 && blockEndIdx >= 0 && blockEndIdx < allLines.length - 1) {
                for (let i = blockEndIdx + 1; i < allLines.length; i++) {
                    const next = allLines[i];
                    // Saltar items flotants (s'han saltat en emissió)
                    if (next.flotant === true) continue;
                    if (next.teVideo === true && next.horaEntradaOnAir) {
                        realEndSec = this.tcToSeconds(next.horaEntradaOnAir);
                        tierOut = 2;
                        log(`   ✅ Tier2-OUT: item següent "${next.num}" comença a ${realEndSec.toFixed(2)}s (OnAir=${next.horaEntradaOnAir})`);
                        break;
                    }
                }
            }

            // ── Tier 2b: Si el bloc següent (per agrupacio) tè primer video ──
            if (tierOut === 0) {
                const clips = data?.cleanFeed?.clips || [];
                const idx = clips.findIndex(c => c.id === blockId);
                if (idx >= 0 && idx < clips.length - 1) {
                    const nextBlockId = clips[idx + 1].id;
                    const nextBlockLines = this.getLinesForBlock(data, nextBlockId);
                    const nextVideos = nextBlockLines.filter(l =>
                        l.teVideo === true && l.horaEntradaOnAir
                    );
                    if (nextVideos.length > 0) {
                        realEndSec = this.tcToSeconds(nextVideos[0].horaEntradaOnAir);
                        tierOut = 2;
                        log(`   ✅ Tier2b-OUT: primer video del bloc següent ${nextBlockId} comença a ${realEndSec.toFixed(2)}s (OnAir=${nextVideos[0].horaEntradaOnAir})`);
                    }
                }
            }

            // ── Tier 3: Últim item del bloc, horaSortidaPrevista ──
            if (tierOut === 0 && blockLines.length > 0) {
                const last = blockLines[blockLines.length - 1];
                if (last.horaSortidaPrevista && last.horaSortidaPrevista !== "00:00:00") {
                    realEndSec = this.tcToSeconds(last.horaSortidaPrevista);
                    tierOut = 3;
                    log(`   ✅ Tier3-OUT: últim item sortida prevista="${last.horaSortidaPrevista}" → ${realEndSec.toFixed(2)}s`);
                } else if (last.horaEntradaPrevista && last.horaEntradaPrevista !== "00:00:00") {
                    const lastStart = this.tcToSeconds(last.horaEntradaPrevista);
                    const lastDur   = this.parseDurada(last.durada);
                    realEndSec = lastStart + lastDur;
                    tierOut = 3;
                    log(`   ⚠️ Tier3-OUT: últim item sense sortida, entrada+durada="${last.horaEntradaPrevista}"+${last.durada} → ${realEndSec.toFixed(2)}s`);
                }
            }

            // ── Fallback absolut: block.out ──
            if (tierOut === 0) {
                const block = this.getBlock(data, blockId);
                if (block && block.out) {
                    realEndSec = this.tcToSeconds(block.out);
                    tierOut = -2;
                    log(`   ⚠️ Fallback-OUT: usant block.out="${block.out}" → ${realEndSec.toFixed(2)}s`);
                } else {
                    log(`   ❌ No es pot determinar el final del bloc ${blockId}`, 'ERROR');
                    return null;
                }
            }

            // ================================================================
            // CONVERSIÓ A BOUNDS RELATIUS AL MP4
            // ================================================================
            // Handles asimètrics: IN precís (1s), OUT amb marge (3s)
            let inPoint  = Math.max(0, (realStartSec - msStart) - inHandles);
            let outPoint = (realEndSec - msStart) + outHandles;

            // ── Límit per block.out (específic del bloc) ──
            // En lloc d'usar mediaStop (que és el final del MP4 complet i pot no
            // cobrir blocs tardans com V4), usem block.out com a límit superior.
            // Si el bloc no té OnAir, block.out és la millor referència disponible.
            const block = this.getBlock(data, blockId);
            if (block && block.out) {
                const blockOutSec = this.tcToSeconds(block.out);
                const blockMaxDur = blockOutSec - msStart;
                if (outPoint > blockMaxDur) {
                    log(`   📐 Limitant outPoint per block.out="${block.out}" → ${blockMaxDur.toFixed(2)}s (era ${outPoint.toFixed(2)}s)`);
                    outPoint = blockMaxDur;
                }
            }

            // Garantir que inPoint < outPoint
            if (inPoint >= outPoint) {
                log(`   ⚠️ inPoint (${inPoint.toFixed(2)}s) >= outPoint (${outPoint.toFixed(2)}s). Ajustant...`);
                outPoint = inPoint + 1.0; // mínim 1 segon
            }

            const duration = outPoint - inPoint;
            const tcRef = {
                mediaStart: msStart,
                inPoint:    inPoint,
                realStart:  realStartSec,
                realEnd:    realEndSec,
                tierIn:     tierIn,
                tierOut:    tierOut,
                clipStart:  null,
                offset:     null
            };

            log(`📐 [PrecisionTrim] ${blockId}: IN-tier=${tierIn} OUT-tier=${tierOut} | inPoint=${inPoint.toFixed(2)}s outPoint=${outPoint.toFixed(2)}s dur=${duration.toFixed(2)}s (inHandles=${inHandles}s outHandles=${outHandles}s)`);
            log(`📐 [PrecisionTrim] TCs reals: start=${this.secondsToTC(realStartSec)} end=${this.secondsToTC(realEndSec)}`);

            return { inPoint, outPoint, duration, tierIn, tierOut, tcRef };
        },

        /**
         * secondsToTC: Converteix segons a timecode "HH:MM:SS" (sense frames).
         * @param {number} sec
         * @returns {string}
         */
        secondsToTC: function (sec) {
            if (sec === null || sec === undefined || isNaN(sec)) return "00:00:00";
            const hh = Math.floor(sec / 3600);
            const mm = Math.floor((sec % 3600) / 60);
            const ss = Math.floor(sec % 60);
            return (hh < 10 ? '0' : '') + hh + ':' +
                   (mm < 10 ? '0' : '') + mm + ':' +
                   (ss < 10 ? '0' : '') + ss;
        },

        // ----------------------------------------------------------------
        // 6. CONVERSIÓ DE TIMECODE (original)
        // ----------------------------------------------------------------

        /**
         * tcToSeconds: Converteix un timecode a segons.
         * Accepta formats: "HH:MM:SS", "HH:MM:SS:FF", "H:MM:SS"
         * @param {string} tc
         * @param {number} [fps=25]
         * @returns {number}
         */
        tcToSeconds: function (tc, fps) {
            if (!tc) return 0;
            fps = fps || 25;
            const parts = tc.split(':');
            if (parts.length === 3) {
                // HH:MM:SS
                return parseInt(parts[0], 10) * 3600
                     + parseInt(parts[1], 10) * 60
                     + parseInt(parts[2], 10);
            } else if (parts.length === 4) {
                // HH:MM:SS:FF
                return parseInt(parts[0], 10) * 3600
                     + parseInt(parts[1], 10) * 60
                     + parseInt(parts[2], 10)
                     + parseInt(parts[3], 10) / fps;
            }
            return 0;
        },

        // ----------------------------------------------------------------
        // 6. HELPER D'ESCAPAMENT DE RUTA
        // ----------------------------------------------------------------

        /**
         * _escapePath: Escapa les barres invertides per a l'ús en callJSX.
         * @param {string} p
         * @returns {string}
         */
        _escapePath: function (p) {
            return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;

    // Alias global per accés directe
    window.EscaletaReader = FASTPASS_UI.EscaletaReader;

})();
