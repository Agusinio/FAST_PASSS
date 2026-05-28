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

    FASTPASS_UI.Core.Context = {
        
        // Reporte de activos para UI "externa"
        missing: { wotts: false, media: false, srt: false, portada: false },

        async checkContext() {
            if (!getUtils().isJsxReady) return;
        
            // 📍 Capturamos los elementos del DOM al inicio
            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
        
            // 📍 DEBOUNCE
            const now = Date.now();
            if (now - _lastCheckAt < 1000) return;
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
                const existingDateDir = (window.FASTPASS_UI && window.FASTPASS_UI.State && window.FASTPASS_UI.State.dateDir);
                const ctx = {
                    config: config,
                    progData: config.mapeoProgramas[elProg.value],
                    bloque: elBloc.value,
                    dateDir: existingDateDir || getUtils().getFormattedDate().replace(/"/g, "").trim()
                };
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
                const progKey = ctx.progData.archivo_wott || ctx.progData.archivo;
                let existingProjectName = FASTPASS_UI.Logic.Scan.selectedProject(
                    projectFiles,
                    progKey,
                    ctx.bloque
                );

                // ── FIX A1: Si no s'ha trobat projecte al dateDir actual, escanejar
                // directoris germans (DD_MM_YYYY) sota progData.directorio. Això resol
                // el cas on State.dateDir és del programa anterior o de la data del sistema,
                // però el projecte real està en un altre directori de data.
                if (!existingProjectName) {
                    const parentPath = config.rutas.destinoBase + ctx.progData.directorio + "/";
                    const dateDirs = await getUtils().readFolder(parentPath);
                    if (dateDirs && dateDirs.length > 0) {
                        // Filtrar només directoris amb format DD_MM_YYYY
                        const datePattern = /^\d{2}_\d{2}_\d{4}$/;
                        const candidateDirs = dateDirs
                            .filter(function(d) { return datePattern.test(d.name); })
                            .sort(function(a, b) { return new Date(b.mtime) - new Date(a.mtime); });
                        
                        getUtils().log("🔍 [checkContext] Escanejant " + candidateDirs.length + " directoris germans per trobar projecte " + progKey + "_" + ctx.bloque, "DEBUG");
                        
                        for (var di = 0; di < candidateDirs.length; di++) {
                            // 🔒 FIX B1: Només acceptar directoris dins de la finestra temporal
                            // (avui, o ahir si hora < 4 AM). Evita trobar projectes obsolets
                            // de dies anteriors quan el dateDir actual està buit.
                            if (!getUtils().isDateDirInTemporalWindow(candidateDirs[di].name)) {
                                continue;
                            }
                            const candidatePath = parentPath + candidateDirs[di].name + "/";
                            const candidateFiles = await getUtils().readFolder(candidatePath);
                            if (candidateFiles && candidateFiles.length > 0) {
                                const match = FASTPASS_UI.Logic.Scan.selectedProject(
                                    candidateFiles, progKey, ctx.bloque
                                );
                                if (match) {
                                    // Trobat! Actualitzar dateDir i reescanejar
                                    const oldDateDir = ctx.dateDir;
                                    ctx.dateDir = candidateDirs[di].name;
                                    if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                                        window.FASTPASS_UI.State.dateDir = candidateDirs[di].name;
                                    }
                                    existingProjectName = match;
                                    folderPath = candidatePath;
                                    projectFiles = candidateFiles;
                                    getUtils().log("✅ [checkContext] Projecte trobat a dir germà: " + candidateDirs[di].name + " (dateDir corregit des de " + oldDateDir + ")", "DEBUG");
                                    break;
                                }
                            }
                        }
                    }

                    // ── FIX A2: Si encara no s'ha trobat, intentar deduir dateDir des de
                    // l'escaleta JSON (font única de veritat). Si l'escaleta té data d'emissió
                    // diferent de la del sistema o State, es corregeix i es re-escaneja.
                    if (!existingProjectName) {
                        try {
                            const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                            if (reader) {
                                const escMeta = await reader.findLatest(ctx.progData.archivo);
                                if (escMeta && escMeta.filename) {
                                    const emissionDate = getUtils().extractDateFromEscaletaFilename(escMeta.filename);
                                    if (emissionDate && emissionDate !== ctx.dateDir) {
                                        const oldDateDir = ctx.dateDir;
                                        ctx.dateDir = emissionDate;
                                        if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                                            window.FASTPASS_UI.State.dateDir = emissionDate;
                                        }
                                        // Re-escanejar amb el dateDir corregit
                                        folderPath = config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir + "/";
                                        projectFiles = await getUtils().readFolder(folderPath);
                                        existingProjectName = FASTPASS_UI.Logic.Scan.selectedProject(
                                            projectFiles, progKey, ctx.bloque
                                        );
                                        getUtils().log("📅 [checkContext] dateDir corregit des d'escaleta: " + oldDateDir + " → " + emissionDate + (existingProjectName ? " (projecte trobat!)" : " (sense projecte)"), "DEBUG");
                                    }
                                }
                            }
                        } catch (eDate) {
                            getUtils().log("⚠️ [checkContext] Error deduint dateDir d'escaleta: " + eDate.message, "DEBUG");
                        }
                    }
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
                
                // 🚦 [NOU] SEMÀFOR: Recollir estats d'assets
                let semaforoData = {
                    esc: { found: false, ready: false },
                    mp4: false, wot: false, srt: false
                };

                try {
                    // 1. Escaleta JSON
                    const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                    if (reader) {
                        semaforoData.esc = await reader.getStatus(ctx.progData.archivo, ctx.bloque);
                    }

                    // 2. Assets al projecte (només si el projecte està obert o en UPDATE)
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

                // 4. FEEDBACK UI
                const finalName = existingProjectName || `Pruebas_${ctx.progData.archivo}_${ctx.bloque}_PENDENT.prproj`;
                const data = { ...ctx, name: finalName };
                if (lockFile) {
                    data.lockExists = true;
                    data.lockOwner = lockOwner;
                    data.isLockOwned = lockOwner.trim() === ctx.config.autor.trim();
                }
                
                this.updateLights(ctx.programa, ctx.bloque, null, (conclusion === 'UPDATE'), semaforoData);
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
                if (!semaforoData.esc.found) set('sem-esc', 'error', 'No se ha trobat JSON al servidor');
                else if (!semaforoData.esc.ready) set('sem-esc', 'pending', `JSON trobat (${semaforoData.esc.timestamp}) però BLOC NO READY`);
                else set('sem-esc', 'ready', `Escaleta OK (${semaforoData.esc.timestamp})`);

                // MP4: CleanFeed
                const mp4Title = semaforoData.mp4 === 'pending' ? 'El stream no ha arribat al final del bloc' : (semaforoData.mp4 === 'error' ? 'Pista V1 buida' : 'CleanFeed OK');
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
                    btn.innerText = "NOU PROJECTE";
                    btn.className = "square-large btn-new"; // Asegúrate que btn-new existe o usa estilos inline
                    btn.onclick = function() { 
                        FASTPASS_UI.Workflows.MainButton.runMainAction('NEW', data); 
                    };
                    break;
                case 'UPDATE':
                    btn.innerText = "ACTUALITZAR";
                    btn.onclick = function() { 
                        FASTPASS_UI.Workflows.MainButton.runMainAction('UPDATE', data); 
                    };
                    break;
                case 'GO':
                    btn.innerText = "ANAR AL PROJECTE";
                    btn.onclick = function() { 
                        FASTPASS_UI.Workflows.MainButton.runMainAction('GO', data); 
                    };
                    break;
                case 'LOAD':
                    btn.innerText = "OBRIR";
                    btn.onclick = () => FASTPASS_UI.Workflows.MainButton.runMainAction('LOAD', data);
                    break;
                case 'WAITING':
                    btn.innerText = data.msg || "ESPERANT...";
                    break;
                case 'LOCKED':
                    btn.innerText = "BLOQUEJAT: " + (data.lockOwner || data.user || "ALTRE");
                    btn.disabled = false;
                    btn.style.border = "1px solid #dc3545";
                    btn.style.color = "#dc3545";
                    btn.onclick = function() {
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
