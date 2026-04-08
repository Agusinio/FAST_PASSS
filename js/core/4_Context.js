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
            const elProg = document.getElementById('programa'); // <--- Faltaba esto
            const elBloc = document.getElementById('bloc');     // <--- Faltaba esto
        
            // 📍 DEBOUNCE
            const now = Date.now();
            if (now - _lastCheckAt < 1000) return;
            _lastCheckAt = now;
        
            console.group("🔍 [DEBUG CONTEXT]"); 
        
            try {
                // Ahora ya puedes validar si existen
                if (!elProg || !elBloc || !elProg.value || elBloc.value === "---") {
                    console.log("⚠️ Selectores incompletos o no encontrados.");
                    this.updateButton('DISABLED');
                    console.groupEnd();
                    return;
                }
        
                const config = FASTPASS_UI.Config.get();
                const ctx = {
                    config: config,
                    progData: config.mapeoProgramas[elProg.value],
                    bloque: elBloc.value,
                    // Usamos la fecha de la utilidad
                    dateDir: getUtils().getFormattedDate().replace(/"/g, "").trim()
                };
                getUtils().log("🔍 [CONTEXT DEBUG] progData: " + JSON.stringify(ctx.progData), "DEBUG");
            
                // 1. RUTA DE RECERCA
                const folderPath = config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir + "/";
                
                // 2. ESCANEIG GENÈRIC (Usant Utils.readFolder a través de Scanner)
                const projectFiles = await getUtils().readFolder(folderPath); // Atòmic

                if (!projectFiles || projectFiles.length === 0) {
                    getUtils().log("ℹ️ Carpeta buida o inexistent. Conclusió: NEW", "DEBUG");
                }
            
                // 3. LÒGICA DE NEGOCI (Usant el teu Scanner.js)
                const existingProjectName = FASTPASS_UI.Logic.Scan.selectedProject(
                    projectFiles,
                    ctx.progData.archivo_wott || ctx.progData.archivo,
                    ctx.bloque
                );
                getUtils().log("🔍 [CONTEXT DEBUG] projectFiles: " + projectFiles.length + " items", "DEBUG");
                getUtils().log("🔍 [CONTEXT DEBUG] existingProjectName: " + (existingProjectName || "null"), "DEBUG");
            
                let conclusion = 'NEW';
                let lockOwner = null;
            
                if (existingProjectName) {
                    // Mirem si hi ha lock (Lògica JS pura sobre la llista ja descarregada)
                    const lockFile = projectFiles.find(f => f.name === existingProjectName + ".lock");
                    
                    if (lockFile) {
                        // Hi ha bloqueig: llegim el contingut (qui és l'amo)
                        // Escapar la ruta para JSX
                        const lockPath = folderPath + lockFile.name;
                        const safeLockPath = lockPath.replace(/\\/g, '/').replace(/'/g, "\\'");
                        getUtils().log("🔍 [LOCK DEBUG] Leyendo lock: " + safeLockPath, "DEBUG");
                        lockOwner = await getUtils().callJSX(`IO.readTxt('${safeLockPath}')`);
                        // Verificar si el lock es del usuario actual
                        const currentUser = await getUtils().callJSX("IO.getUser()");
                        // Si el lock está vacío, asumir que es nuestro (puede ser un lock recién creado)
                        if (lockOwner.trim() === "") {
                            getUtils().log("⚠️ Lock file vacío, asumiendo pertenece al usuario actual", "DEBUG");
                            lockOwner = currentUser;
                        }
                        if (lockOwner.trim() === currentUser.trim()) {
                            // El lock es nuestro, no está bloqueado
                            // Verificar si el proyecto está abierto
                            let activeProjectPath = '';
                            try {
                                activeProjectPath = await getUtils().callJSX("Project.path()");
                            } catch (e) {
                                // Ignorar error
                            }
                            const isProjectOpen = activeProjectPath && activeProjectPath.indexOf(existingProjectName) !== -1;
                            conclusion = isProjectOpen ? 'UPDATE' : 'LOAD';
                        } else {
                            conclusion = 'LOCKED';
                        }
                    } else {
                        // Verificar si el proyecto está actualmente abierto en Premiere
                        let activeProjectPath = '';
                        try {
                            activeProjectPath = await getUtils().callJSX("Project.path()");
                        } catch (e) {
                            // Ignorar error
                        }
                        const isProjectOpen = activeProjectPath && activeProjectPath.indexOf(existingProjectName) !== -1;
                        conclusion = isProjectOpen ? 'UPDATE' : 'LOAD';
                    }
                }
            
                getUtils().log("🔍 Conclusión contexto: " + conclusion + (existingProjectName ? " (projecte: " + existingProjectName + ")" : ""), "DEBUG");
                // 4. FEEDBACK UI
                if (conclusion === 'LOCKED') {
                    this.updateButton('LOCKED', { user: lockOwner });
                } else {
                    // Si és LOAD, el nom del projecte és el que hem trobat (amb el seu tema real)
                    const finalName = existingProjectName || `Pruebas_${ctx.progData.archivo}_${ctx.bloque}_PENDENT.prproj`;
                    this.updateButton(conclusion, { ...ctx, name: finalName });
                }
            
            } catch (e) {
                getUtils().log("💥 Error checkContext: " + e.message, "ERROR");
            }
        },

        updateLights(prog, bloc, theme, active) {
            const set = (id, state) => {
                const el = document.getElementById(id);
                if (el) el.className = "light " + (state ? "on" : "off");
            };
            set('light-prog', !!prog);
            set('light-bloc', !!bloc && bloc !== "---");
            set('light-tema', !!theme && theme !== "PENDENT");
            set('light-seq', !!active);
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
                    btn.innerText = "BLOQUEJAT: " + (data.user || "ALTRE");
                    btn.disabled = true;
                    btn.style.border = "1px solid #dc3545";
                    btn.style.color = "#dc3545";
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
