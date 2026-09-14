/**
 * ============================================================================
 * CORE: 4_Context (Sintetitzador de Context) - REVISAT v2.4.2
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Core = FASTPASS_UI.Core || {};

    const log = (...args) => FASTPASS_UI.Utils.log(...args);
    const getUtils = () => window.FASTPASS_UI.Utils;

    let _lastCheckAt = 0; // Guard de debounce

    // ─── MECÀNICA D'INICI (2026-09-04) ────────────────────────────────────────
    // La data de treball NO es dedueix de l'hora del programa ni dels repositoris.
    //   - Defecte: HOY (data del sistema) en seleccionar Programa+Bloque.
    //   - Mode correcció: AYER (Ctrl+clic a MAIN) → dia natural anterior.
    // S'ha eliminat el TimeGuard (PROGRAM_START_HOURS / PRE_EMISSION_GUARD_HOURS).

    FASTPASS_UI.Core.Context = {
        
        // Reporte de activos para UI "externa"
        missing: { wotts: false, media: false, srt: false, portada: false },

        // Últim estat calculat per checkContext (per al Ctrl+clic de MAIN)
        _lastConclusion: null,
        _lastButtonData: null,

        /**
         * _targetDateDir: Retorna la data de treball (YYYY_MM_DD).
         * @returns {string} Data del sistema (HOY) o dia natural anterior (AYER)
         *                   si State.workTarget === 'yesterday'.
         */
        _targetDateDir: function () {
            const useYesterday = !!(window.FASTPASS_UI && window.FASTPASS_UI.State &&
                window.FASTPASS_UI.State.workTarget === 'yesterday');
            const d = new Date();
            if (useYesterday) d.setDate(d.getDate() - 1);
            const dd = ('0' + d.getDate()).slice(-2);
            const mm = ('0' + (d.getMonth() + 1)).slice(-2);
            return '' + d.getFullYear() + '_' + mm + '_' + dd;
        },

        /**
         * _onMainClick: Handler central del botó MAIN.
         *   - Clic normal → executa l'acció de l'estat visible (CREAR/ACTUALITZAR...).
         *   - Ctrl+clic (mode correcció) → recalcula l'estat per AHIR i executa.
         * @param {Event|null} ev
         * @param {string|null} action - 'NEW' | 'UPDATE' | 'GO' | 'LOAD' | null
         * @param {Object|null} data
         */
        async _onMainClick(ev, action, data) {
            const u = getUtils();
            const useYesterday = !!(ev && (ev.ctrlKey || ev.metaKey));
            try {
                if (!useYesterday) {
                    if (!action) {
                        const st = this._lastConclusion;
                        if (st === 'MASSA') u.status("MASSA D'HORA: avui encara no hi ha res publicat", "warn");
                        else if (st === 'ESPERANT') {
                            const mot = (this._lastButtonData && this._lastButtonData.motiu) || '';
                            const sem = (this._lastButtonData && this._lastButtonData.semaforo) || null;
                            const cc = (sem && sem.esc && sem.esc.complete) ? sem.esc.complete : null;
                            if (mot === 'bloc_en_emissio') {
                                u.status("ESPERANT: el bloc encara s'està emetent" + (cc && cc.total ? (" (" + cc.emitted + "/" + cc.total + " ítems)") : "") + ". Fes FOTO quan acabi l'emissió.", "warn");
                            } else {
                                u.status('ESPERANT: la ingesta encara no ha arribat al TC final. Torna-hi més tard', "warn");
                            }
                        }
                        return;
                    }
                    // R6: la data de treball es fixa EN EL MOMENT DEL CLIC. Si l'estat
                    // visible ha quedat obsolet (p. ex. ha passat la mitjanit) es recalcula.
                    let act = action;
                    let dt = data;
                    const targetNow = this._targetDateDir();
                    if (!dt || !dt.dateDir || dt.dateDir !== targetNow) {
                        u.log('[MAIN] Data de treball canviada. Recalculant estat...', 'DEBUG');
                        await this.checkContext({ force: true });
                        const stR = this._lastConclusion;
                        const dtR = this._lastButtonData;
                        if (!(stR === 'NEW' || stR === 'UPDATE' || stR === 'GO' || stR === 'LOAD')) {
                            u.status('Estat del dia canviat (' + stR + '). Reintenta-ho.', 'warn');
                            return;
                        }
                        act = (stR === 'NEW') ? 'NEW' : stR;
                        dt = dtR;
                    }
                    await FASTPASS_UI.Workflows.MainButton.runMainAction(act, dt);
                    return;
                }
                // ── MODO CORRECCIÓN: Ctrl+clic → AYER ──
                const St = window.FASTPASS_UI.State;
                u.log('🔄 [MAIN] Ctrl+clic → mode correcció (AHIR).', 'INFO');
                St.workTarget = 'yesterday';
                await this.checkContext({ force: true });
                const stA = this._lastConclusion;
                const dataA = this._lastButtonData;
                if (stA === 'NEW' || stA === 'UPDATE' || stA === 'GO' || stA === 'LOAD') {
                    const actA = (stA === 'NEW') ? 'NEW' : stA;
                    u.log('🔄 [MAIN] Correcció AHIR → ' + stA + (dataA && dataA.name ? ' · ' + dataA.name : ''), 'INFO');
                    await FASTPASS_UI.Workflows.MainButton.runMainAction(actA, dataA);
                } else {
                    u.log('⚠️ [MAIN] Mode correcció: AHIR sense material útil (estat ' + stA + ')', 'WARN');
                    u.status('AHIR: sense material per corregir', 'warn');
                }
                St.workTarget = 'today';
                await this.checkContext({ force: true });
            } catch (e) {
                u.handleError(e, 'onMainClick');
            }
        },

        async checkContext() {
            if (!getUtils().isJsxReady) return; 
        
            // 📍 Capturamos los elementos del DOM al inicio
            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
        
            // 📍 DEBOUNCE
            const now = Date.now();
            const _opts = (arguments && arguments.length) ? arguments[0] : null;
            if (!(_opts && _opts.force) && now - _lastCheckAt < 1000) return;
            _lastCheckAt = now;
        
            try {
                // Ahora ya puedes validar si existen
                if (!elProg || !elBloc || !elProg.value || elBloc.value === "---") {
                    console.log("⚠️ Selectores incompletos o no encontrados.");
                    this.updateButton('DISABLED');
                    return;
                }
        
                const config = FASTPASS_UI.Config.get();
                // D7.2: Preservar State.dateDir si ja va ser corregit per _runNew().
                // La data d'emissió de l'escaleta és la font única de veritat.
                // Només s'usa getFormattedDate() com a fallback si State.dateDir no existeix.
                // BUG #1 FIX (2026-06-09): Resetear dateDir si el programa ha canviat.
                // Evita contaminació creuada entre programes (ex: TNCOMARQUES → TN_VESPRE).
                const progId = (config.mapeoProgramas[elProg.value] && config.mapeoProgramas[elProg.value].archivo) || '';
                const lastProg = (window.FASTPASS_UI && window.FASTPASS_UI.State && window.FASTPASS_UI.State.lastProgram);
                if (progId && lastProg && progId !== lastProg) {
                    getUtils().log('🔄 [checkContext] Programa canviat (' + lastProg + ' → ' + progId + '). Resetejant dateDir.', 'DEBUG');
                    if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                        window.FASTPASS_UI.State.dateDir = null;
                        window.FASTPASS_UI.State.workTarget = 'today';
                    }
                }
                // Resetear dateDir també si canvia el bloc dins del mateix programa.
                // Evita que un dateDir heretat d'un workflow anterior falli el scan
                // i mostri erròniament "NOU PROJECTE" quan el projecte ja existeix.
                const lastBloc = (window.FASTPASS_UI && window.FASTPASS_UI.State && window.FASTPASS_UI.State.lastBloc);
                if (elBloc.value && lastBloc && elBloc.value !== lastBloc) {
                    getUtils().log('🔄 [checkContext] Bloc canviat (' + lastBloc + ' → ' + elBloc.value + '). Resetejant dateDir.', 'DEBUG');
                    if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                        window.FASTPASS_UI.State.dateDir = null;
                        window.FASTPASS_UI.State.workTarget = 'today';
                    }
                }
                // Guardar programa actual per a la següent comparació
                if (window.FASTPASS_UI && window.FASTPASS_UI.State && progId) {
                    window.FASTPASS_UI.State.lastProgram = progId;
                }
                // Guardar bloc actual per a la següent comparació
                if (window.FASTPASS_UI && window.FASTPASS_UI.State && elBloc.value) {
                    window.FASTPASS_UI.State.lastBloc = elBloc.value;
                }
                const ctx = {
                    config: config,
                    progData: config.mapeoProgramas[elProg.value],
                    bloque: elBloc.value,
                    dateDir: this._targetDateDir()
                };

                // MECÀNICA D'INICI (2026-09-04): data explícita HOY (o AHIR amb Ctrl+clic).
                getUtils().log('[dateDir] Data de treball: ' + ctx.dateDir + ((window.FASTPASS_UI.State && window.FASTPASS_UI.State.workTarget === 'yesterday') ? ' (AHIR, mode correcció)' : ' (HOY)'), 'DEBUG');

                // Actualizar estado global
                if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                    Object.assign(window.FASTPASS_UI.State, ctx);
                }
            
                // 1. RUTA DE RECERCA
                let folderPath = config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir + "/";
                
                // 2. ESCANEIG GENÈRIC (Usant Utils.readFolder a través de Scanner)
                let projectFiles = await getUtils().readFolder(folderPath);

                if (!projectFiles || projectFiles.length === 0) {
                    getUtils().log("ℹ️ Carpeta buida o inexistent. Conclusió: NEW", "DEBUG");
                }
            
                // 3. LÒGICA DE NEGOCI (Usant el teu Scanner.js)
                const progKey = ctx.progData.wott || ctx.progData.archivo;
                let existingProjectName = FASTPASS_UI.Logic.Scan.selectedProject(
                    projectFiles,
                    progKey,
                    ctx.bloque
                );

                // ── MECÀNICA D'INICI (2026-09-04) ────────────────────────────────
                // Estats del botó: MASSA D'HORA / ESPERANT / CREAR / ACTUALITZAR.
                // Si el projecte del dia ja existeix → ACTUALITZAR (s'obri/recarrega);
                // només quan NO existeix projecte s'avalua si el dia té material útil.
                let semaforoData = {
                    esc: { found: false, ready: false },
                    mp4: false, wot: false, srt: false
                };
                let earlyState = null;
                const readerE = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                if (readerE) {
                    const datePrefixD = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                    try {
                        semaforoData.esc = await readerE.getStatus(ctx.progData.archivo, ctx.bloque, datePrefixD);
                    } catch (eSt) {
                        getUtils().log('⚠️ [checkContext] Error llegint estat de l\'escaleta: ' + eSt.message, 'DEBUG');
                    }
                }

                if (!existingProjectName) {
                    // Ingesta en curs = el cleanFeed encara no ha arribat al TC de sortida del bloc.
                    let ingestaEnCurs = false;

                    // ── ESCALETA LOCAL (FOTO on_demand) ────────────────────────────
                    // Si el servidor encara no té el JSON del dia (el bloc acaba d'emetre
                    // i la publicació triga), la "foto" generada amb el botó FOTO ja viu al
                    // directori del dia (escaleta_on_demand_*.json o còpia del NAS). Si
                    // existeix i conté el bloc, es considera la escaleta vàlida → l'estat
                    // passa de "MASSA D'HORA" a "CREAR".
                    if ((!semaforoData.esc || !semaforoData.esc.found)
                        && readerE && typeof readerE.lookupLocalStatus === 'function') {
                        try {
                            const localEsc = await readerE.lookupLocalStatus(ctx);
                            if (localEsc && localEsc.found) {
                                semaforoData.esc = localEsc;
                                getUtils().log('📷 [checkContext] Escaleta local detectada (FOTO/on_demand): ' + localEsc.filename, 'INFO');
                            }
                        } catch (eLoc) {
                            getUtils().log('⚠️ [checkContext] Error buscant escaleta local: ' + eLoc.message, 'DEBUG');
                        }
                    }

                    if (semaforoData.esc && semaforoData.esc.mediaStop && semaforoData.esc.blockOut && readerE) {
                        try {
                            const stopSecs = readerE.tcToSeconds(semaforoData.esc.mediaStop);
                            const outSecs = readerE.tcToSeconds(semaforoData.esc.blockOut);
                            ingestaEnCurs = (stopSecs < outSecs);
                        } catch (eIng) { /* TC no comparable */ }
                    }

                    if (!semaforoData.esc || !semaforoData.esc.found) {
                        // Sense JSON del dia D (ni remot ni local): hi ha MP4/SRT o chyrons
                        // del dia (ingesta/preparació en curs)?
                        let mediaD = null;
                        let wotsD = null;
                        const sc = (window.FASTPASS_UI && window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.Scan);
                        try { if (sc && sc.mediaAssets) mediaD = await sc.mediaAssets(ctx); } catch (eM) { /* sense xarxa */ }
                        try { if (sc && sc.wotts) wotsD = await sc.wotts(ctx); } catch (eW) { /* sense xarxa */ }
                        const hasIngesta = !!(mediaD && (mediaD.mp4 || mediaD.srt));
                        const hasChyrons = !!(wotsD && wotsD.list && wotsD.list.length > 0);
                        earlyState = (hasIngesta || hasChyrons) ? 'ESPERANT' : 'MASSA';
                    } else if (!semaforoData.esc.ready || ingestaEnCurs) {
                        earlyState = 'ESPERANT';
                    }
                }

                if (earlyState) {
                    const data = { ...ctx, name: earlyState };
                    // Motiu llegible per als estats d'espera (bloc en emissió vs ingesta)
                    data.motiu = (earlyState === 'ESPERANT' && semaforoData.esc && semaforoData.esc.complete && !semaforoData.esc.complete.ok)
                        ? 'bloc_en_emissio'
                        : (earlyState === 'ESPERANT' ? 'ingesta' : 'sense_dades');
                    data.semaforo = semaforoData;
                    this._lastConclusion = earlyState;
                    this._lastButtonData = data;
                    this.updateLights(elProg.value, ctx.bloque, null, false, semaforoData);
                    this.updateButton(earlyState, data);
                    return;
                }

                let conclusion = 'NEW';
                let lockOwner = null;
                let lockFile = null;
                let isLockOwned = true;
            
                if (existingProjectName) {
                    // Obtener lista de proyectos abiertos en Premiere
                    let openProjects = [];
                    try {
                        const openProjectsRaw = await getUtils().callJSX("Context.list()");
                        openProjects = JSON.parse(openProjectsRaw || "[]");
                    } catch (e) {
                        // Ignorar error
                    }
                    let isProjectOpen = false;
                    let isProjectActive = false;
                    let activeProjectName = '';
                    // Obtener proyecto activo (vía Project.path o Context.activeProj)
                    try {
                        const activeProjectPath = await getUtils().callJSX("FASTPASS.Project.path()");
                        if (activeProjectPath) {
                            const parts = activeProjectPath.split(/[\\/]/);
                            activeProjectName = parts[parts.length - 1];
                        }
                    } catch (e) {
                        // Ignorar error
                    }
                    // Si no se pudo obtener ruta, intentar con Context.activeProj()
                    if (!activeProjectName) {
                        try {
                            activeProjectName = await getUtils().callJSX("Context.activeProj()");
                        } catch (e) {
                            // Ignorar
                        }
                    }
                    
                    if (openProjects.length > 0) {
                        // openProjects es array de strings (nombres de proyecto con extensión)
                        isProjectOpen = openProjects.includes(existingProjectName);
                        // Determinar si el proyecto activo coincide con existingProjectName
                        isProjectActive = activeProjectName === existingProjectName;
                        // Si no hay activeProjectName, asumir que el primer proyecto de la lista es el activo (fallback)
                        if (!activeProjectName && openProjects.length > 0) {
                            isProjectActive = openProjects[0] === existingProjectName;
                        }
                    } else {
                        // Fallback a Project.path() para determinar si el proyecto está abierto y activo
                        if (activeProjectName) {
                            isProjectOpen = activeProjectName === existingProjectName;
                            isProjectActive = isProjectOpen;
                        }
                    }

                    // Fallback: si el proyecto no aparece en openProjects pero fue el último abierto por nosotros, asumir que está abierto
                    if (!isProjectOpen && window.FASTPASS_UI && window.FASTPASS_UI.State && window.FASTPASS_UI.State.lastOpenedProjectName === existingProjectName) {
                        isProjectOpen = true;
                    }

                    // Mirem si hi ha lock (Lògica JS pura sobre la llista ja descarregada)
                    lockFile = projectFiles.find(f => f.name === existingProjectName + ".lock");
                    const currentUser = config.autor;
                    
                    if (lockFile) {
                        // Hi ha bloqueig: llegim el contingut (qui és l'amo)
                        const lockPath = folderPath + lockFile.name;
                        const safeLockPath = lockPath.replace(/\\/g, '/').replace(/'/g, "\\'");
                        lockOwner = await getUtils().callJSX(`IO.readTxt('${safeLockPath}')`);
                        // Si el lock está vacío, asumir que es nuestro (puede ser un lock recién creado)
                        if (lockOwner.trim() === "") {
                            lockOwner = currentUser;
                        }
                    }
                    
                    // Determinar si el lock es nuestro (si no hay lock, se considera nuestro)
                    isLockOwned = lockFile ? lockOwner.trim() === currentUser.trim() : true;
                    
                    // Usamos isProjectOpen e isProjectActive ya calculadas
                    if (isProjectActive) {
                        conclusion = 'UPDATE';
                    } else if (isProjectOpen && !isProjectActive) {
                        conclusion = 'GO';
                    } else {
                        conclusion = 'LOAD';
                    }
                }
            
                getUtils().log("🔍 Conclusión contexto: " + conclusion + (existingProjectName ? " (projecte: " + existingProjectName + ")" : ""), "DEBUG");
                
                // [NOU] SEMAFOR: completar estats d'assets (esc ja avaluat a la fase anterior)
                try {
                    // 2. Assets al projecte (nomes si el projecte esta obert o en UPDATE)
                    if (conclusion === 'UPDATE' || conclusion === 'GO') {
                        const [hasMp4, chyItemsRaw, hasSrt, mediaFiles] = await Promise.all([
                            getUtils().callJSX("hasClips(1, 'video')"),
                            getUtils().callJSX("FASTPASS.Project.items('CHY')"),
                            getUtils().callJSX("hasClips(1, 'subtitle')"),
                            getUtils().readFolder(ctx.config.rutas.verticalitzacio) // Per al SRT físic
                        ]);

                        // MP4
                        const mp4Present = (hasMp4 === "true");
                        if (!mp4Present) {
                            semaforoData.mp4 = 'error';
                        } else if (semaforoData.esc.mediaStop && semaforoData.esc.blockOut) {
                            const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                            const stopSecs = reader.tcToSeconds(semaforoData.esc.mediaStop);
                            const outSecs = reader.tcToSeconds(semaforoData.esc.blockOut);
                            semaforoData.mp4 = (stopSecs < outSecs) ? 'pending' : 'ready';
                        } else {
                            semaforoData.mp4 = 'ready';
                        }

                        // WOT
                        let chyItems = [];
                        try { chyItems = JSON.parse(chyItemsRaw || "[]"); } catch(e) {}
                        const wottCount = chyItems.length;
                        const expected = semaforoData.esc.totalExpected || 0;
                        
                        if (wottCount === 0) semaforoData.wot = 'error';
                        else if (expected > 0 && wottCount < expected) semaforoData.wot = 'pending';
                        else semaforoData.wot = 'ready';
                        semaforoData.wotDetail = `${wottCount}/${expected}`;

                        // SRT
                        const srtPresent = (hasSrt === "true");
                        if (srtPresent) {
                            semaforoData.srt = 'ready';
                        } else {
                            // Mirem si existeix el fitxer SRT al NAS per decidir si Error o Gris
                            const prefix = `${ctx.progData.archivo}_${ctx.bloque}_`.toUpperCase();
                            const srtOnDisk = (mediaFiles || []).find(f => f.name.toUpperCase().includes(prefix) && f.name.toUpperCase().endsWith('.SRT'));
                            semaforoData.srt = srtOnDisk ? 'error' : 'off';
                        }
                    }
                } catch (e) {
                    getUtils().log("⚠️ Error recollint dades del semàfor: " + e.message, "DEBUG");
                }

                // --- Semàfor per al cas SENSE projecte (escaleta de FOTO/local) ---
                // Informa de què ja és al NAS perquè l'usuari sàpiga quan pot crear o
                // actualitzar. MP4/Rètols en VERD INTERMITENT = ja importables.
                if (!existingProjectName && semaforoData.esc && semaforoData.esc.found) {
                    try {
                        const scN = (window.FASTPASS_UI && window.FASTPASS_UI.Logic && window.FASTPASS_UI.Logic.Scan);
                        if (scN && scN.mediaAssets) {
                            const mediaN = await scN.mediaAssets(ctx);
                            semaforoData.mp4 = (mediaN && mediaN.mp4) ? 'blink' : 'pending';
                            semaforoData.srt = (mediaN && mediaN.srt) ? 'error' : 'off';
                        }
                        if (scN && scN.wotts) {
                            const wN = await scN.wotts(ctx);
                            const nW = (wN && wN.list) ? wN.list.length : 0;
                            const expN = semaforoData.esc.totalExpected || 0;
                            semaforoData.wot = (nW === 0) ? 'pending' : ((expN > 0 && nW < expN) ? 'pending' : 'blink');
                            semaforoData.wotDetail = nW + '/' + expN;
                        }
                    } catch (eSN) {
                        getUtils().log('⚠️ [checkContext] Error calculant semàfor NEW: ' + eSN.message, 'DEBUG');
                    }
                }

                // 4. FEEDBACK UI
                const finalName = existingProjectName || `Pruebas_${ctx.progData.archivo}_${ctx.bloque}_PENDENT.prproj`;
                const data = { ...ctx, name: finalName };
                if (lockFile) {
                    data.lockExists = true;
                    data.lockOwner = lockOwner;
                    data.isLockOwned = lockOwner.trim() === ctx.config.autor.trim();
                }
                
                this.updateLights(elProg.value, ctx.bloque, null, (conclusion === 'UPDATE'), semaforoData);
                this._lastConclusion = conclusion;
                this._lastButtonData = data;
                this.updateButton(conclusion, data);
            
            } catch (e) {
                getUtils().log("💥 Error checkContext: " + e.message, "ERROR");
                // FIX A3: No mantenir 'NEW' per defecte en cas d'error.
                // Un error de xarxa/permisos es pot interpretar erròniament com
                // "carpeta buida". Forcem WAITING per evitar que l'usuari premi
                // "NOU PROJECTE" i sobrescrigui un projecte existent.
                this.updateButton('WAITING', {
                    msg: "Error de xarxa o permisos. Reintentant...",
                    config: {},
                    progData: {},
                    bloque: '---',
                    dateDir: '',
                    name: 'ERROR'
                });
            }
        },

        updateLights(prog, bloc, theme, active, semaforoData) {
            const set = (id, state, title) => {
                const el = document.getElementById(id);
                if (el) {
                    let className = "light off";
                    if (state === 'ready') className = "light ready";
                    else if (state === 'pending') className = "light pending";
                    else if (state === 'error') className = "light error";
                    else if (state === true || state === 'on') className = "light ready";
                    else if (state === 'blink') className = "light blink"; 
                    
                    el.className = className;
                    if (title) el.parentElement.title = title;
                }
            };

            // Luces clásicas
            set('light-prog', !!prog);
            set('light-bloc', !!bloc && bloc !== "---");
            set('light-tema', !!theme && theme !== "PENDENT");
            set('light-seq', !!active);

            // 🚦 Luces nuevas (Semáforo)
            if (semaforoData) {
                // ESC: Escaleta
                if (!semaforoData.esc.found) set('sem-esc', 'error', "No s'ha trobat cap escaleta (servidor ni FOTO local)");
                else if (!semaforoData.esc.ready) {
                    const cc = semaforoData.esc.complete;
                    const nom = semaforoData.esc.local ? 'local (FOTO)' : 'trobada';
                    set('sem-esc', 'pending', (cc && cc.total)
                        ? ('Escaleta ' + nom + ': bloc en emissió (' + cc.emitted + '/' + cc.total + ' ítems)')
                        : ('Escaleta ' + nom + ' però BLOC NO READY'));
                }
                else set('sem-esc', 'ready', semaforoData.esc.local
                    ? `Escaleta OK (FOTO local: ${semaforoData.esc.filename})`
                    : `Escaleta OK (${semaforoData.esc.timestamp})`);

                // MP4: CleanFeed
                const mp4Title = semaforoData.mp4 === 'pending' ? 'El stream encara no està disponible (ingesta en curs)' : (semaforoData.mp4 === 'error' ? 'Pista V1 buida' : (semaforoData.mp4 === 'blink' ? 'CleanFeed llest per importar' : 'CleanFeed OK'));
                set('sem-mp4', semaforoData.mp4, mp4Title);

                // WOT: Rètols
                const wotTitle = semaforoData.wot === 'pending' ? `Falten rètols: ${semaforoData.wotDetail}` : (semaforoData.wot === 'error' ? 'No hi ha rètols al Bin CHY' : `Tots importats: ${semaforoData.wotDetail}`);
                set('sem-wot', semaforoData.wot, wotTitle);

                // SRT: Subtítols
                const srtTitle = semaforoData.srt === 'ready' ? 'SRT ja importat' : (semaforoData.srt === 'error' ? 'SRT trobat al NAS (falta importar)' : 'No hi ha fitxer SRT al NAS');
                set('sem-srt', semaforoData.srt, srtTitle);
            }
        },

        updateButton(state, data) {
            const btn = document.getElementById('btnMainAction');
            if (!btn) return;
        
            // 📍 Forzamos tamaño mínimo por si el CSS falla
            btn.style.minHeight = "60px"; 
            btn.style.width = "100%";
            
            // 🔍 [CORRECCIÓN] No deshabilitar el botón si estamos en modo LOAD/NEW/GO/UPDATE 
            // solo por el Registry, a menos que el estado sea explícitamente DISABLED o WAITING.
            // Si el Registry lo puso en disabled, este updateButton debe prevalecer si el contexto es válido.
            btn.disabled = (state === 'DISABLED' || state === 'WAITING');
            
            // Si el Registry ha deshabilitado el flujo pero nosotros queremos crear uno nuevo, 
            // permitimos que el botón principal siga funcionando.

            switch (state) {
                case 'NEW':
                    btn.innerText = "CREAR";
                    btn.className = "square-large btn-new";
                    btn.onclick = function (ev) {
                        FASTPASS_UI.Core.Context._onMainClick(ev, 'NEW', data);
                    };
                    break;
                case 'UPDATE':
                case 'GO':
                case 'LOAD':
                    btn.innerText = "ACTUALITZAR";
                    btn.className = "square-large btn-new";
                    btn.onclick = function (ev) {
                        FASTPASS_UI.Core.Context._onMainClick(ev, state, data);
                    };
                    break;
                case 'MASSA':
                    btn.innerText = "MASSA D'HORA";
                    btn.className = "square-large";
                    btn.title = "Avui encara no hi ha res publicat. Ctrl+clic = treballar amb AHIR.";
                    btn.onclick = function (ev) {
                        FASTPASS_UI.Core.Context._onMainClick(ev, null, data);
                    };
                    break;
                case 'ESPERANT':
                    btn.innerText = "ESPERANT...";
                    btn.className = "square-large";
                    btn.title = "La ingesta encara no ha arribat al TC final. Ctrl+clic = treballar amb AHIR.";
                    btn.onclick = function (ev) {
                        FASTPASS_UI.Core.Context._onMainClick(ev, null, data);
                    };
                    break;
                case 'WAITING':
                    btn.innerText = data.msg || "ESPERANT...";
                    break;
                case 'LOCKED':
                    btn.innerText = "BLOQUEJAT: " + (data.lockOwner || data.user || "ALTRE");
                    btn.disabled = false;
                    btn.style.border = "1px solid #dc3545";
                    btn.style.color = "#dc3545";
                    btn.onclick = function(ev) {
                        const forceData = { ...data, forceOverride: true };
                        FASTPASS_UI.Workflows.MainButton.runMainAction('LOAD', forceData);
                    };
                    break;
                default:
                    btn.innerText = "ESPERANT";
            }
        },

        renderStructure(pieces) {
            const container = document.getElementById('structure-table');
            if (!container) return;

            if (!pieces || pieces.length === 0) {
                container.innerHTML = '<div class="structure-msg">Esperant anàlisi de guion...</div>';
                return;
            }

            let html = '';
            for (let p of pieces) {
                html += `
                    <div class="piece-row">
                        <div class="piece-id">${p.id}</div>
                        <div class="piece-title">${p.theme}</div>
                        <div class="piece-status"><span></span></div>
                    </div>
                `;
            }
            container.innerHTML = html;
        },

        async init() {
            const p = document.getElementById('programa');
            const b = document.getElementById('bloc');
            const config = FASTPASS_UI.Config.get();
        
            if (!p || !b) {
                console.error("❌ [CONTEXT] No se han encontrado los selects en el HTML");
                return;
            }
        
            // 1. Rellenar programas
            if (config.mapeoProgramas) {
                p.innerHTML = "";
                for (let id in config.mapeoProgramas) {
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = id;
                    p.appendChild(opt);
                }
                console.log("✅ [CONTEXT] Programas cargados en el select");
                // Seleccionar el primer programa si no hay valor
                if (p.options.length > 0 && !p.value) {
                    p.selectedIndex = 0;
                    console.log("✅ [CONTEXT] Seleccionado primer programa por defecto:", p.value);
                }
            }
        
            // 2. IMPORTANTE: Rellenar bloques si están vacíos (V1...V5)
            if (b.options.length <= 1) {
                const blocs = ["V1", "V2", "V3", "V4", "V5"];
                b.innerHTML = ""; // Limpiar el "---"
                blocs.forEach(val => {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = val;
                    b.appendChild(opt);
                });
                console.log("✅ [CONTEXT] Bloques V1-V5 inyectados");
                // Seleccionar el primer bloque si no hay valor
                if (b.options.length > 0 && !b.value) {
                    b.selectedIndex = 0;
                    console.log("✅ [CONTEXT] Seleccionado primer bloque por defecto:", b.value);
                }
            }
        
            // 3. Cargar lo que había guardado el usuario
            if (FASTPASS_UI.Config.loadSelection) {
                FASTPASS_UI.Config.loadSelection();
                console.log("💾 [CONTEXT] Selección recuperada:", p.value, b.value);
            }
        
            // 4. Definir el Trigger con LOGS
            const trigger = async () => {
                console.log("🔄 [EVENT] Cambio en selectores detectado");
                FASTPASS_UI.Config.saveSelection(p);
                FASTPASS_UI.Config.saveSelection(b);
                
                // Ejecutamos la lógica de actualización
                try {
                    await this.checkContext();
                    await this.syncConductorUI();
                } catch (e) {
                    console.error("💥 Error en trigger de contexto:", e);
                }
            };
        
            // 5. Vincular eventos
            p.onchange = trigger; // Usamos onchange directo para asegurar que no hay duplicados
            b.onchange = trigger;
        
            // 6. Arrencada inicial forzada
            console.log("🚀 [CONTEXT] Forzando primer check...");
            try {
                await this.checkContext();
                await this.syncConductorUI();
            } catch (e) {
                console.error("💥 Error en inicialización de contexto:", e);
            }
        },

        async syncConductorUI() {
            const utils = FASTPASS_UI.Utils;
            const config = FASTPASS_UI.Config.get();
            const select = document.getElementById('conductor');
            const programKey = document.getElementById('programa').value;

            if (!select || !programKey) return;

            // 1. Obtenim titulars i substituts (Strings)
            const progData = config.mapeoProgramas[programKey];
            let defaults = [];
            if (progData && progData.conductors) {
                defaults = [].concat(progData.conductors.titular, progData.conductors.substituts).filter(Boolean);
            }

            // 2. Llegim el NAS (Ara torna [{name: "...", mtime: ...}])
            const nasFiles = await utils.readFolder(config.rutas.conductors);

            // 📍 CANVI 1: Filtrem usant f.name
            const validNasFiles = (nasFiles || []).filter(f => {
                const n = (f.name || f).toString();
                return n.includes("Conduct_") && n.includes(".mov");
            });

            select.innerHTML = "";

            // A. Afegim DEFAULTS
            if (defaults.length > 0) {
                const groupDefault = document.createElement('optgroup');
                groupDefault.label = "⭐ CONDUCTORS PROGRAMA";

                defaults.forEach(fileName => {
                    const opt = document.createElement('option');
                    opt.value = fileName;
                    opt.textContent = fileName.replace('Conduct_', '').replace('.mov', '');
                    groupDefault.appendChild(opt);
                });
                select.appendChild(groupDefault);
            }

            // B. Afegim la resta del NAS
            // 📍 CANVI 2: Comparem contra f.name
            const others = validNasFiles.filter(f => !defaults.includes(f.name || f));

            if (others.length > 0) {
                const groupOthers = document.createElement('optgroup');
                groupOthers.label = "🌐 ALTRES (NAS)";

                others.forEach(fileObj => {
                    // 📍 CANVI 3: Extraiem el nom de l'objecte
                    const fileName = fileObj.name || fileObj;
                    const opt = document.createElement('option');
                    opt.value = fileName;
                    opt.textContent = fileName.replace('Conduct_', '').replace('.mov', '');
                    groupOthers.appendChild(opt);
                });
                select.appendChild(groupOthers);
            }

            if (select.options.length > 0) select.selectedIndex = 0;
        },

        _extractThemeFromFiles(fileList) {
            if (!fileList || fileList.length === 0) return null;
            
            // Busquem el primer fitxer que tingui el patró de Tema-Titol
            for (let i = 0; i < fileList.length; i++) {
                const f = fileList[i];
                const fileName = (f.name || f).toString();
                
                // Regex actualitzada: busca el text entre 'Tema-Titol_' i el següent punt/codi
                const match = fileName.match(/Tema-Titol_(.*?)\.\d+/i);
                if (match && match[1]) return match[1];
            }
            return null;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
