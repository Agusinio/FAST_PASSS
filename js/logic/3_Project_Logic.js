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
            const utils = window.FASTPASS_UI.Utils;
            
            // 1. OBRIR PLANTILLA
            await utils.callJSX(`jsx_openProject('${utils.escape(templatePath)}')`);
            await utils.delay(1500); // Un pelín más de tiempo para que Premiere respire
        
            // 2. GUARDAR COM
            utils.log("💾 Creant fitxer al destí...");
            const saveRes = await utils.callJSX(`jsx_saveProjectAs('${utils.escape(destPath)}')`);
            if (saveRes !== "OK") return saveRes;
        
            // 📍 AJUSTE: El nombre base de la secuencia en tu plantilla
            // ¡IMPORTANTE! Asegúrate de que en la plantilla se llama EXACTAMENTE así:
            const baseName = 'OTT VERTICAL';

            // 1. CLONAR (JSX nos devuelve el nombre temporal, ej: "OTT VERTICAL Copy 01")
            const tempCloneName = await utils.callJSX(`FASTPASS.Project.cloneSequence('${baseName}')`);
            
            if (tempCloneName.indexOf("ERR") === -1) {
                utils.log(`🧬 Clon creat: [${tempCloneName}]. Procedint a moure i renombrar...`, "DEBUG");
            
                // 2. MOURE AL ROOT (Usando tu función moveItem ya existente)
                // El segundo parámetro vacío o "root" hará que vaya a la raíz
                await utils.callJSX(`FASTPASS.Project.moveItem('${tempCloneName}', 'root')`);
            
                // 3. RENOMBRAR (Usando tu función renameItem ya existente)
                await utils.callJSX(`FASTPASS.Project.renameItem('${tempCloneName}', '${sequenceName}')`);
            
                utils.log(`✅ Seqüència [${sequenceName}] llista al root.`, "INFO");
            } else {
                utils.log(`🔴 Error en clonar base: ${tempCloneName}`, "ERROR");
            }
        
            await utils.callJSX(`app.project.save()`); 
            return { success: true, path: destPath, sequence: sequenceName };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
