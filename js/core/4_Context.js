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
                
                // --- 2. PARSING I ESTRUCTURA ---
                const parser = new FASTPASS_UI.Logic.BlockParser();
                const pieces = parser.parseFromFiles(map, elProg.value, elBloc.value);
                FASTPASS_UI.State.structure = pieces;

                // --- 3. INSPECCIÓ INTERNA ---
                const openProjs = await appInfo().getOpenProjects();
                const activeProj = await appInfo().getActiveProjectName();
                
                // 📍 DINAMISME: Guardem la seqüència activa al State per a futurs validacions
                FASTPASS_UI.State.activeSequenceName = await session().getActiveSequenceName();

                // --- 3. SÍNTESI I CONCLUSIÓ ---
                // --- 4. DETECCIÓ DE BLOQUEIG (.lock) ---
                const lockExists = await utils.callJSX(`jsx_fileExists('${lockPath.replace(/\\/g, "\\\\")}')`);
                const myUser = await utils.callJSX(`jsx_getUserName()`);

                if (lockExists === "true") {
                    const lockUser = await utils.callJSX(`jsx_readTextFile('${lockPath.replace(/\\/g, "\\\\")}')`);
                    
                    if (!isCurrentlyActive && lockUser && lockUser.trim() !== myUser.trim()) {
                        this.updateLights(progKey, elBloc.value, theme, false);
                        this.updateButton('LOCKED', { user: lockUser });
                        return;
                    }
                } else if (isCurrentlyActive) {
                    // Auto-healing: Si estem dins i no hi ha lock, el creem
                    await utils.callJSX(`jsx_writeTextFile('${lockPath.replace(/\\/g, "\\\\")}', '${myUser.trim()}')`);
                }

                // --- 5. CONCLUSIÓ D'ESTAT ---
                const fileExists = await utils.callJSX(`jsx_fileExists('${destPath.replace(/\\/g, "\\\\")}')`);
                
                let conclusion = 'NEW';
                if (isCurrentlyActive) {
                    conclusion = 'UPDATE'; 
                } else if (isProjectAlreadyOpen) {
                    conclusion = 'GO';
                } else {
                    conclusion = (fileExists === "true") ? 'LOAD' : 'NEW';
                }

                this.updateLights(progKey, elBloc.value, theme, isCurrentlyActive);
                this.updateButton(conclusion, { theme, expectedProjName, path: mediaSource });

            } catch(e) {
                console.error("💥 Error en el Core de Context:", e);
                this.updateLights(false, false, false, false);
                this.updateButton('DISABLED');
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
            btn.disabled = (state === 'DISABLED' || state === 'WAITING');
            btn.className = "square-large"; // Classe neutre única

            switch(state) {
                case 'UPDATE':
                    btn.innerText = "ACTUALITZAR";
                    btn.onclick = () => FASTPASS_UI.Workflows.MainButton.runMainAction('UPDATE', data);
                    break;
                case 'GO':
                    btn.innerText = "ANAR-HI";
                    btn.onclick = () => FASTPASS_UI.Workflows.MainButton.runMainAction('GO', data);
                    break;
                case 'LOAD':
                    btn.innerText = "OBRIR";
                    btn.onclick = () => FASTPASS_UI.Workflows.MainButton.runMainAction('LOAD', data);
                    break;
                case 'NEW':
                    btn.innerText = "NOU";
                    btn.onclick = () => FASTPASS_UI.Workflows.MainButton.runMainAction('NEW', data);
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
                    btn.innerText = "---";
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
