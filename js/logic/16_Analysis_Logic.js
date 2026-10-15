/**
 * ============================================================================
 * LOGIC: ANALYSIS - v1.1.0
 * Sistema de Depuración y Análisis de Marcadores de Ítems
 * Gestiona el archivo JSON de análisis con 4 fases:
 *   escaleta, crudo, cocinado, usuario
 * Cada fase usa MERGE para acumular sub-datos (inout + marks)
 * ============================================================================
 */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const callJSX = (s) => window.FASTPASS_UI.Utils.callJSX(s);
    const log = (m) => window.FASTPASS_UI.Utils.log(m, 'DEBUG');

    FASTPASS_UI.Logic.Analysis = {

        /**
         * Genera la ruta del archivo JSON de análisis.
         * Formato: <carpeta del BLOC>/analisis_estructura/[DD_MM]_[PROG]_[BLOC].json
         * (2026-09-24) Ruta ABSOLUTA dins la carpeta del bloc: abans era relativa i
         * el fitxer podia acabar en qualsevol directori de treball de Premiere.
         */
        _getPath: function (ctx) {
            const dd_mm = ctx.dateDir.substring(0, 5);
            const base  = window.FASTPASS_UI.Utils.workFolder(ctx);
            return base + '/analisis_estructura/' + dd_mm + '_' + ctx.progData.archivo + '_' + ctx.bloque + '.json';
        },

        /**
         * Carga el archivo JSON de análisis existente, o retorna objeto vacío.
         */
        _load: async function (path) {
            // (2026-10-02) IO.readTxt llegeix amb ANSI: els títols amb accents de l'anàlisi
            // tornaven malmesos (i el re-desar els fixava definitivament).
            const raw = window.FASTPASS_UI.Utils._fromMojibake(await callJSX("IO.readTxt('" + path + "')"), 'analisi');
            if (!raw || raw.startsWith('ERR') || raw === '') return {};
            try { return JSON.parse(raw); } catch (e) { return {}; }
        },

        /**
         * Guarda el objeto data como JSON en la ruta especificada.
         */
        _save: async function (path, data) {
            const json    = JSON.stringify(data, null, 2);
            // (2026-10-13) El payload viaja DENTRO de un literal de cadena JSX: los saltos
            // de línea del pretty-print (indent 2) rompen el literal → evalScript falla y
            // el fichero NO se escribe nunca (todas las carpetas analisis_estructura del
            // NAS estaban creadas y vacías, del 2026-09-29 al 2026-10-13). Misma receta
            // que flow_markers.js:3288 / Utils.escape.
            const escaped = json.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
            // (2026-09-24) La carpeta del bloc (o la seva subcarpeta analisis_estructura)
            // pot no existir encara al primer run → la creem ABANS d'escriure.
            try {
                const dir = path.substring(0, path.lastIndexOf('/'));
                if (dir) await window.FASTPASS_UI.Utils.ensureFolders(dir);
            } catch (eF) { /* noop */ }
            const wRes = await callJSX("IO.writeTxt('" + path + "', '" + escaped + "')");
            if (typeof wRes === 'string' && wRes.indexOf('ERR') === 0) {
                log("⚠️ [Analysis] IO.writeTxt ha fallat: " + wRes + " → " + path);
            }
        },

        /**
         * Fase 1: Guarda los datos de escaleta al final de _runNew().
         * @param {Object} ctx - Contexto del workflow
         * @param {string} escaletaFile - Nombre del archivo JSON de escaleta
         * @param {Array} lines - Líneas del bloque (getLinesForBlock)
         * @param {Object} contextItems - Items de contexto (prevVideoItem, nextVideoItem)
         * @param {Object} trimBounds - Resultado de calcPrecisionTrimBounds
         */
        saveEscaleta: async function (ctx, escaletaFile, lines, contextItems, trimBounds) {
            const path = this._getPath(ctx);
            const ex   = await this._load(path);
            const now  = new Date().toISOString();

            // Construir itemsBloc a partir de lines
            var itemsBloc = [];
            for (var i = 0; i < lines.length; i++) {
                var l = lines[i];
                itemsBloc.push({
                    sequencia: l.sequencia,
                    num: l.num || '',
                    titol: l.titol || '',
                    agrupacio: l.agrupacio || null,
                    durada: l.durada || '0:00',
                    duradaOnAir: l.duradaOnAir || null,
                    horaEntradaPrevista: l.horaEntradaPrevista || null,
                    horaSortidaPrevista: l.horaSortidaPrevista || null,
                    horaEntradaOnAir: l.horaEntradaOnAir || null,
                    teVideo: l.teVideo || false,
                    flotant: l.flotant || false
                });
            }

            await this._save(path, {
                ...ex,
                meta: {
                    ...(ex.meta || {}),
                    prog: ctx.progData.archivo,
                    bloc: ctx.bloque,
                    data: ctx.dateDir.substring(0, 5),
                    escaletaFile: escaletaFile,
                    generatedAt: ex.meta ? (ex.meta.generatedAt || now) : now,
                    lastUpdatedAt: now,
                    phases: { ...((ex.meta && ex.meta.phases) || {}), escaleta: true }
                },
                escaleta: {
                    itemsBloc: itemsBloc,
                    itemsContexte: contextItems || {},
                    trimBounds: trimBounds || null
                }
            });
            log("📊 [Analysis] escaleta → " + path);
        },

        /**
         * Fases 2-4: Añade datos a una fase del JSON de análisis con merge.
         * Las 4 fases son: escaleta, crudo, cocinado, usuario.
         * Cada una acumula sub-datos (inout + marks) mediante Object.assign.
         * @param {Object} ctx - Contexto del workflow
         * @param {string} phaseName - Nombre de la fase (crudo, cocinado, usuario)
         * @param {Object} phaseData - Sub-datos de la fase
         */
        appendPhase: async function (ctx, phaseName, phaseData) {
            const path = this._getPath(ctx);
            const ex   = await this._load(path);
            const now  = new Date().toISOString();

            // MERGE en lugar de REPLACE: permite múltiples sub-fases (inout, marks)
            // dentro de la misma fase (crudo, cocinado, usuario).
            const mergedPhaseData = { ...(ex[phaseName] || {}), ...phaseData };

            await this._save(path, {
                ...ex,
                meta: {
                    ...(ex.meta || {}),
                    lastUpdatedAt: now,
                    phases: { ...((ex.meta && ex.meta.phases) || {}), [phaseName]: true }
                },
                [phaseName]: mergedPhaseData
            });
            log("📊 [Analysis] " + phaseName + " → " + path);
        }
    };

    window.FASTPASS_UI.Logic.Analysis = FASTPASS_UI.Logic.Analysis;
})();
