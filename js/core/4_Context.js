/**
 * ============================================================================
 * CORE: 4_Context (Sintetitzador de Context)
 * ============================================================================
 * Aquest mòdul analitza els informes dels Inspectors per definir l'estat global.
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Core = FASTPASS_UI.Core || {};

    const utils = window.FASTPASS_UI.Utils;
    // Referències als inspectors puros (discovery)
    const assets = () => FASTPASS_UI.Inspectors.SourceAssets;
    const appInfo = () => FASTPASS_UI.Inspectors.App;
    const session = () => FASTPASS_UI.Inspectors.Session;

    FASTPASS_UI.Core.Context = {
        
        async checkContext() {
            if (!utils.isJsxReady) return;

            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
            if (!elProg || !elBloc || !elProg.value || !elBloc.value) {
                this.updateButton('DISABLED');
                return;
            }

            try {
                const config = FASTPASS_UI.Config.get();
                const progData = config.mapeoProgramas[elProg.value];
                const dateDir = utils.getFormattedDate().replace(/"/g, "").trim();
                
                // --- 1. INSPECCIÓ EXTERNA ---
                const mediaSource = config.rutas.destinoBase + progData.directorio + "\\" + dateDir;
                const wottsRaw = await assets().scan(mediaSource, "*.wott");
                const map = assets().getLatestDayMap(wottsRaw);
                const theme = this._extractThemeFromFiles(map);
                
                if (!theme) {
                    this.updateButton('WAITING', { msg: "Esperant Wotts..." });
                    return;
                }

                // --- 2. INSPECCIÓ INTERNA ---
                const openProjs = await appInfo().getOpenProjects();
                const activeProj = await appInfo().getActiveProjectName();

                // --- 3. SÍNTESI I CONCLUSIÓ ---
                const expectedProjName = `Pruebas_${progData.archivo}_${dateDir}_${elBloc.value}_${utils.sanitizeName(theme)}.prproj`;
                const isProjectAlreadyOpen = openProjs.includes(expectedProjName);
                const isCurrentlyActive = (activeProj === expectedProjName);
                
                let conclusion = 'NEW';
                if (isCurrentlyActive) {
                    conclusion = 'UPDATE'; 
                } else if (isProjectAlreadyOpen) {
                    conclusion = 'GO';
                } else {
                    const destPath = config.rutas.destinoBase + progData.directorio + "\\" + expectedProjName;
                    const fileExists = await utils.callJSX(`jsx_fileExists('${destPath.replace(/\\/g, "\\\\")}')`);
                    conclusion = (fileExists === "true") ? 'LOAD' : 'NEW';
                }

                this.updateButton(conclusion, { theme, expectedProjName, path: mediaSource });

            } catch(e) {
                console.error("💥 Error en el Core de Context:", e);
                this.updateButton('DISABLED');
            }
        },

        updateButton(state, data) {
            const btn = document.getElementById('btnMainAction');
            if (!btn) return;
            btn.disabled = (state === 'DISABLED' || state === 'WAITING');
            btn.classList.remove('btn-update', 'btn-go', 'btn-load', 'btn-new');

            switch(state) {
                case 'UPDATE':
                    btn.innerText = "ACTUALITZAR";
                    btn.className = "square-large btn-update";
                    btn.onclick = () => FASTPASS_UI.Workflows.Nou.runMainAction('UPDATE', data);
                    break;
                case 'GO':
                    btn.innerText = "ANAR-HI";
                    btn.className = "square-large btn-go";
                    btn.onclick = () => FASTPASS_UI.Workflows.Nou.runMainAction('GO', data);
                    break;
                case 'LOAD':
                    btn.innerText = "OBRIR";
                    btn.className = "square-large btn-load";
                    btn.onclick = () => FASTPASS_UI.Workflows.Nou.runMainAction('LOAD', data);
                    break;
                case 'NEW':
                    btn.innerText = "NOU";
                    btn.className = "square-large btn-new";
                    btn.onclick = () => FASTPASS_UI.Workflows.Nou.runMainAction('NEW', data);
                    break;
                case 'WAITING':
                    btn.innerText = data.msg || "ESPERANT...";
                    break;
                default:
                    btn.innerText = "---";
            }
        },

        init() {
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
                setInterval(() => this.checkContext(), 5000);
                setTimeout(() => this.checkContext(), 800);
            }
        },

        updateConductorSelector(programKey) {
            const selectCond = document.getElementById('conductor');
            if (!selectCond) return;
            selectCond.innerHTML = '<option value="">Tria conductor</option>';
            const config = FASTPASS_UI.Config.get();
            const progData = config.mapeoProgramas[programKey];
            if (!progData || !progData.conductors) return;
            const cond = progData.conductors;
            const titulares = Array.isArray(cond.titular) ? cond.titular : [cond.titular];
            const lista = titulares.concat(cond.substituts || []).concat(cond.capsDesetmana || []);
            for (let file of lista) {
                if (!file) continue;
                const opt = document.createElement('option');
                opt.value = file;
                opt.textContent = file.replace('Conduct_', '').replace('.mov', '');
                selectCond.appendChild(opt);
            }
            if (selectCond.options.length > 1) selectCond.selectedIndex = 1;
        },

        _extractThemeFromFiles(fileList) {
            if (!fileList || fileList.length === 0) return null;
            const f = fileList[0];
            const match = f.name.match(/Tema-Titol_(.*?)\.\d+\.wott$/i);
            return match ? match[1] : null;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
