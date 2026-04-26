/**
 * ============================================================================
 * CORE: NNEWS PARSER - v1.0.0
 * Lògica de baix nivell per extreure dades de fitxers .nnp (binari natiu)
 * ============================================================================
 */

(function() {
    const FASTPASS_UI = window.FASTPASS_UI || {};
    
    const utils = {
        log: (m) => window.FASTPASS_UI.Utils.log(m, "NNEWS"),
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        escape: (s) => window.FASTPASS_UI.Utils.escape(s)
    };

    FASTPASS_UI.NNewsParser = {
        
        /**
         * Analitza un fitxer .nnp nativament.
         * @param {string} path - Ruta UNC al fitxer .nnp
         * @returns {Object|null} Estructura del projecte o null
         */
        parse: async function(path) {
            utils.log(`🔍 Analitzant projecte nativament: ${path}`);
            
            // 1. Llegir cabecera (primers 4KB solen tenir el config)
            const hexHeader = await utils.callJSX(`IO.readHex('${utils.escape(path)}', 4096)`);
            if (!hexHeader || hexHeader.startsWith('ERR')) return null;

            const metadata = this._extractMetadata(hexHeader);
            utils.log(`🎯 Projecte identificat: ${metadata.projectName || 'Desconegut'}`);

            // 2. Cercar rutes de media (UNC)
            const paths = this._extractPaths(hexHeader);
            
            // 3. (WORK IN PROGRESS) Extreure Timeline i Clips
            // Nota: requereix llegir tot el fitxer o buscar offsets específics
            const clips = await this._extractClips(path, hexHeader);

            return {
                id: metadata.folderId,
                name: metadata.projectName,
                sourcePaths: paths,
                clips: clips
            };
        },

        /**
         * Extrau metadades de text de la cabecera hexadecimal.
         */
        _extractMetadata: function(hex) {
            const str = this._hexToString(hex);
            return {
                projectName: str.match(/PROJECTNAME=([^ \r\n]+)/)?.[1] || "",
                folderId: str.match(/SAVEFOLDERID=([0-9]+)/)?.[1] || "",
                groupId: str.match(/GROUPID=([0-9]+)/)?.[1] || ""
            };
        },

        /**
         * Extrau totes les rutes UNC (\\server\share) trobades al fitxer.
         */
        _extractPaths: function(hex) {
            const str = this._hexToString(hex);
            const matches = str.match(/\\\\(?:[a-zA-Z0-9_-]+\\)+[a-zA-Z0-9_-]+/g) || [];
            return [...new Set(matches)]; // Unique paths
        },

        /**
         * (Placeholder) Lògica per extreure clips basat en la Rosetta Stone.
         */
        _extractClips: async function(path, headerHex) {
            // Aquí anirà la lògica de cerca de blocks 'edtf' i 'lpth'
            // que hem identificat en l'anàlisi de hexdump.
            return [];
        },

        /**
         * Helper: Converteix HEX a String ASCII.
         */
        _hexToString: function(hex) {
            let str = '';
            for (let i = 0; i < hex.length; i += 2) {
                const charCode = parseInt(hex.substr(i, 2), 16);
                if (charCode >= 32 && charCode <= 126) {
                    str += String.fromCharCode(charCode);
                } else if (charCode === 10 || charCode === 13) {
                    str += ' ';
                }
            }
            return str;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
