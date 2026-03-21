/**
 * ============================================================================
 * LOGIC: PROJECT (Orquestración de Sesión)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        delay: (ms) => new Promise(r => setTimeout(r, ms))
    };

    FASTPASS_UI.Logic.Project = {
        
        /**
         * Orquestra l'activació d'un tema (Projecte + Seqüència).
         */
        activateProject: async function(projectPath, sequenceWildcard) {
            const log = (msg) => window.FASTPASS_UI.Utils.log(msg, "DEBUG");
            
            log(`📁 Activant tema: ${projectPath}`);
            
            // 1. Obertura física
            const safePath = projectPath.replace(/\\/g, '\\\\');
            await utils.callJSX(`jsx_openProject('${safePath}')`);
            
            // Pausa vital per a Premiere
            await utils.delay(1200);

            // 2. Cerca de la seqüència orquestrada des de JS
            const seqListRaw = await utils.callJSX(`jsx_listItems('', '${safePath}')`);
            const items = JSON.parse(seqListRaw);
            
            const targetSeq = items.find(i => i.type === 3 && i.name.indexOf(sequenceWildcard) !== -1);
            
            if (targetSeq) {
                log(`🎯 Seqüència trobada: ${targetSeq.name}. Obrint...`);
                await utils.callJSX(`jsx_openSequence('${targetSeq.name}', '${safePath}')`);
                return { success: true, sequence: targetSeq.name };
            } else {
                log(`⚠️ No s'ha trobat cap seqüència amb el prefix: ${sequenceWildcard}`);
                return { success: false, error: "SEQUENCE_NOT_FOUND" };
            }
        },

        /**
         * Crea un nou tema a partir d'una plantilla.
         */
        createFromTemplate: async function(templatePath, destPath, sequenceName) {
            const log = (msg) => window.FASTPASS_UI.Utils.log(msg, "INFO");
            const safeTpl = templatePath.replace(/\\/g, '\\\\');
            const safeDest = destPath.replace(/\\/g, '\\\\');

            log("📂 Generant a partir de plantilla...");
            await utils.callJSX(`jsx_openProject('${safeTpl}')`);
            await utils.delay(1000);

            // Clonar seqüència base (suposem 'OTT VERTICAL' com a estàndard)
            const clonePattern = await utils.callJSX(`jsx_cloneSequence('OTT VERTICAL', '${sequenceName}', '${safeTpl}')`);
            await utils.callJSX(`jsx_renameItem('${clonePattern}', '${sequenceName}', '${safeTpl}')`);

            // Guardar com a nou projecte
            await utils.callJSX(`jsx_saveProjectAs('${safeDest}', '${safeTpl}')`);
            
            return { success: true, path: destPath, sequence: sequenceName };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
