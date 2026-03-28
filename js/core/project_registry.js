/**
 * ============================================================================
 * PROJECTE REGISTRY (js/core/project_registry.js)
 * Detecta canvis de projecte actiu a Premiere i adapta l'UI del panell.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    const POLL_KEY = "fp_last_project";

    FASTPASS_UI.Registry = {

        // Taula de projectes compatibles detectats: { projectName: true }
        table: {},

        // Nom del projecte ancorat actualment
        activeProjectName: null,

        /**
         * Comprova si un nom de projecte de Premiere és compatible.
         * "Compatible" = el nom conté el keyword de algun programa definit a config.
         */
        _isCompatible: function (projectName) {
            const cfg = FASTPASS_UI.Config.get();
            if (!cfg || !cfg.mapeoProgramas) return false;
            for (var key in cfg.mapeoProgramas) {
                var token = cfg.mapeoProgramas[key].archivo;
                if (projectName && projectName.indexOf(token) !== -1) return true;
            }
            return false;
        },

        /**
         * Cicle de poll principal: cridat cada 500ms des del setInterval de main.js.
         */
        poll: async function () {
            try {
                const raw = await FASTPASS_UI.Utils.callJSX("Context.list()");
                if (!raw || raw === "[]") return;

                const projects = JSON.parse(raw);

                // 1. Actualitzar la taula de projectes compatibles
                this.table = {};
                for (const p of projects) {
                    if (this._isCompatible(p.name)) {
                        this.table[p.name] = p;
                    }
                }

                // 2. Detectar quin és l'actiu de Premiere (el primer de la llista des de l'API)
                // Premiere retorna els projectes en l'ordre en que l'usuari hi ha fet focus
                const currentPremiereFocusName = projects[0] ? projects[0].name : null;

                // 3. Si el projecte en focus no ha canviat, no fem res
                if (currentPremiereFocusName === this.activeProjectName) return;

                this.activeProjectName = currentPremiereFocusName;
                this._onProjectChange(currentPremiereFocusName);

            } catch (e) {
                // Silent fail: el polling no ha d'interrompre l'usuari
            }
        },

        /**
         * Reacció al canvi de projecte actiu.
         */
        _onProjectChange: async function (projectName) {
            const utils = FASTPASS_UI.Utils;
            const isCompat = this._isCompatible(projectName);

            if (isCompat) {
                // Ancorar el projecte al motor JSX
                await utils.callJSX(`Context.set('${utils.escape(projectName)}')`);

                // Actualitzar la barra d'estat
                utils.status(`🟢 Actiu: ${projectName.substring(0, 25)}`, "exito");
                utils.log(`🔄 [Registry] Canvi de projecte -> ${projectName} (COMPATIBLE)`, "INFO");

                // Habilitar tots els botons de workflow
                this._setWorkflowEnabled(true);

                // 📍 REACTIVITAT: Forçar el recalculo del botó principal
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    FASTPASS_UI.Core.Context.checkContext();
                }

            } else {
                // Desancorar: en qualsevol operació el guard del JSX protegirà
                utils.status("⚫ Projecte no compatible", "debug");
                utils.log(`⚫ [Registry] Canvi de projecte -> ${projectName} (INACTIU)`, "INFO");

                // Inhabilitaem els botons de workflow
                this._setWorkflowEnabled(false);
            }
        },

        /**
         * Habilita o inhabilita els botons de workflow (tot excepte selectors i btnMain).
         */
        _setWorkflowEnabled: function (enabled) {
            const workflowButtonIds = [
                'btnIn', 'btnOut', 'btnScene',
                'btnPrevClip', 'btnNextClip', 'btnCenter', 'btnKey',
                'btnPlaceChyrons', 'btnPlaceGraph169', 'btnBg', 'btnDiag',
                'btnSrtWork', 'btnSrtIn', 'btnSrtOut', 'btnTimeAdjust',
                'btnRenderVideo', 'btnRenderPortada',
                'slider-move'
            ];
            for (const id of workflowButtonIds) {
                const el = document.getElementById(id);
                if (el) el.disabled = !enabled;
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
