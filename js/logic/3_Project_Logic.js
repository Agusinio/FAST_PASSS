/**
 * ============================================================================
 * LOGIC: PROJECT (Orquestació de Sesió)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m, type) => window.FASTPASS_UI.Utils.log(m, type || "DEBUG"),
        delay: (ms) => new Promise(r => setTimeout(r, ms))
    };

    FASTPASS_UI.Logic.Project = {
        
        /**
         * activate: Orquestra l'activació d'un tema (Projecte + Seqüència).
         */
        activate: async function(projectPath, sequenceWildcard) {
            utils.log(`📁 Activant tema: ${projectPath}`);
            
            // 1. Obertura física literal
            const res = await utils.callJSX(`Project.open('${projectPath.replace(/\\/g, '\\\\')}')`);
            if (res !== "OK") return { success: false, error: res };
            
            await utils.delay(1200);

            // 2. Cerca literal d'items
            const itemsRaw = await utils.callJSX(`Project.items('')`);
            const items = JSON.parse(itemsRaw || "[]");
            
            const targetSeq = items.find(i => i.type === 3 && i.name.indexOf(sequenceWildcard) !== -1);
            
            if (targetSeq) {
                utils.log(`🎯 Seqüència trobada: ${targetSeq.name}. Obrint...`);
                await utils.callJSX(`Project.openSeq('${targetSeq.name}')`);
                return { success: true, sequence: targetSeq.name };
            } else {
                utils.log(`⚠️ Seqüència no trobada amb prefix: ${sequenceWildcard}`, "WARN");
                return { success: false, error: "SEQUENCE_NOT_FOUND" };
            }
        },

        /**
        * create: Crea un nou tema a partir d'una plantilla.
        */
        create: async function(templatePath, destPath, sequenceName) {
            // 1. OBRIR PLANTILLA
            await utils.callJSX(`Project.open('${templatePath.replace(/\\/g, '\\\\')}')`);
            await utils.delay(1500);
        
            // 2. GUARDAR COM
            utils.log("💾 Guardant projecte nou...");
            const saveRes = await utils.callJSX(`Project.saveAs('${destPath.replace(/\\/g, '\\\\')}')`);
            if (saveRes !== "OK") return { success: false, error: saveRes };
        
            // 📍 CONFIG PLANTILLA
            const baseName = 'OTT VERTICAL';

            // 3. CLONAR LITERAL
            const tempName = await utils.callJSX(`Project.clone('${baseName}')`);
            
            if (tempName && tempName.indexOf("ERR") === -1) {
                utils.log(`🧬 Clon creat: [${tempName}]. Organitzant...`);
            
                // 4. MOURE I RENOMBRAR LITERAL
                await utils.callJSX(`Project.move('${tempName}', 'root')`);
                await utils.callJSX(`Project.rename('${tempName}', '${sequenceName}')`);
            
                utils.log(`✅ Seqüència [${sequenceName}] llista.`, "INFO");
            } else {
                utils.log(`🔴 Error clones: ${tempName}`, "ERROR");
                return { success: false, error: tempName };
            }
        
            await utils.callJSX(`Project.save()`); 
            return { success: true, path: destPath, sequence: sequenceName };
        }
    };

    // Alias global literal
    window.Project = FASTPASS_UI.Logic.Project;

    window.FASTPASS_UI = FASTPASS_UI;
})();
