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
        HANDLE_SECS: 20,

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

        // ----------------------------------------------------------------
        // 4. CÀLCUL DE BOUNDS (inPoint / outPoint AMB HANDLES)
        // ----------------------------------------------------------------

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

        // ----------------------------------------------------------------
        // 5. CONVERSIÓ DE TIMECODE
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
