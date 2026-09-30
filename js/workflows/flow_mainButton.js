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

        /**
         * _escaletaFromLaterBlock: (2026-09-22) Quan NO hi ha escaleta del NOSTRE bloc, busca al NAS
         * una escaleta del MATEIX DIA i del MATEIX PROGRAMA d'un bloc POSTERIOR (V4, V5...) — que ja
         * conté els ítems del nostre bloc — i la copia al directori del projecte.
         *
         * Ordre oficial de resolució de l'escaleta (indicat per l'usuari):
         *   1) escaleta del nostre bloc
         *   2) escaleta d'un bloc POSTERIOR (se n'extreu el nostre bloc amb getLinesForBlock)
         *   3) FOTO via API de digition (escaleta_on_demand_*)
         * Mai no s'usa una escaleta d'un bloc ANTERIOR (no té els nostres ítems).
         *
         * @param {Object} ctx - {config, progData, bloque, dateDir}
         * @param {string} datePrefix - YYYYMMDD del dia de treball
         * @returns {Promise<{path:string, filename:string, blockId:string}|null>}
         */
        _escaletaFromLaterBlock: async function (ctx, datePrefix) {
            const reader = window.EscaletaReader || (window.FASTPASS_UI && window.FASTPASS_UI.EscaletaReader);
            if (!reader || typeof reader._listEscaletas !== 'function' || typeof reader.extractBlockIdFromFilename !== 'function') {
                return null;
            }
            const ourNum = parseInt(String(ctx.bloque || '').replace(/\D/g, ''), 10);
            if (!ourNum) return null;
            let listing = null;
            try { listing = await reader._listEscaletas(); } catch (eL) { return null; }
            if (!listing || !listing.raw) return null;
            let files = [];
            try { files = JSON.parse(listing.raw) || []; } catch (eP) { return null; }
            const prog = String(ctx.progData.archivo || '').toUpperCase();
            const base = String(listing.path || '').replace(/[\\/]+$/, '') + '\\';
            const cands = [];
            for (let i = 0; i < files.length; i++) {
                const name = String(files[i].name || '');
                if (!/\.json$/i.test(name)) continue;
                if (name.indexOf('escaleta_on_demand') === 0) continue;          // les FOTO no porten bloc
                if (datePrefix && name.indexOf(datePrefix) === -1) continue;      // NOMÉS el mateix dia
                if (prog && name.toUpperCase().indexOf(prog) === -1) continue;    // mateix programa
                const bid = reader.extractBlockIdFromFilename(name);
                const num = parseInt(String(bid || '').replace(/\D/g, ''), 10);
                if (!num || !(num > ourNum)) continue;                            // NOMÉS blocs POSTERIORS
                cands.push({ name: name, path: base + name, blockId: bid, num: num });
            }
            if (cands.length === 0) return null;
            // El MÉS RECENT (nom porta YYYYMMDD_HHMMSS → ordre alfabètic = cronològic)
            cands.sort(function (a, b) { return (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0); });
            const best = cands[cands.length - 1];
            // Copiar al directori del projecte (la extensió treballa sempre amb la còpia local)
            try {
                const folderPath = getUtils().workFolder(ctx);
                await callJSX("IO.createFolder('" + reader._escapePath(folderPath) + "')");
                const destPath = folderPath.replace(/[\\/]+$/, '') + '\\' + best.name;
                const copyRes = await callJSX("IO.copyFile('" + reader._escapePath(best.path) + "', '" + reader._escapePath(destPath) + "')");
                if (copyRes !== 'OK') {
                    log('⚠️ [NOU] No s\'ha pogut copiar l\'escaleta del bloc ' + best.blockId + ': ' + copyRes, 'WARN');
                    return null;
                }
                log('📁 [NOU] Escaleta del bloc posterior ' + best.blockId + ' copiada al projecte: ' + best.name);
                return { path: destPath, filename: best.name, blockId: best.blockId };
            } catch (eC) {
                log('⚠️ [NOU] Error copiant escaleta de bloc posterior: ' + eC.message, 'WARN');
                return null;
            }
        },

        /**
         * _photoEscaleta: Genera una escaleta "on demand" via API de digition per al context
         * actual — exactament el mateix que fa el botó FOTO — i la deixa al directori del projecte
         * (escaleta_on_demand_*.json, que MANA sobre les del NAS).
         * (2026-09-22) S'usa com a FALLBACK quan no hi ha escaleta del bloc demanat.
         * @param {Object} ctx - {config, progData, bloque, dateDir}
         * @returns {Promise<{ok:boolean, filename:(string|null), error:(string|null)}>}
         */
        _photoEscaleta: async function (ctx) {
            const reader = window.EscaletaReader || (window.FASTPASS_UI && window.FASTPASS_UI.EscaletaReader);
            if (!reader || typeof reader.fetchNewEscaleta !== 'function') {
                return { ok: false, filename: null, error: 'fetchNewEscaleta no disponible' };
            }
            if (!ctx || !ctx.progData || !ctx.dateDir || !ctx.config) {
                return { ok: false, filename: null, error: 'context incomplet' };
            }
            const folderDest = getUtils().workFolder(ctx);
            try {
                getUtils().status('📷 Escaleta del bloc ' + ctx.bloque + ': fent FOTO…', 'procesando');
                log("📷 [FOTO·auto] Petició a l'API d'escaletes: " + ctx.progData.archivo + ' / ' + ctx.bloque + ' / ' + ctx.dateDir);
                // Guarda de temps (igual que el botó FOTO): el handshake TLS amb digition
                // pot trigar ~26 s en aquesta xarxa i es proven 2-3 candidats d'escaletaId.
                const FOTO_TIMEOUT_MS = 180000;
                const res = await Promise.race([
                    reader.fetchNewEscaleta(
                        ctx.progData.escaletaId || null,
                        ctx.dateDir,
                        ctx.progData.archivo,
                        ctx.bloque,
                        folderDest
                    ),
                    new Promise(function (resolve) { setTimeout(function () { resolve('__TIMEOUT__'); }, FOTO_TIMEOUT_MS); })
                ]);
                if (res === '__TIMEOUT__') {
                    return { ok: false, filename: null, error: "l'API no ha respost en " + (FOTO_TIMEOUT_MS / 1000) + 's' };
                }
                if (res && res.filename) {
                    log('✅ [FOTO·auto] Escaleta generada: ' + res.filename);
                    log('   📂 [FOTO·auto] Es guarda al DIRECTORI DEL PROJECTE (no al NAS): ' + folderDest + '\\' + res.filename);
                    getUtils().status('📷 Escaleta nova guardada: ' + res.filename, 'exito');
                    return { ok: true, filename: res.filename, error: null };
                }
                return { ok: false, filename: null, error: "l'API no ha donat escaleta (motiu de digition al log)" };
            } catch (e) {
                return { ok: false, filename: null, error: e.message };
            }
        },

        _runNew: async function () {
            try {
                const ctx = await this._setupContext();

                // ── MECÀNICA D'INICI (2026-09-04) ─────────────────────────────────
                // dateDir ve DECIDIT des de checkContext: HOY per defecte, o AHIR
                // si es va fer Ctrl+clic a MAIN. No es dedueix ni es corregeix aquí
                // (eliminat l'antic D7.1 i el fallback a AHIR de la finestra 22h).
                log('[dateDir] Data de treball: ' + ctx.dateDir + ' (fixada a checkContext)');

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
                        // ─── ESCALETA LOCAL (DIRECTORI DEL PROJECTE) ──
                        // La extensió treballa SEMPRE amb la còpia de l'escaleta al directori
                        // del projecte (tant si ve del NAS copiada com si la genera el botó Foto).
                        // ensureLocalCopy: busca local i, si no hi és, la baixa del NAS i la copia.
                        jsonMeta = await reader.ensureLocalCopy(ctx, datePrefixJson);
                        if (jsonMeta) {
                            jsonData = await reader.load(jsonMeta.path);
                        }

                        // ── GUARDA DE BLOC/DIA + FOTO AUTOMÀTICA (2026-09-22) ──────────────
                        // L'escaleta ha de ser DEL BLOC DEMANAT i del DIA demanat. Si el que hi ha
                        // és d'un altre bloc (p.ex. V2 quan es demana el V3) NO serveix per a res:
                        // el tema s'ha d'inventar des dels chyrons i acaba en una paraula reservada
                        // (INTRO) → avortament. En aquest cas es fa una FOTO automàtica (mateixa via
                        // que el botó FOTO) i es torna a carregar. Si la FOTO tampoc no en dona,
                        // s'avorta amb el motiu real de l'API de digition.
                        // ── RESOLUCIÓ DE L'ESCALETA: ORDRE OFICIAL (2026-09-22) ────────────────
                        //   1) escaleta del NOSTRE bloc (la carregada)
                        //   2) escaleta d'un bloc POSTERIOR del mateix dia (conté el nostre bloc:
                        //      se n'extreuen els ítems amb getLinesForBlock)
                        //   3) FOTO via API de digition (escaleta_on_demand_*)
                        // MAI una escaleta d'un bloc ANTERIOR: no té els nostres ítems, el tema
                        // s'havia d'inventar i acabava en paraula reservada (INTRO) → avortament.
                        var escNom = String((jsonMeta && (jsonMeta.name || jsonMeta.path)) || '');
                        var isOnDemand = escNom.indexOf('escaleta_on_demand') !== -1;   // ja ve de la FOTO
                        var ourNum = parseInt(String(ctx.bloque || '').replace(/\D/g, ''), 10) || 0;
                        var escBid = (reader.extractBlockIdFromFilename && escNom) ? reader.extractBlockIdFromFilename(escNom) : null;
                        var escNum = parseInt(String(escBid || '').replace(/\D/g, ''), 10) || 0;
                        var escDelDia = isOnDemand || !datePrefixJson || escNom.indexOf(datePrefixJson) !== -1;
                        // Serveix si: ve de la FOTO, o és del mateix bloc, o és d'un bloc POSTERIOR del dia.
                        var escaletaOk = !!(jsonData) && (isOnDemand || (escDelDia && escNum > 0 && escNum >= ourNum));

                        if (!escaletaOk) {
                            log('⚠️ [NOU] Escaleta no utilitzable per al bloc ' + ctx.bloque + ' (' +
                                (escNom.split(/[\\\/]/).pop() || 'cap escaleta') + ') → provant blocs posteriors', 'WARN');
                            // ── 2) BLOC POSTERIOR del mateix dia (que ja conté el nostre bloc) ──
                            var laterMeta = await this._escaletaFromLaterBlock(ctx, datePrefixJson);
                            if (laterMeta) {
                                jsonMeta = laterMeta;
                                jsonData = await reader.load(laterMeta.path);
                                escaletaOk = !!jsonData;
                                if (escaletaOk) {
                                    log('📋 [NOU] Escaleta del bloc ' + laterMeta.blockId + ' (posterior) → se n\'extreu el bloc ' + ctx.bloque);
                                }
                            } else {
                                jsonData = null;   // descartem explícitament l'escaleta d'un bloc anterior
                            }
                        }

                        if (!escaletaOk || !jsonData) {
                            // ── 3) FOTO via API de digition (últim recurs) ──
                            log('📷 [NOU] Cap escaleta utilizable per al bloc ' + ctx.bloque + ' (ni del bloc, ni posterior) → FOTO automàtica', 'WARN');
                            var fotoAuto = await this._photoEscaleta(ctx);
                            if (!fotoAuto.ok) {
                                log('⛔ [NOU] Sense escaleta del bloc ' + ctx.bloque + ' i la FOTO ha fallat: ' + fotoAuto.error, 'ERROR');
                                getUtils().status("Bloc " + ctx.bloque + ": no hi ha escaleta i la FOTO ha fallat (" + fotoAuto.error + ")", "error");
                                return;
                            }
                            jsonMeta = await reader.ensureLocalCopy(ctx, datePrefixJson);
                            jsonData = jsonMeta ? await reader.load(jsonMeta.path) : null;
                            if (!jsonData) {
                                log('⛔ [NOU] La FOTO ha generat ' + fotoAuto.filename + ' però no s\'ha pogut carregar.', 'ERROR');
                                getUtils().status("Bloc " + ctx.bloque + ": la FOTO no ha deixat una escaleta carregable", "error");
                                return;
                            }
                            log('📷 [NOU] Escaleta de la FOTO carregada: ' + ((jsonMeta && jsonMeta.name) || fotoAuto.filename));
                            // (2026-09-22) Comprovem que la nova escaleta contingui REALMENT el nostre bloc
                            // (cleanFeed.clips porta una entrada per bloc: V1, V2, V3...).
                            try {
                                const clipsCF = (jsonData && jsonData.cleanFeed && jsonData.cleanFeed.clips) || [];
                                const blocCF = clipsCF.filter(function (c) {
                                    return String(c.id || '').toUpperCase() === String(ctx.bloque).toUpperCase();
                                })[0];
                                if (blocCF) {
                                    log('   ✅ [FOTO·auto] Conté el bloc ' + ctx.bloque + ': ' + blocCF.titol + ' (' + blocCF.in + ' → ' + blocCF.out + ')');
                                } else {
                                    log('   ⚠️ [FOTO·auto] La nova escaleta NO porta el bloc ' + ctx.bloque +
                                        ' (blocs: ' + clipsCF.map(function (c) { return c.id; }).join(', ') + ')', 'WARN');
                                }
                            } catch (eCF) { }
                        }
                        if (jsonMeta && jsonData) {
                            if (jsonData) {
                                var lines = reader.getLinesForBlock(jsonData, ctx.bloque);
                                lines.sort(function (a, b) {
                                    var ta = reader.tcToSeconds(a.horaEntradaOnAir || a.horaEntradaPrevista || '00:00:00');
                                    var tb = reader.tcToSeconds(b.horaEntradaOnAir || b.horaEntradaPrevista || '00:00:00');
                                    return ta - tb;
                                });
                                var firstStructural = null;
                                var firstOffOfd = null;
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
                                    if (!firstStructural) {
                                        firstStructural = { titol: item.titol, num: item.num };
                                    }
                                    var fontU = String(item.font || '').toUpperCase().trim();
                                    if (!firstOffOfd && (fontU === 'OFF' || fontU === 'OFD')) {
                                        firstOffOfd = { titol: item.titol, num: item.num, font: fontU };
                                    }
                                    if (!isReserved && upper.length > 2) {
                                        sanitizedTheme = getUtils().sanitizeName(item.titol).toUpperCase();
                                        log('🏷️ [Theme] Tema extret del JSON: "' + sanitizedTheme + '" (item ' + (item.num || '?') + ')');
                                        break;
                                    }
                                }
                                // ── Reconstrucció de tema (2026-09-07) ─────────────────
                                // Si tots els items estructurals del bloc tenen títol amb
                                // token reservat (ex: V1 = GF/INTRO/DIFERIT/IPD/INSERT),
                                // es prioritza l'item OFF/OFD del bloc; si no n'hi ha,
                                // el primer estructural. En tots dos casos s'elimina del
                                // títol qualsevol PREFIX que sigui paraula reservada.
                                if (!sanitizedTheme && (firstOffOfd || firstStructural)) {
                                    var temaSrc = firstOffOfd || firstStructural;
                                    var cleanT = temaSrc.titol;
                                    for (var pass = 0; pass < 5; pass++) {
                                        var before = cleanT;
                                        cleanT = cleanT.replace(/^[+*\-:\.\s]+/, '').trim();
                                        for (var ri2 = 0; ri2 < RESERVED_THEMES.length; ri2++) {
                                            var patT = RESERVED_THEMES[ri2];
                                            var upT = cleanT.toUpperCase();
                                            if (upT.indexOf(patT.toUpperCase()) === 0) {
                                                var restT = cleanT.substring(patT.length);
                                                if (restT === '' || /^[\s+*\-:.\/]/.test(restT)) {
                                                    cleanT = restT.trim();
                                                    break;
                                                }
                                            }
                                        }
                                        if (cleanT === before) break;
                                    }
                                    cleanT = cleanT.replace(/^[+*\-:\.\s]+/, '').replace(/[+*\-:\s]+$/, '').trim();
                                    if (cleanT.length > 2) {
                                        sanitizedTheme = getUtils().sanitizeName(cleanT).toUpperCase();
                                        log('🏷️ [Theme] Tema reconstruït des del ' + (temaSrc.font || '1r estructural') + ': "' + sanitizedTheme + '" (item ' + (temaSrc.num || '?') + ')');
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
                // --- GUARDA: MAI crear un projecte si el bloc no està emès complet ---
                // Criteri de validesa: tots els ítems del bloc han d'haver estat emesos
                // (hora OnAir + durada). Sense això no hi ha prou informació per muntar
                // l'estructura i NO s'ha de crear cap projecte (evita els projectes
                // genèrics tipus Pruebas_*_INTRO.prproj).
                var readerG = window.EscaletaReader || (window.FASTPASS_UI && window.FASTPASS_UI.EscaletaReader);
                var blockG = null;
                try {
                    if (readerG && readerG.isBlockFullyEmitted && jsonData) {
                        blockG = readerG.isBlockFullyEmitted(jsonData, ctx.bloque);
                    }
                } catch (eG) { blockG = null; }
                if (!jsonData || !blockG || !blockG.ok) {
                    const detallG = blockG ? (blockG.emitted + "/" + blockG.total + " ítems emesos (darrer pendent: " + ((blockG.pending && blockG.pending.num) || "?") + ")") : "sense escaleta carregable";
                    // FIX (2026-09-16): si l'usuari ha fet FOTO (escaleta_on_demand_*.json),
                    // es permet crear el projecte encara que el bloc segueixi en emissió:
                    // es munta amb el que ja hi ha i es completa amb ACTUALITZAR. Sense
                    // FOTO es manté el bloqueig (evita projectes genèrics tipus *_INTRO).
                    var fotoOk = false, fotoFilename = '';
                    try {
                        if (readerG && typeof readerG.lookupLocalStatus === 'function') {
                            const locF = await readerG.lookupLocalStatus(ctx);
                            if (locF && locF.found && /^escaleta_on_demand/i.test(String(locF.filename || ''))) {
                                fotoOk = true;
                                fotoFilename = locF.filename;
                            }
                        }
                    } catch (eFoto) { fotoOk = false; }
                    // FIX (2026-09-16): també es permet crear amb l'ESCALETA DEL SISTEMA
                    // (jsonData carregat del dia) encara que el bloc no estigui emès del
                    // tot; abans calia FOTO local i, si el motor publicava el bloc amb
                    // error o endarrerit, no hi havia manera de començar.
                    const escSistemaOk = !!(jsonData && jsonData.cleanFeed && jsonData.escaleta);
                    if ((!fotoOk && !escSistemaOk) || !jsonData) {
                        log("⛔ [NOU] No es crea el projecte: " + detallG + ". Fes FOTO quan el bloc acabi d'emetre.", "ERROR");
                        getUtils().status("No es crea el projecte: " + detallG, "error");
                        return;
                    }
                    log((fotoOk ? "📷 [NOU] FOTO local (" + fotoFilename + ")" : "📡 [NOU] Escaleta del sistema") +
                        " amb el bloc en emissió (" + detallG + "): es crea el projecte PROVISIONAL. Completa'l amb ACTUALITZAR.", "WARN");
                    getUtils().status("Creant projecte provisional (bloc en emissió)…", "warn");
                }
                // ── FALLBACK DEL TEMA DES DE L'ESCALETA (2026-09-22) ─────────────────────
                // Si el tema surt buit o és una paraula reservada (INTRO, TE, P2...), es
                // recupera del TÍTOL DEL BLOC a l'escaleta (cleanFeed.clips[].titol), que
                // segueix la convenció ..._<BLOC>_<tecla>__intro__<TEMA>, p.ex.
                // TN_COMARQUES_V3_TE_santa_TECLA__intro__PREGONERS_TECLA_I_10_ANYS_DE_GENUINE
                // → "PREGONERS TECLA I 10 ANYS DE GENUINE" (mateix criteri que V1/V2).
                try {
                    const _temaInvalid = (t) => (!t || String(t).trim().length < 3 ||
                        RESERVED_THEMES.indexOf(String(t).toUpperCase().trim()) !== -1);
                    if (_temaInvalid(sanitizedTheme) && jsonData && jsonData.cleanFeed && jsonData.cleanFeed.clips) {
                        const clipBloc = jsonData.cleanFeed.clips.filter(function (c) {
                            return String(c.id || '').toUpperCase() === String(ctx.bloque).toUpperCase();
                        })[0];
                        if (clipBloc && clipBloc.titol) {
                            let t = String(clipBloc.titol).replace(/^[^_]+_[^_]*_/i, '');
                            const parts = t.split('__').filter(function (p) { return p && p.length > 2; });
                            if (parts.length > 0) t = parts[parts.length - 1];
                            t = String(t).replace(/_/g, ' ').trim();
                            const cand = getUtils().sanitizeName(t).toUpperCase();
                            if (!_temaInvalid(cand)) {
                                sanitizedTheme = cand;
                                log('🏷️ [Theme] Tema recuperat del bloc a l\'escaleta: "' + cand + '" (de "' + clipBloc.titol + '")', 'INFO');
                            }
                        }
                    }
                } catch (eTh) {
                    log('⚠️ [Theme] Fallback des de l\'escaleta: ' + eTh.message, 'WARN');
                }

                if (!sanitizedTheme || String(sanitizedTheme).trim().length < 3 || RESERVED_THEMES.indexOf(String(sanitizedTheme).toUpperCase().trim()) !== -1) {
                    log("⛔ [NOU] No es crea el projecte: tema no vàlid (" + (sanitizedTheme || "") + ").", "ERROR");
                    // (2026-09-22) DIAGNÒSTIC EXPLÍCIT: el motiu més habitual d'aquest avortament
                    // és que NO hi hagi escaleta del BLOC demanat al NAS (només d'altres blocs del
                    // mateix programa, com el V1/V2 quan es demana el V3). En aquest cas el tema
                    // s'ha d'inventar des dels chyrons i sol caure en una paraula reservada
                    // (p.ex. "INTRO"). Ho diem clarament en comptes del genèric "falta el tema".
                    var escUsada = (jsonMeta && (jsonMeta.name || jsonMeta.path)) ? String(jsonMeta.name || jsonMeta.path).split(/[\\\/]/).pop() : '';
                    var escEsDelBloc = escUsada ? (escUsada.toUpperCase().indexOf('_' + String(ctx.bloque).toUpperCase() + '_') !== -1) : false;
                    if (escUsada && !escEsDelBloc && escUsada.indexOf('escaleta_on_demand') === -1) {
                        log("⛔ [NOU] L'escaleta trobada és d'un altre bloc (" + escUsada.substring(0, 80) + "): no n'hi ha cap del bloc " + ctx.bloque + ".", "ERROR");
                        getUtils().status("Bloc " + ctx.bloque + ": no hi ha escaleta propia al NAS (nomes d'altres blocs). Demana-la o treballa un altre bloc.", "error");
                    } else {
                        getUtils().status("No es crea el projecte: falta el tema del bloc", "error");
                    }
                    return;
                }

                // ── (#121, 2026-09-30) DURADA REAL DEL CLEANFEED (no el snapshot del JSON) ──
                // El JSON d'escaleta és un SNAPSHOT del moment de publicació: el seu
                // cleanFeed.mediaStop diu fins on havia arribat la ingesta ALEES, no la
                // durada del fitxer. Si el projecte es crea més tard (o en diferit), el MP4
                // ja conté molt més material i el snapshot queda curt → guarda d'ingesta
                // FALSA i fallback al MP4 del bloc (que pot ser un render PREMATUR amb
                // material d'un altre bloc). Cas real TNM V4 29/09/2026: el JSON deia que el
                // fitxer arribava a 15:00:40 (33:40) i el fitxer real durava 68:00 (fins
                // 15:35:21) → el bloc (offset 2123 s) hi era de ple, però el sistema el va
                // donar per "no ingerit" i va importar un MP4 de verticalització escrit 15:00:51
                // (41 s ABANS de l'inici del bloc) amb el material d'un altre bloc.
                // Es mesura amb ffprobe (Logic.FFmpeg.getMediaDuration) i, si el fitxer
                // arriba més enllà del snapshot, s'usa la durada REAL com a límit.
                let cleanFeedMediaStopEff = (jsonData && jsonData.cleanFeed) ? jsonData.cleanFeed.mediaStop : null;
                let cleanFeedRealDurSec = null;
                try {
                    const _ffLogic = window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.FFmpeg;
                    const _cfPath = (jsonData && jsonData.cleanFeed) ? jsonData.cleanFeed.mediaPath : null;
                    if (readerG && typeof readerG.tcToSeconds === 'function' && _ffLogic && _ffLogic.getMediaDuration && _cfPath) {
                        const _durRes = await _ffLogic.getMediaDuration(_cfPath);
                        if (_durRes && _durRes.ok) {
                            cleanFeedRealDurSec = _durRes.duration;
                            const _snapStart = readerG.tcToSeconds(jsonData.cleanFeed.mediaStart);
                            const _snapStop  = readerG.tcToSeconds(jsonData.cleanFeed.mediaStop);
                            const _realStop  = _snapStart + cleanFeedRealDurSec;
                            if (_realStop > _snapStop + 1 && typeof readerG.secondsToTC === 'function') {
                                cleanFeedMediaStopEff = readerG.secondsToTC(_realStop);
                                log(`📏 [NOU] Durada REAL del cleanFeed: ${cleanFeedRealDurSec.toFixed(1)}s → final ${cleanFeedMediaStopEff} (snapshot JSON=${jsonData.cleanFeed.mediaStop}, ${(_snapStop - _snapStart).toFixed(1)}s). S'usa la real.`);
                            } else {
                                log(`📏 [NOU] Durada REAL del cleanFeed: ${cleanFeedRealDurSec.toFixed(1)}s ≈ snapshot JSON (${(_snapStop - _snapStart).toFixed(1)}s) → es manté el snapshot.`);
                            }
                        } else {
                            log(`⚠️ [NOU] No s'ha pogut mesurar la durada real del cleanFeed (${(_durRes && _durRes.error) || '?'}) → s'usa el snapshot del JSON (${jsonData.cleanFeed.mediaStop}).`, "WARN");
                        }
                    }
                } catch (eDurCf) {
                    log('⚠️ [NOU] Durada real del cleanFeed: ' + eDurCf.message, "WARN");
                }

                // ── FIX (2026-09-16): no importar un cleanFeed encara en ingesta ──────
                // Si el MP4 del bloc ja és al NAS però la ingesta encara no ha arribat al
                // TC de sortida (mediaStop < out del bloc), importar-lo el deixaria
                // TRUNCAT a V1 i, com que la capa de vídeo ja seria present, ACTUALITZAR
                // no el reimportaria mai. Es crea el projecte sense vídeo i es completa
                // amb ACTUALITZAR quan l'ingesta acabi.
                let skipVideoIngesta = false;
                let skipVideoIngestaMsg = null;   // (#120) motiu, per re-escriure'l al log del projecte
                let mediaMp4Ingesta = null;       // (#120) asset MP4 guardat, per si el fallback l'ha de restaurar
                try {
                    if (assets && assets.media && assets.media.mp4 && jsonData && jsonData.cleanFeed && readerG) {
                        const blkIng = (typeof readerG.getBlock === 'function') ? readerG.getBlock(jsonData, ctx.bloque) : null;
                        // (#121) stopIng amb el final EFECTIU: si la durada REAL del fitxer va
                        // més enllà del snapshot del JSON, la ingesta ja cobreix el bloc.
                        const stopIng = (typeof readerG.tcToSeconds === 'function') ? readerG.tcToSeconds(cleanFeedMediaStopEff || jsonData.cleanFeed.mediaStop) : null;
                        const outIng = (blkIng && typeof readerG.tcToSeconds === 'function') ? readerG.tcToSeconds(blkIng.out) : null;
                        if (isFinite(stopIng) && isFinite(outIng) && stopIng < outIng) {
                            skipVideoIngesta = true;
                            skipVideoIngestaMsg = "⏳ [NOU] CleanFeed en ingesta (" + jsonData.cleanFeed.mediaStop + " < " + (blkIng && blkIng.out) + "): el projecte es crearà SENSE VÍDEO (ni MP4 ni extracció de clip). Fes ACTUALITZAR quan acabi.";
                            log(skipVideoIngestaMsg, "WARN");
                            getUtils().status("MP4 en ingesta: projecte sense vídeo (ACTUALITZAR després)", "warn");
                            // (#120, 2026-09-30) Guardem l'asset: si el fallback troba el MP4 del
                            // bloc de verticalització, la guarda s'aixeca (vegeu més avall) i s'ha
                            // de poder restaurar `assets.media.mp4`.
                            mediaMp4Ingesta = assets.media.mp4;
                            assets.media = { mp4: null, srt: (assets.media.srt || null) };
                        } else if (cleanFeedRealDurSec != null && isFinite(stopIng) && isFinite(outIng)) {
                            // (#121) La guarda NO s'aplica perquè el fitxer real ja arriba més enllà
                            // del bloc, encara que el snapshot del JSON digui el contrari.
                            log(`🔓 [NOU] Guarda d'ingesta NO aplicable: el fitxer real arriba a ${cleanFeedMediaStopEff} i el bloc acaba a ${(blkIng && blkIng.out) || '?'}.`);
                        }
                    }
                } catch (eIngMp4) {
                    log("⚠️ [NOU] No s'ha pogut comprovar la ingesta del cleanFeed: " + eIngMp4.message, "DEBUG");
                }

                const shortProg = ctx.progData.wott || "TNV";
                // Determinar hora d'inici del programa (per inserir el MP4 desde l'inici del informatiu)
                // Font única: Config.get().programStartHours (11_Configuracio.js).
                const PROGRAM_START_HOURS = ctx.config.programStartHours
                    || { TNV: 21.0, TNM: 14.5, TNC: 13.8333 };
                const worldProgramStartHour = PROGRAM_START_HOURS[shortProg] || 0;
                const projSlug = `${shortProg}_${ctx.bloque}_${sanitizedTheme}`;
                
                const fileName = `Pruebas_${projSlug}.prproj`;
                const folderPath = getUtils().workFolder(ctx);
                const fullDestPath = (folderPath + "/" + fileName).replace(/\\/g, "/");

                const paths = {
                    plantillaPath: ctx.config.rutas.plantilla_net,
                    fullDestPath: fullDestPath,
                    folderPath: folderPath,
                    sanitizedTheme: sanitizedTheme
                };

                // ─── Inicialitzar fitxer de log per a aquest projecte ──────────────
                getUtils()._setLogPath(folderPath, fileName);

                // (#120, 2026-09-30) La guarda "cleanFeed en ingesta" s'avalua ABANS d'aquest
                // punt i _setLogPath buida FASTPASS.log → el motiu es perdia (run V4 del 29/09:
                // el log no deia per què el projecte sortia sense vídeo). Es re-escriu aquí.
                if (skipVideoIngestaMsg) log(skipVideoIngestaMsg, "WARN");

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
                            jsonMeta = await reader.ensureLocalCopy(ctx, datePrefixJson2);
                            if (jsonMeta) {
                                jsonData = await reader.load(jsonMeta.path);
                            }
                        }
                        if (jsonMeta && jsonData) {
                            if (jsonData) {
                                // Tots els ítems de l'escaleta (per persistir al manifest)
                                const allItems = jsonData.escaleta?.liniesEscaleta || [];

                                // ─── SISTEMA DE 3 TIERS: Precisió de trim ─────────────────
                                // (#121) mediaStop EFECTIU: si la durada real del fitxer supera el
                                // snapshot del JSON, el límit del MP4 és la durada real (abans el
                                // [OUT-MARGIN] tallava l'OUT al final del snapshot → OUT truncat).
                                const bounds = reader.calcPrecisionTrimBounds(
                                    jsonData,
                                    ctx.bloque,
                                    jsonData.cleanFeed.mediaStart,
                                    cleanFeedMediaStopEff || jsonData.cleanFeed.mediaStop,
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
                                        cleanFeedMediaStopEff || jsonData.cleanFeed.mediaStop
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
                                                    // ── (#121, 2026-09-30) VALIDACIÓ DEL MP4 DEL BLOC ────
                                                    // El pipeline de verticalització publica el fitxer del bloc
                                                    // amb el seu nom, però el pot publicar PREMATURAMENT (abans
                                                    // que el bloc s'hagi emès): el 0 del fitxer és aleshores el
                                                    // material del bloc ANTERIOR. Cas real (TNM V4 29/09/2026):
                                                    // TN_MIGDIA_V4_*.mp4 escrit 15:00:51 amb el reportatge de
                                                    // comarques, per a un bloc emès a les 15:02:43 → es va
                                                    // importar material aliè a V1 i els marcadors no hi quadraven.
                                                    // Criteri: el render ha de ser POSTERIOR a l'inici del bloc i
                                                    // la seva durada ha de cobrir la del bloc.
                                                    const _chk = await this._validateBlockMedia(bounds, blockMediaPath);
                                                    if (_chk.ok) {
                                                        useBlockMedia = true;
                                                        log(`✅ [FALLBACK] MP4 del bloc validat: ${blockAssets.mp4.name} (${_chk.motiu})`);
                                                    } else {
                                                        blockMediaPath = null;
                                                        log(`⛔ [FALLBACK] MP4 del bloc DESCARTAT (${_chk.motiu}) → no s'importa material d'un altre bloc. El projecte quedarà SENSE VÍDEO: fes ACTUALIZAR quan l'ingesta del cleanFeed arribi.`, "ERROR");
                                                        getUtils().status("MP4 del bloc descartat (render prematur): projecte sense vídeo", "warn");
                                                    }
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
                                            // (2026-09-21) Passem els handles: la durada del bloc
                                            // es recalcula amb els temps ABSOLUTS (worldBlockEndSec −
                                            // worldBlockStartSec) + handles, en lloc de reutilitzar
                                            // bounds.mp4Duration (que pot estar corrupte a 1s quan el
                                            // bloc s'emet després del final del cleanFeed).
                                            const fallbackBounds = reader.calcFallbackBoundsForBlockMedia(bounds, ctx.config.handles || 0);
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

                                            // ── (#120, 2026-09-30) AIXECAR LA GUARDA "cleanFeed en ingesta" ──
                                            // La guarda de dalt protegeix contra importar un cleanFeed TRUNCAT.
                                            // El MP4 del bloc de VERTICALITZACIÓ és un fitxer INDEPENDENT i
                                            // sencer (es renderitza per bloc): si hi és, val més importar-lo
                                            // que deixar V1 buit. Cas real (run TNM V4 del 29/09): l'escaleta
                                            // era una captura 46s ABANS del bloc → mediaStop < out → guarda
                                            // activa → però el MP4 del bloc cobria tot el bloc. Resultat: V1
                                            // buit i els marcadors impossibles de testar.
                                            // Aquí el fallback ja ha confirmat que el fitxer existeix → no aplica.
                                            if (skipVideoIngesta) {
                                                skipVideoIngesta = false;
                                                if (mediaMp4Ingesta) {
                                                    assets.media = { mp4: mediaMp4Ingesta, srt: (assets.media && assets.media.srt) || null };
                                                }
                                                log(`🔓 [FALLBACK] Guarda "CleanFeed en ingesta" AIXECADA: s'usa el MP4 del bloc (${String(blockMediaPath).split(/[\\/]/).pop()}) → s'importa a V1 i es munten marcadors.`);
                                                getUtils().status("MP4 del bloc importat (cleanFeed encara en ingesta)", "info");
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
                                        // (#120, 2026-09-30) `!useBlockMedia`: amb el MP4 del bloc NO s'extreu
                                        // clip. El fitxer de verticalització ja ÉS el material del bloc i
                                        // s'insereix SENCER (branca isFallbackBlockMedia de 3_Project_Logic,
                                        // domini 'source/bloc-media', fileIn=0). Extreure'n un clip local
                                        // deixaria el 0 del fitxer a handleSecs i desalinearia els marcadors.
                                        if (!skipVideoIngesta && !useBlockMedia && ffmpeg && ffmpeg.extractClip) {
                                            const clipName = `${ctx.progData.wott || "TNV"}_${ctx.bloque}_CLIP.mp4`;
                                            // Destí: DIRECTORI DEL PROJECTE (folderPath = on neix el .prproj a _runNew).
                                            // El clip del bloc, l'AUDIO_REF.bin i el .prproj queden sempre junts
                                            // i la importació es fa des d'aquesta ruta (cleanFeedData.mediaPath).
                                            // NOTA: no usem Context.folder() aquí perquè a _runNew el projecte nou
                                            // encara no existeix (retornaria la carpeta del projecte ANTERIOR).
                                            // ffmpeg/PowerShell necessiten backslashes; Premiere, forward slashes (després).
                                            const projFolder = getUtils().workFolder(ctx);
                                            const clipPath = (projFolder + "\\" + clipName).replace(/\//g, "\\");
                                            log(`🎬 [EXTRACT] Clip del bloc → directori del projecte: ${clipPath}`);

                                            // mp4Duration es necessita per a l'extracció i el recàlcul de bounds
                                            const mp4Duration = bounds.mp4Duration;
                                            // ── COLA EXTRA DEL CLIP (2026-09-16) ─────────────────
                                            // El fitxer extret ha d'incloure clipExtraTailSec (60 s per
                                            // defecte) MÉS ENLLÀ del final del bloc: si una connexió o un
                                            // directe s'allarga, el material ja és al clip i només cal
                                            // ESTIRAR-LO a la timeline. Retallar el que sobra no costa res;
                                            // no tenir-ne, en canvi, fa perdre la peça.
                                            // El clip insertat NO canvia (clipExpandedOutPoint = mp4Duration).
                                            const extraTailSec = (ctx.config && ctx.config.clipExtraTailSec != null)
                                                ? Number(ctx.config.clipExtraTailSec) : 60;
                                            let extractDuration = mp4Duration +
                                                ((isFinite(extraTailSec) && extraTailSec > 0) ? extraTailSec : 0);
                                            let useExtractedClip = false;

                                            // ═══ (2026-09-25c) SNAP A KEYFRAME: conversió source→fitxer ═══════
                                            // `ffmpeg -ss X -i src -c copy` NO pot arrencar fora de keyframe: ho fa
                                            // al keyframe ANTERIOR i, com que amb -c copy no es descarta el pre-roll,
                                            // el 0 del fitxer extret ≠ X. MESURAT (TNC V3 2026-09-25, GOP 1 s):
                                            // -ss 783 → el fitxer arrenca a 782.187 s del source.
                                            // → es mesura el keyframe amb ffprobe i s'extreu DES D'ALLÀ: així
                                            // "0 del fitxer == -ss" és cert per construcció i el pre-roll es compta
                                            // explícitament (fileIn = handleSecs + preRoll).
                                            let extractStartSec = bounds.mp4ExpandedInPoint;
                                            let preRollSec = 0;
                                            let kfOk = false;
                                            try {
                                                const _kf = await ffmpeg.keyframeAtOrBefore(effectiveMediaPath, bounds.mp4ExpandedInPoint, bounds.mp4ExpandedInPoint);
                                                if (_kf && _kf.ok) {
                                                    extractStartSec = _kf.kf;
                                                    preRollSec = _kf.preRoll;
                                                    kfOk = true;
                                                    extractDuration = extractDuration + preRollSec;   // mateix FINAL al source
                                                }
                                            } catch (eKf) {
                                                log(`⚠️ [EXTRACT] keyframeAtOrBefore: ${eKf.message} → extracció sense snap`);
                                            }
                                            cleanFeedData._ffmpeg = {
                                                ss: extractStartSec, t: extractDuration,
                                                requestedIn: bounds.mp4ExpandedInPoint, preRoll: preRollSec, kfOk: kfOk
                                            };

                                            // Estratègia: EXTREURE SEMPRE. Si el clip ja existeix, ffmpeg -y el sobreescriu.
                                            // Si el cleanFeed és massa petit, l'extracció fallarà (timeout a waitForFile).
                                            // Evitem checkSourceDuration perquè IO.executeShell amb pipes/fitxers temporals
                                            // no funciona correctament a ExtendScript (afegeix cometes extra als paths).
                                            log(`🎬 [EXTRACT] Extraient clip: input=${effectiveMediaPath}, start=${extractStartSec.toFixed(2)}s${kfOk ? ` (= keyframe; demanat ${bounds.mp4ExpandedInPoint.toFixed(2)}s + pre-roll ${preRollSec.toFixed(2)}s)` : ' (sense snap keyframe ✗)'}, dur=${extractDuration.toFixed(2)}s (bloc ${mp4Duration.toFixed(2)}s + cola extra ${(extractDuration - mp4Duration - preRollSec).toFixed(0)}s + pre-roll ${preRollSec.toFixed(2)}s), output=${clipPath}`);
                                            getUtils().status("🎬 Extraient clip via ffmpeg...", "info");
                                            const extractResult = await ffmpeg.extractClip(
                                                effectiveMediaPath,
                                                extractStartSec,
                                                extractDuration,
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
                                                // (2026-09-25c) TOTS els temps del FITXER porten el pre-roll del snap
                                                // de keyframe: el contingut del bloc comença a (h + preRoll) del fitxer
                                                // extret, no a h. Sense això el clip queda desplaçat el pre-roll (~1 s).
                                                const clipExpandedInPoint  = h + preRollSec;
                                                const clipExpandedOutPoint = mp4Duration + preRollSec;
                                                const clipDuration         = mp4Duration;

                                                // worldSecMediaStart s'ajusta per al clip extret:
                                                // base REAL = worldSecMediaStart(cleanfeed) + extractStartSec (-ss efectiu).
                                                // Invariant: worldBlockStartSec − fbWorldSecMediaStart == clipExpandedInPoint.
                                                const fbWorldSecMediaStart = (isFinite(Number(worldSecMediaStart)) && isFinite(Number(extractStartSec)))
                                                    ? (Number(worldSecMediaStart) + Number(extractStartSec))
                                                    : ((bounds.ref.worldBlockStartSec != null)
                                                        ? bounds.ref.worldBlockStartSec - h
                                                        : bounds.ref.worldSecMediaStart);

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
                                                cleanFeedData.mp4SweetInPointRaw = h + preRollSec;
                                                log(`📐 [EXTRACT] mp4SweetInPointRaw actualitzat a ${(h + preRollSec).toFixed(2)}s (handleSecs ${h.toFixed(2)} + pre-roll ${preRollSec.toFixed(2)}) per al clip extret`);
                                                // (2026-09-25c) [DOMAINS] Dades de DOMINI per al dump d'una sola línia
                                                // de la fase [EXTRACT] (veure _domainsDump).
                                                cleanFeedData._wsmsCleanfeed   = Number(worldSecMediaStart);
                                                cleanFeedData._fileBase        = Number(fbWorldSecMediaStart);
                                                cleanFeedData._srcIn           = Number(bounds.mp4ExpandedInPoint);
                                                cleanFeedData._srcOut          = Number(bounds.mp4ExpandedOutPoint);
                                                cleanFeedData._mediaBlockStart = (bounds.ref && bounds.ref.worldBlockStartSec != null) ? Number(bounds.ref.worldBlockStartSec) : null;
                                                cleanFeedData._mediaBlockEnd   = (bounds.ref && bounds.ref.worldBlockEndSec != null) ? Number(bounds.ref.worldBlockEndSec) : null;
                                                cleanFeedData._clipPath        = clipPath;

                                                // Actualitzar també les referències del manifest (en memòria)
                                                if (manifest && manifest.ref) {
                                                    manifest.ref.worldSecMediaStart = fbWorldSecMediaStart;
                                                    // ⚠️ FIX (2026-09-17): el bloc, dins del CLIP EXTRET, comença a
                                                    // clipExpandedInPoint (handles), NO al valor del cleanFeed.
                                                    // Sense això offsetSec = -168 en lloc de -20 (148 s de desfasament).
                                                    manifest.ref.tlBlockInPointSec = clipExpandedInPoint;
                                                    manifest.ref.mp4ExpandedInPoint = clipExpandedInPoint;
                                                    manifest.ref.mp4ExpandedOutPoint = clipExpandedOutPoint;
                                                    manifest.ref.mp4Duration = clipDuration;
                                                    log(`📐 [EXTRACT] manifest.ref actualitzat: worldSecMediaStart=${fbWorldSecMediaStart.toFixed(2)}s, tlBlockInPointSec=${clipExpandedInPoint.toFixed(2)}s, dur=${clipDuration.toFixed(1)}s`);
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
                                                            mp4Duration: clipDuration,
                                                            // ⚠️ FIX (2026-09-17): SENSE això el manifest conservava el
                                                            // tlBlockInPointSec del CLEANFEED (168 s) mentre el clip
                                                            // extret té el bloc a clipExpandedInPoint (20 s) -> offsetSec
                                                            // quedava a -168 en lloc de -20 = 148 s de desfasament a TOT
                                                            // el timeline (marcadors, chyrons i SRT).
                                                            tlBlockInPointSec: clipExpandedInPoint,
                                                            mp4SweetInPointRaw: clipExpandedInPoint
                                                        }
                                                    });
                                                    log(`✅ [EXTRACT] Manifest actualitzat amb ref del clip extret: worldSecMediaStart=${fbWorldSecMediaStart.toFixed(2)}s, mp4ExpandedInPoint=${clipExpandedInPoint.toFixed(2)}s`);

                                                    // ═══ (2026-09-25) SILENCIS A LA IMPORTACIÓ ═══════════════════
                                                    // Dada TRANSVERSAL: els silencis són l'única evidència FÍSICA del
                                                    // contingut (la escaleta pot anar 2 min desviada, com s'ha vist).
                                                    // Es calculen AQUÍ, una sola vegada, sobre l'àudio del CLIP EXTRET
                                                    // (.bin 480Hz) i es guarden al manifest perquè els facin servir:
                                                    //   · el punt de tall IN i OUT (validar/ajustar a fronteres reals)
                                                    //   · totes les capes de marcadors (CAPA 1 i següents)
                                                    // Temps en MEDIA del clip extret (base = clipPath extret).
                                                    try {
                                                        const _wg = window.FASTPASS_UI.Logic.WaveformGenerator;
                                                        if (_wg && _wg.silences) {
                                                            const _sil = (await _wg.silences()) || [];
                                                            if (_sil.length) {
                                                                await FASTPASS_UI.SessionManifest.save(ctx, {
                                                                    ref: {
                                                                        silencesCount: _sil.length,
                                                                        silencesJson: JSON.stringify(_sil),
                                                                        silencesSource: 'extractedClip',
                                                                        silencesThreshold: 0.05,
                                                                        silencesMinDur: 0.4
                                                                    }
                                                                });
                                                                log(`🤫 [SILENCI·IMPORT] ${_sil.length} trams guardats al manifest: ` + _sil.map(function (s) { return s.start.toFixed(2) + '→' + s.end.toFixed(2) + '(' + s.dur.toFixed(2) + 's)'; }).join(', '));
                                                            } else {
                                                                log('🤫 [SILENCI·IMPORT] Sense trams (o .bin encara no generat) → es calcularà més tard.');
                                                            }
                                                        }
                                                    } catch (eSil) {
                                                        log(`⚠️ [SILENCI·IMPORT] No s'han pogut calcular els silencis: ${eSil.message}`);
                                                    }

                                                    // ═══ (2026-09-25) ANCLA D'AUDIO DEL INICI DEL BLOC ═══════════════
                                                    // La escaleta NO pot dir on comença el bloc (no té el tema anterior:
                                                    // prevista 14:00:48 vs real 14:02:31 = 103 s d'error). L'ÀUDIO sí:
                                                    // la junta entre el tema anterior i la intro és el PRIMER silenci
                                                    // (≥0,4s) amb un burst previ ≥30 s (TNC V2 2026-09-25: 124.10→124.60
                                                    // amb burst de 124 s ✓ vs el 2n silenci a 127.00 amb burst de 2,4 s ✗).
                                                    // Regla: IN del bloc = silenci.start − 0,5 s (VALIDADA amb el tall
                                                    // manual de l'operador: 123,5 ✓).
                                                    try {
                                                        const _wg2 = window.FASTPASS_UI.Logic.WaveformGenerator;
                                                        const _ref2 = manifest && manifest.ref ? manifest.ref : null;
                                                        const _base2 = _ref2 ? Number(_ref2.worldSecMediaStart) : NaN;
                                                        if (_wg2 && _wg2.silences && isFinite(_base2)) {
                                                            const _sil2 = (await _wg2.silences()) || [];
                                                            const _estSec = (bounds && bounds.ref && isFinite(Number(bounds.ref.worldBlockStartSec)))
                                                                ? Number(bounds.ref.worldBlockStartSec)
                                                                : NaN;
                                                            const _estFile = isFinite(_estSec) ? (_estSec - _base2) : clipExpandedInPoint;
                                                            let _junc = null;
                                                            for (let _i = 0; _i < _sil2.length; _i++) {
                                                                const _s = _sil2[_i];
                                                                if (!_s || !(_s.dur >= 0.4)) continue;
                                                                if (isFinite(_estFile) && Math.abs(_s.start - _estFile) > 300) continue;
                                                                const _prevEnd = (_i > 0) ? Number(_sil2[_i - 1].end) : 0;
                                                                if ((_s.start - _prevEnd) < 30) continue;   // burst previ suficient
                                                                _junc = _s; break;
                                                            }
                                                            if (_junc) {
                                                                const _newFileIn = Math.max(0, Number(_junc.start) - 0.5);
                                                                log(`🎯 [IN·AUDIO] Junta tema anterior → intro: silenci ${Number(_junc.start).toFixed(2)}→${Number(_junc.end).toFixed(2)}s (dur ${Number(_junc.dur).toFixed(2)}s, burst previ ≥30s) · IN del bloc ${_estFile.toFixed(2)} → ${_newFileIn.toFixed(2)}s (dins el clip) · Δ=${(_newFileIn - _estFile).toFixed(2)}s`);
                                                                // ═══ (2026-09-25) JERARQUIA DE FONTS (regla d'usuari) ═══════════════
                                                                // 1r OnAir (emissió real) — 2n hora de l'ítem (prevista) — el SILENCI
                                                                // només CONFIRMA bounds i markers: dins ±3 s → ✅ confirma; fora o
                                                                // sense silenci → NEUTRE (no decideix mai). Mai al revés.
                                                                if (Math.abs(_newFileIn - _estFile) <= 3.0) {
                                                                    log(`✅ [IN·AUDIO] CONFIRMA l'IN de la escaleta (${_estFile.toFixed(2)}s): hi ha un tall d'àudio a ${_newFileIn.toFixed(2)}s (Δ=${(_newFileIn - _estFile).toFixed(2)}s).`);
                                                                } else {
                                                                    log(`ℹ️ [IN·AUDIO] Neutre: la junta d'àudio (${_newFileIn.toFixed(2)}s) no és a prop de l'IN (${_estFile.toFixed(2)}s, Δ=${(_newFileIn - _estFile).toFixed(2)}s). El silenci NO decideix (la INTRO no té silenci: música/sting continu) → mana l'hora de l'escaleta/OnAir. Dada desada per als marcadors (CAPA 1).`);
                                                                }
                                                            } else {
                                                                log('⚠️ [IN·AUDIO] Sense junta d\'àudio fiable al .bin → es manté l\'IN de la escaleta (revisa el tall a mà).');
                                                            }
                                                        }
                                                    } catch (eInAud) {
                                                        log(`⚠️ [IN·AUDIO] ${eInAud.message}`);
                                                    }
                                                } catch(eManifest) {
                                                    log(`⚠️ [EXTRACT] Error guardant dades del clip al manifest: ${eManifest.message}`);
                                                }
                                            } else {
                                                log(`ℹ️ [EXTRACT] No s'usa clip extret. Es manté el comportament actual (MP4 complet).`);
                                            }
                                        } else {
                                            // (#120, 2026-09-30) Missatge HONEST: abans deia sempre
                                            // "FFmpegLogic.extractClip no disponible", també quan el que
                                            // passava era que s'ometia per la guarda d'ingesta → va costar
                                            // una sessió sencera de diagnòstic (run V4 del 29/09).
                                            if (useBlockMedia) {
                                                log(`ℹ️ [EXTRACT] MP4 del bloc (fallback): s'insereix SENCER a V1, sense extracció de clip.`);
                                            } else if (skipVideoIngesta) {
                                                log(`⏳ [EXTRACT] Omesa: cleanFeed encara en ingesta i sense MP4 del bloc → projecte sense vídeo (ACTUALITZAR després).`);
                                            } else {
                                                log(`ℹ️ [EXTRACT] FFmpegLogic.extractClip no disponible. Usant MP4 complet (fallback).`);
                                            }
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
                                        cleanFeedMediaStopEff || jsonData.cleanFeed.mediaStop,
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
                await FASTPASS_UI.Logic.Project.create(ctx, assets.wotts, assets.media, paths, assets.portada, shortProg,
                    // FIX (2026-09-16): amb el cleanFeed en ingesta es crea el projecte SENSE
                    // vídeo (ni clip extret ni MP4) perquè quedi truncat a V1. ACTUALITZAR el
                    // col·locarà quan l'ingesta hagi acabat.
                    // (#120, 2026-09-30): NO aplica si el fallback ha trobat el MP4 del bloc —
                    // en aquest cas la guarda s'aixeca més amunt i skipVideoIngesta ja és false,
                    // així que cleanFeedData (mediaPath = MP4 del bloc) s'importa amb normalitat.
                    skipVideoIngesta ? null : cleanFeedData);

                // 2. FINALITZAR ref (Obtenir tlClipStartSec real post-inserció)
                if (cleanFeedData) {
                    log("📐 Finalitzant ref post-inserció...");
                    
                    // Llegir la posició real del clip al timeline via Clips.get()
                    // Usem start.seconds (posició al timeline), NO inPoint.seconds (relatiu al source)
                    const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
                    let tlClipStartSec = NaN;
                    let _clipInPtReal = null;   // (2026-09-25) inPoint REAL del clip inserit
                    try {
                        const clipData = JSON.parse(clipDataRaw);
                        tlClipStartSec = clipData.start;
                        if (clipData.inPoint !== undefined && clipData.inPoint !== null && isFinite(Number(clipData.inPoint))) {
                            _clipInPtReal = Number(clipData.inPoint);
                        }
                        log(`🔍 [LOG] Clips.get(1,0): start=${clipData.start}, inPoint=${clipData.inPoint}, end=${clipData.end}`);
                    } catch(e) {
                        log(`⚠️ Error parsejant clipData: ${clipDataRaw}`);
                    }
                    // (2026-09-25c) 🔎 DUMP ÚNIC DE DOMINIS (fase [EXTRACT]): totes les escales de cop
                    // (media · fitxer · timeline) + verificació de les invariants en una sola línia.
                    this._domainsDump(cleanFeedData);
                    
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
                        // ═══ (2026-09-25) FIX ARREL: el manifest ha de dir la VERITAT del clip ═══
                        // `clipInOffset` (config) fa que el clip s'insereixi amb MENYS IN del
                        // previst (TNC V2: IN real=10.00s vs manifest=20.00s) → 10s d'error
                        // sistemàtic a TOTS els marcadors. Si el clip té un inPoint llegible,
                        // mana AQUEST (és el que hi ha de debò a la línia de temps).
                        const _tlBlockInPtPrevist = (manifest.ref?.tlBlockInPointSec ?? cleanFeedData.mp4SweetInPointRaw) + (ctx.config.tcOffset || 0);
                        const tlBlockInPointSec = (_clipInPtReal !== null && Math.abs(_clipInPtReal - _tlBlockInPtPrevist) > 0.5)
                            ? _clipInPtReal
                            : _tlBlockInPtPrevist;
                        if (_clipInPtReal !== null && Math.abs(_clipInPtReal - _tlBlockInPtPrevist) > 0.5) {
                            log(`⚠️ [REF] IN del clip (${_clipInPtReal.toFixed(3)}s) ≠ previst (${_tlBlockInPtPrevist.toFixed(3)}s) → el manifest s'actualitza amb el REAL (clipInOffset=${(ctx.config.clipInOffset||0)}s). Els marcadors s'alinearan amb el material de la timeline.`);
                        }
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
                    window.FASTPASS_UI.State.projectDateDir = ctx.dateDir;
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
                const newPath = getUtils().workFolder(ctx) + "\\" + "Pruebas_" + newProjectName + ".prproj";

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
            const folderPath = getUtils().workFolder(data);
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
            const folderPath = getUtils().workFolder(data);
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

            // ─── ESCALETA LOCAL + MANIFEST ──
            // Al obrir un projecte, la extensió treballa amb la còpia local de
            // l'escaleta al directori del projecte. Si no hi és, es baixa del NAS
            // i es copia. El manifest es regenera des de l'últim JSON del directori.
            await this._rebuildManifestFromLocal(ctx);

            // Registrar como último proyecto abierto
            if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                window.FASTPASS_UI.State.lastOpenedProjectName = projName;
                window.FASTPASS_UI.State.projectDateDir = ctx.dateDir;
            }
            
            log("✅ Projecte obert.");
            // Actualizar contexto para que el botón cambie a UPDATE si el proyecto está abierto
            if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                await FASTPASS_UI.Core.Context.checkContext();
            }
        },

        /**
         * _validateBlockMedia: Valida que el MP4 de verticalització del bloc sigui un render
         * POSTERIOR a l'inici del bloc i que cobreixi la durada del bloc.
         *
         * (#121, 2026-09-30) Motiu: el pipeline de verticalització publica el fitxer amb el
         * nom del bloc però pot fer-ho ABANS que el bloc s'hagi emès. En aquest cas el 0 del
         * fitxer és el material del bloc ANTERIOR (cas real TNM V4 29/09/2026: fitxer escrit
         * 15:00:51 amb material de comarques per a un bloc emès a les 15:02:43) i importar-lo
         * omple la timeline de material aliè.
         *
         * @param {Object} bounds - Bounds calculats (usa bounds.ref.worldBlockStartSec/EndSec)
         * @param {string} path   - Ruta del MP4 del bloc
         * @returns {Promise<{ok:boolean, motiu:string}>}
         */
        _validateBlockMedia: async function (bounds, path) {
            const ref = (bounds && bounds.ref) || {};
            const wBlockStart = ref.worldBlockStartSec;
            const wBlockEnd = ref.worldBlockEndSec;
            const planned = (isFinite(wBlockStart) && isFinite(wBlockEnd) && wBlockEnd > wBlockStart)
                ? (wBlockEnd - wBlockStart) : null;
            const motius = [];

            // 1. Durada real del fitxer vs durada del bloc
            let dur = null;
            try {
                const ff = window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.FFmpeg;
                if (ff && ff.getMediaDuration) {
                    const r = await ff.getMediaDuration(path);
                    if (r && r.ok) dur = r.duration;
                }
            } catch (eD) { dur = null; }
            if (dur != null && planned != null && dur < planned - 2) {
                motius.push(`durada ${dur.toFixed(1)}s < bloc ${planned.toFixed(1)}s`);
            }

            // 2. Data de modificació: el render ha de ser posterior a l'inici del bloc
            const mtSec = this._fileMtimeSecOfDay(path);
            if (mtSec != null && isFinite(wBlockStart) && mtSec < wBlockStart - 60) {
                motius.push(`fitxer escrit ${this._secToHHMMSS(mtSec)} ABANS de l'inici del bloc ${this._secToHHMMSS(wBlockStart)}`);
            }

            if (motius.length) return { ok: false, motiu: motius.join(' + ') };

            const det = [];
            if (dur != null) det.push(`durada ${dur.toFixed(1)}s`);
            if (mtSec != null) det.push(`escrit ${this._secToHHMMSS(mtSec)}`);
            return { ok: true, motiu: det.length ? det.join(', ') : 'sense metadades (validació parcial)' };
        },

        /**
         * _fileMtimeSecOfDay: mtime d'un fitxer en segons des de mitjanit (hora local).
         * Retorna null si no es pot obtindre (UNC sense stat, etc.).
         */
        _fileMtimeSecOfDay: function (path) {
            try {
                const fs = window.cep && window.cep.fs;
                if (!fs || !fs.stat || !path) return null;
                const st = fs.stat(path);
                if (!st || st.err !== 0 || !st.data || st.data.mtime == null) return null;
                let ms = new Date(st.data.mtime).getTime();
                if (!isFinite(ms)) return null;
                if (ms < 946684800000) ms = ms * 1000;   // epoch en segons → ms
                const d = new Date(ms);
                return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
            } catch (e) { return null; }
        },

        /**
         * _secToHHMMSS: segons → "HH:MM:SS" (només per a logs).
         */
        _secToHHMMSS: function (s) {
            if (!isFinite(s)) return '?';
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
            const p = (n) => String(n).padStart(2, '0');
            return p(h) + ':' + p(m) + ':' + p(sec);
        },

        /**
         * _guardBlockMedia: (#121, 2026-09-30) Guarda d'ingesta per als fluxos que
         * agafen el MP4 de `rutas.verticalitzacio` via `Scan.mediaAssets` (ACTUALITZAR,
         * LOAD, GO): el render del bloc pot existir PREMATURAMENT (abans que el bloc
         * s'hagi emès) i el seu 0 és aleshores material d'un altre bloc. Si el fitxer
         * no cobreix el bloc o és més antic que el seu inici, s'anul·la (mai material aliè).
         * Si no es pot validar (sense metadades), es deixa passar com abans.
         */
        _guardBlockMedia: async function (ctx, media) {
            if (!media || !media.mp4 || !media.mp4.path) return media;
            try {
                const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                if (!reader || typeof reader.calcPrecisionTrimBounds !== 'function') return media;
                const datePrefix = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                const jsonMeta = await reader.ensureLocalCopy(ctx, datePrefix);
                if (!jsonMeta || !jsonMeta.path) return media;
                const jsonData = await reader.load(jsonMeta.path);
                if (!jsonData || !jsonData.cleanFeed) return media;
                const bounds = reader.calcPrecisionTrimBounds(
                    jsonData, ctx.bloque,
                    jsonData.cleanFeed.mediaStart, jsonData.cleanFeed.mediaStop, ctx.config
                );
                const chk = await this._validateBlockMedia(bounds, media.mp4.path);
                if (chk.ok) {
                    log(`✅ [SCAN] MP4 del bloc validat: ${media.mp4.name} (${chk.motiu})`);
                } else {
                    log(`⛔ [SCAN] MP4 del bloc DESCARTAT (${chk.motiu}) → no s'importarà material d'un altre bloc.`, 'ERROR');
                    return { ...media, mp4: null };
                }
            } catch (eG) {
                log('⚠️ [SCAN] No s\'ha pogut validar el MP4 del bloc: ' + eG.message, 'WARN');
            }
            return media;
        },

        /**
         * _fullScan: Escaneja rètols, media i portada, i actualitza flags de Context.
         */
        _fullScan: async function (ctx) {
            log("🔍 [SCAN] Analitzant context i materials...");
            
            // 1. Busquem materials al NAS
            const wotts = await window.Scan.wotts(ctx);
            const media = await this._guardBlockMedia(ctx, await window.Scan.mediaAssets(ctx, wotts.tema));
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
            const folderDest = getUtils().workFolder(ctx);
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
            // En ACTUALITZAR/LOAD/GO el projecte ja existeix: si ja té la capa de vídeo
            // (V1) i/o de subtítols, no es reimporten MP4/SRT equivalents.
            await FASTPASS_UI.Logic.Project.ingestAssets(ctx, assets.wotts, assets.media, assets.portada, { skipMediaIfLayerPresent: true });

            // 2. (TO DO UPDATE #2) NO col·locar el SRT a la pista de subtítols aquí.
            // El SRT es gestiona únicament via l'editor SRT (CARREGAR + EXPORTAR),
            // així que UPDATE/GO/LOAD no han de crear cap caption track.


            // 3. Focus i Targeting
            await callJSX("Tracks.target(1, true, 'video')");
            await callJSX("Tracks.target(1, true, 'audio')");
        },

        /**
         * _domainsDump: 🔎 DUMP ÚNIC DE DOMINIS (fase [EXTRACT]).
         *
         * Els 3 dominis que NO es poden barrejar:
         *   (a) MEDIA/món      → wsms (inici del cleanfeed en segons del dia), bloc(media)
         *   (b) FITXER extret  → base-fitxer (= wsms + -ss), fileIn/fileOut del contingut
         *   (c) TIMELINE V1    → clip.inPoint/outPoint reals, corchete IN/OUT (seq)
         *
         * Invariants que s'imprimeixen amb OK/MISMATCH:
         *   1) 0-fitxer == -ss        : la base del fitxer ha de ser el -ss efectiu
         *   2) contingut == fileIn     : (inici del bloc − base) == fileIn del pla (handle+preRoll)
         *   3) clip.inPoint == pla     : el recorte real ha de ser el planejat
         *   4) corchete on contingut   : (inici bloc − base) − clip.inPoint == seqIN
         *
         * Amb aquesta línia es veu en 5 segons a quin domini deixa de quadrar.
         *
         * @param {Object} cfd - cleanFeedData (amb _ffmpeg/_plan/_clipReal/_fileBase...)
         */
        _domainsDump: function (cfd) {
            try {
                if (!cfd) { log('🔎 [DOMAINS] sense cleanFeedData (fase EXTRACT no executada)'); return; }
                const nf = (n) => { const v = Number(n); return isFinite(v) ? v.toFixed(2) : '?'; };
                const ff = cfd._ffmpeg || {};
                const pl = cfd._plan || {};
                const rl = cfd._clipReal || {};
                const base = Number(cfd._fileBase);
                const bStart = Number(cfd._mediaBlockStart);
                const bEnd = Number(cfd._mediaBlockEnd);
                const wsmsC = Number(cfd._wsmsCleanfeed);
                const fileIn = Number(pl.fileIn);
                const realIn = Number(rl.inPoint);
                const seqIn = Number(pl.sweetSeqIn);
                const chk = [];
                if (isFinite(base) && isFinite(wsmsC) && isFinite(Number(ff.ss))) {
                    const d = (base - wsmsC) - Number(ff.ss);
                    chk.push('0-fitxer==-ss ' + (Math.abs(d) <= 0.25 ? 'OK' : 'MISMATCH(' + nf(d) + ')'));
                }
                if (isFinite(bStart) && isFinite(base) && isFinite(fileIn)) {
                    const d = (bStart - base) - fileIn;
                    chk.push('contingut==fileIn ' + (Math.abs(d) <= 0.25 ? 'OK' : 'MISMATCH(' + nf(d) + ')'));
                }
                if (isFinite(realIn) && isFinite(fileIn)) {
                    const d = realIn - fileIn;
                    chk.push('clip.inPoint==pla ' + (Math.abs(d) <= 0.25 ? 'OK' : 'MISMATCH(' + nf(d) + ')'));
                }
                if (isFinite(bStart) && isFinite(base) && isFinite(realIn) && isFinite(seqIn)) {
                    const tlContent = (bStart - base) - realIn;
                    const d = tlContent - seqIn;
                    chk.push('corchete-on-contingut ' + (Math.abs(d) <= 0.5 ? 'OK' : 'MISMATCH(' + nf(d) + ')'));
                }
                log('🔎 [DOMAINS] fase=EXTRACT domini=' + (cfd._isExtractedClip ? 'fitxer-extret' : 'source/bloc') +
                    ' | wsms(cleanfeed)=' + nf(cfd._wsmsCleanfeed) + ' base-fitxer=' + nf(cfd._fileBase) +
                    ' | bloc(media)=' + nf(cfd._mediaBlockStart) + '→' + nf(cfd._mediaBlockEnd) +
                    ' | handles=' + nf(cfd.handleSecs) +
                    ' | in/out(source)=' + nf(cfd._srcIn) + '/' + nf(cfd._srcOut) +
                    ' | ffmpeg -ss ' + nf(ff.ss) + ' -t ' + nf(ff.t) + ' (demanat ' + nf(ff.requestedIn) + ', pre-roll ' + nf(ff.preRoll) + ', keyframe=' + (ff.kfOk ? 'OK' : 'NO') + ')' +
                    ' | in/out(fitxer·pla)=' + nf(pl.fileIn) + '/' + nf(pl.fileOut) + ' dur=' + nf(pl.clipDur) +
                    ' | clip V1 in/out(real)=' + nf(rl.inPoint) + '/' + nf(rl.outPoint) + ' start=' + nf(rl.start) +
                    ' | seq IN/OUT=' + nf(pl.sweetSeqIn) + '/' + nf(pl.sweetSeqOut) +
                    ' | ' + (chk.length ? chk.join(' · ') : 'sense dades'));
            } catch (eDump) {
                log('⚠️ [DOMAINS] ' + eDump.message);
            }
        },

        /**
         * _rebuildManifestFromLocal: Regenera el manifest de sessió a partir de
         * l'última còpia local de l'escaleta al directori del projecte.
         * S'usa al botó FOTO (després de generar una nova escaleta) i a LOAD.
         * @param {Object} ctx - Context del projecte
         * @returns {Promise<{jsonMeta, jsonData, bounds}|null>}
         */
        _rebuildManifestFromLocal: async function (ctx) {
            const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
            const datePrefix = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
            const jsonMeta = await reader.ensureLocalCopy(ctx, datePrefix);
            if (!jsonMeta) {
                log("⚠️ [Manifest] Cap escaleta local per reconstruir el manifest.");
                return null;
            }
            const jsonData = await reader.load(jsonMeta.path);
            if (!jsonData) {
                log("⚠️ [Manifest] Escaleta local no carregable: " + jsonMeta.filename);
                return null;
            }
            try {
                // (#121, 2026-09-30) El snapshot cleanFeed.mediaStop del JSON pot quedar
                // curt si el manifest es reconstrueix més tard (la ingesta va continuar):
                // la durada REAL del fitxer mana, igual que a _runNew. Si no es pot
                // mesurar, es manté el snapshot (comportament anterior).
                let stopEffMf = jsonData.cleanFeed.mediaStop;
                try {
                    const ffMf = window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.FFmpeg;
                    const cfPathMf = jsonData.cleanFeed ? jsonData.cleanFeed.mediaPath : null;
                    if (ffMf && ffMf.getMediaDuration && cfPathMf &&
                        typeof reader.tcToSeconds === 'function' && typeof reader.secondsToTC === 'function') {
                        const durMf = await ffMf.getMediaDuration(cfPathMf);
                        if (durMf && durMf.ok) {
                            const stopRealMf = reader.tcToSeconds(jsonData.cleanFeed.mediaStart) + durMf.duration;
                            if (stopRealMf > reader.tcToSeconds(jsonData.cleanFeed.mediaStop) + 1) {
                                stopEffMf = reader.secondsToTC(stopRealMf);
                                log(`📏 [Manifest] Durada REAL del cleanFeed: ${durMf.duration.toFixed(1)}s → final ${stopEffMf} (snapshot ${jsonData.cleanFeed.mediaStop}).`);
                            }
                        }
                    }
                } catch (eDurMf) {
                    log('⚠️ [Manifest] No s\'ha pogut mesurar la durada real: ' + eDurMf.message, 'WARN');
                }
                const bounds = reader.calcPrecisionTrimBounds(
                    jsonData,
                    ctx.bloque,
                    jsonData.cleanFeed.mediaStart,
                    stopEffMf,
                    ctx.config
                );
                if (!bounds) {
                    log("⚠️ [Manifest] Bounds no calculables des de " + jsonMeta.filename);
                    return null;
                }
                const allItems = jsonData.escaleta ? (jsonData.escaleta.liniesEscaleta || []) : [];
                // ═══ (2026-09-25c) NO TREPITJAR LA REF DEL CLIP EXTRET ═══════════════════════════
                // Aquest és un dels 3 escriptors del manifest i l'ÚNIC que tornava a escriure la
                // ref en coords d'ORIGEN (wsms=cleanfeed, tlBlockInPointSec=source) DESPRÉS de
                // l'extracció. Conseqüència mesurada (TNC V1 2026-09-25, manifest final):
                //   wsms=49500 + tlBlockInPointSec=1978 (source) mentre el clip de V1 tenia base
                //   51478 → l'ancoratge depenia del pedaç FIX-C i el material quedava desplaçat.
                // Si el manifest ja ve del clip extret, la ref es CONSERVA i només s'actualitzen
                // blockBounds/escaletaItems.
                const _prevManifest = await FASTPASS_UI.SessionManifest.load(ctx);
                const _keepExtractedRef = !!(_prevManifest && _prevManifest.extractedClip &&
                    _prevManifest.extractedClip.isExtracted === true &&
                    _prevManifest.ref && _prevManifest.ref.worldSecMediaStart != null &&
                    _prevManifest.ref.tlBlockInPointSec != null);
                const _manPatch = {
                    program: { escaletaFile: jsonMeta.filename },
                    cleanFeed: jsonData.cleanFeed,
                    blockBounds: bounds,
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
                };
                if (!_keepExtractedRef) {
                    // Manifest sense clip extret (projecte nou / primera passada) → coords d'ORIGEN,
                    // com fins ara. (Pendent: unificar els 3 escriptors en coords de FITXER.)
                    _manPatch.ref = { ...bounds.ref, tlBlockInPointSec: bounds.mp4ExpandedInPoint };
                } else {
                    log('🧭 [Manifest] Ref del CLIP EXTRET conservada (no es reescriu en coords d\'ORIGEN): wsms=' +
                        Number(_prevManifest.ref.worldSecMediaStart).toFixed(2) + 's, tlBlockInPointSec=' +
                        Number(_prevManifest.ref.tlBlockInPointSec).toFixed(2) + 's');
                }
                await FASTPASS_UI.SessionManifest.save(ctx, _manPatch);
                log(`✅ [Manifest] Manifest regenerat des de: ${jsonMeta.filename}`);
                return { jsonMeta, jsonData, bounds };
            } catch (e) {
                log(`⚠️ [Manifest] Error reconstruint manifest: ${e.message}`);
                return null;
            }
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
