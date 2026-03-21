/**
 * ============================================================================
 * FASTPASS_UI.Logic.StateManager
 * Clase encargada de gestionar el estado de la interfaz y el contexto.
 * (v12 - VERSIÓN LIPO: LÓGICA DE BÚSQUEDA EN JS)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: function(script) {
            return window.FASTPASS_UI.Utils.callJSX(script);
        }
    };

    FASTPASS_UI.Logic.StateManager = {
        
        /**
         * Analiza el contexto actual.
         * Mueve toda la búsqueda de archivos y locks al JavaScript (CEP API).
         */
        checkContext: async function() {
            if (!window.FASTPASS_UI.Utils.isJsxReady) return;

            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
            if (!elProg || !elBloc || !elProg.value || !elBloc.value) {
                this.setButtonState('DISABLED');
                return;
            }

            const config = FASTPASS_UI.Config.get();
            const progData = config.mapeoProgramas[elProg.value];
            if (!progData) return this.setButtonState('DISABLED');

            try {
                // 1. OBTENCIÓN DE FECHA (JS Utils)
                const dateDir = window.FASTPASS_UI.Utils.getFormattedDate().replace(/"/g, "").trim();

                // 2. CONFIGURACIÓN DE RUTAS
                const baseFolder = config.rutas.destinoBase + progData.directorio; 
                const searchPrefix = "Pruebas_" + progData.archivo + "_" + dateDir + "_" + elBloc.value + "_";

                let status = { isActive: false, isOpen: false, existsOnDisk: false, isLocked: false, realName: "" };

                // 3. CONSULTA DE PROYECTOS EN PREMIERE (Atómico)
                const activeName = await utils.callJSX("jsx_getActiveProjectName()");
                const openNames = JSON.parse(await utils.callJSX("jsx_getOpenProjectsNames()"));

                if (activeName.indexOf(searchPrefix) === 0) {
                    status.isActive = true;
                    status.isOpen = true;
                    status.realName = activeName;
                } else {
                    const foundInOpen = openNames.find(n => n.indexOf(searchPrefix) === 0);
                    if (foundInOpen) {
                        status.isOpen = true;
                        status.realName = foundInOpen;
                    }
                }

                // 4. BÚSQUEDA EN DISCO (Nativo JS/CEP)
                if (!status.isActive) {
                    const result = window.cep.fs.readdir(baseFolder);
                    if (result.err === 0) {
                        const files = result.data || [];
                        const matched = files.find(f => f.indexOf(searchPrefix) === 0 && f.indexOf(".prproj") !== -1);
                        
                        if (matched) {
                            status.existsOnDisk = true;
                            if (!status.realName) status.realName = matched;
                            
                            // Check de lock (.prlock)
                            const lockCheck = window.cep.fs.stat(baseFolder + "/" + matched + ".prlock");
                            if (lockCheck.err === 0) {
                                status.isLocked = true;
                            }
                        }
                    }
                }

                // 5. ACTUALIZACIÓN DE INTERFAZ
                const targetName = status.realName || (searchPrefix + "PENDENT.prproj");
                const targetPath = baseFolder + "\\" + targetName;

                if (status.isActive) {
                    this.setButtonState('UPDATE');
                } else if (status.isOpen) {
                    this.setButtonState('GO', { name: targetName });
                } else if (status.existsOnDisk) {
                    this.setButtonState(status.isLocked ? 'LOCKED_LOAD' : 'LOAD', { path: targetPath });
                } else {
                    this.setButtonState('NEW');
                }

            } catch(e) {
                console.error("Crash en StateManager:", e);
                this.setButtonState('DISABLED');
            }
        },

        setButtonState: function(state, data) {
            var btn = document.getElementById('btnMainAction'); 
            if (!btn) return;
            btn.disabled = (state === 'DISABLED');
            btn.classList.remove('btn-update', 'btn-go', 'btn-load', 'btn-new');
        
            switch(state) {
                case 'UPDATE':
                    btn.innerText = "ACTUALITZAR";
                    btn.className = "square-large btn-update";
                    btn.onclick = function() { FASTPASS_UI.Workflows.Nou.runMainAction('UPDATE', data); };
                    break;
                case 'GO':
                    btn.innerText = "ANAR-HI";
                    btn.className = "square-large btn-go";
                    btn.onclick = function() { FASTPASS_UI.Workflows.Nou.runMainAction('GO', data); };
                    break;
                case 'LOAD':
                case 'LOCKED_LOAD':
                    btn.innerText = "OBRIR";
                    btn.className = "square-large btn-load";
                    btn.onclick = function() { FASTPASS_UI.Workflows.Nou.runMainAction('LOAD', data); };
                    break;
                case 'NEW':
                    btn.innerText = "NOU";
                    btn.className = "square-large btn-new";
                    btn.onclick = function() { FASTPASS_UI.Workflows.Nou.runMainAction('NEW', data); };
                    break;
                default:
                    btn.innerText = "ESPERANT...";
                    btn.disabled = true;
            }
        },

        init: function() {
            const p = document.getElementById('programa');
            const b = document.getElementById('bloc');
            if (p && b) {
                const trigger = () => {
                    FASTPASS_UI.Config.saveSelection(p);
                    FASTPASS_UI.Config.saveSelection(b);
                    this.checkContext();
                };
                p.addEventListener('change', trigger);
                b.addEventListener('change', trigger);
                setTimeout(() => this.checkContext(), 800);
            }
        },

        updateConductorSelector: function(programKey) {
            const selectCond = document.getElementById('conductor');
            if (!selectCond || !FASTPASS_UI.Config) return;
            selectCond.innerHTML = '<option value="">Tria conductor</option>';
            const config = FASTPASS_UI.Config.get();
            const progData = config.mapeoProgramas[programKey];
            if (!progData || !progData.conductors) return;
            const cond = progData.conductors;
            const titulares = Array.isArray(cond.titular) ? cond.titular : [cond.titular];
            const lista = titulares.concat(cond.substituts || []).concat(cond.capsDesetmana || []);
            for (let file of lista) {
                if (!file || typeof file !== 'string') continue;
                const opt = document.createElement('option');
                opt.value = file;
                opt.textContent = file.replace('Conduct_', '').replace('.mov', '');
                selectCond.appendChild(opt);
            }
            if (selectCond.options.length > 1) selectCond.selectedIndex = 1;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();