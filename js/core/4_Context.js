/**
 * ============================================================================
 * CORE: 4_Context (Sintetitzador de Context) - REVISAT v2.4.2
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Core = FASTPASS_UI.Core || {};

    const log = (...args) => FASTPASS_UI.Utils.log(...args);
    const getUtils = () => window.FASTPASS_UI.Utils;

    FASTPASS_UI.Core.Context = {
        
        async checkContext() {
            if (!getUtils().isJsxReady) return;

            // 📍 DINAMISMO: Pillamos los inspectors aquí dentro, no fuera.
            // Así nos aseguramos de que ya están cargados en el window.
            const assets = FASTPASS_UI.Inspectors.SourceAssets;
            const appInfo = FASTPASS_UI.Inspectors.App;
            const session = FASTPASS_UI.Inspectors.Session;

            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
            
            if (!elProg || !elBloc || !elProg.value || elBloc.value === "---") {
                this.updateButton('DISABLED');
                return;
            }

            try {
                const config = FASTPASS_UI.Config.get();
                const progKey = elProg.value;
                const progData = config.mapeoProgramas[progKey];
                const dateDir = getUtils().getFormattedDate().replace(/"/g, "").trim();
                
                // --- 1. INSPECCIÓ EXTERNA ---
                const mediaSource = config.rutas.destinoBase + progData.directorio + "\\" + dateDir;
                // CORREGIT: Ja no fem servir assets() amb parèntesis
                const wottsRaw = await assets.scan(mediaSource, "*.wott");
                const map = assets.getLatestDayMap(wottsRaw);
                const theme = this._extractThemeFromFiles(map);
                
                // --- 2. PARSING I ESTRUCTURA ---
                const parser = new FASTPASS_UI.Logic.BlockParser();
                const pieces = parser.parseFromFiles(map, progKey, elBloc.value);
                FASTPASS_UI.State.structure = pieces;

                // --- 3. INSPECCIÓ INTERNA (ADUANA) ---
                const openProjs = await appInfo.getOpenProjects();
                const activeProj = await appInfo.getActiveProjectName();

                // 1. Definim els "Pasaports" vàlids
                const templateName = "3CatInfo_NET.prproj";
                const expectedProjName = `${progKey}_${elBloc.value}_${dateDir}_${theme || 'PENDENT'}.prproj`;
                const destPath = mediaSource + "\\" + expectedProjName;

                // 2. Comprovacions de pertinença (Punt 5 Revisat: Obertura de Filtre)
                const isTemplate = (activeProj === templateName);
                const isTarget = activeProj.indexOf(progKey) !== -1 && activeProj.indexOf(elBloc.value) !== -1;
                const isProjectAlreadyOpen = openProjs.some(p => p.indexOf(progKey) !== -1 && p.indexOf(elBloc.value) !== -1);

                // 🚨 EL FILTRE CRÍTIC: Si no és el nostre negociat, "no existeix"
                let isOurs = isTemplate || isTarget;

                if (!isOurs) {
                    // Si estem a TEST.prproj o qualsevol altre, ignorem el contingut del bin
                    FASTPASS_UI.State.structure = []; 
                    FASTPASS_UI.State.activeSequenceName = "";
                    getUtils().log("⚠️ Projecte ajè o sense guardar (" + activeProj + "). Ignorant contingut.");
                } else {
                    // NOMÉS si és un projecte oficial o la plantilla, analitzem el bin
                    const piecesLocal = parser.parseFromFiles(map, progKey, elBloc.value);
                    FASTPASS_UI.State.structure = piecesLocal;
                    FASTPASS_UI.State.activeSequenceName = await session.getActiveSequenceName();
                }

                // --- 5. CONCLUSIÓ D'ESTAT (Basada en Identitat, no en clips) ---
                const fileExists = await getUtils().callJSX(`jsx_fileExists('${destPath.replace(/\\/g, "\\\\")}')`);

                let conclusion = 'NEW';

                if (isTarget) {
                    conclusion = 'UPDATE'; // Estem dins del projecte correcte i guardat
                } else if (isProjectAlreadyOpen) {
                    conclusion = 'GO';     // El projecte correcte està obert però no és l'actiu
                } else if (isTemplate) {
                    conclusion = 'NEW';    // Estem a la plantilla, llestos per fer el "Save As"
                } else {
                    // Si estem a TEST.prproj (o qualsevol altre), mirem si el projecte real existeix a disc
                    conclusion = (fileExists === "true") ? 'LOAD' : 'NEW';
                } 
                // --- 6. APLICACIÓ A LA UI ---
                this.updateLights(progKey, elBloc.value, theme, FASTPASS_UI.State.activeSequenceName);
                this.updateButton(conclusion, { progKey, bloc: elBloc.value, theme });
                
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
                    
                    // 📍 CRÍTIC: Ara fem servir la funció unificada que mira el NAS
                    this.syncConductorUI(); 
                };
        
                p.addEventListener('change', trigger);
                b.addEventListener('change', trigger);
        
                // Arrencada inicial
                setTimeout(() => {
                    this.checkContext();
                    // Poblem el desplegable només obrir el panell
                    this.syncConductorUI();
                }, 800);
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
            const nasFiles = utils.readFolder(config.rutas.conductors);
            
            // 📍 CANVI 1: Filtrem usant f.name
            const validNasFiles = nasFiles.filter(f => {
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
            const f = fileList[0];
            const match = f.name.match(/Tema-Titol_(.*?)\.\d+\.wott$/i);
            return match ? match[1] : null;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
