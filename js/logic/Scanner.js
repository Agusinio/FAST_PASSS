/**
 * ============================================================================
 * LOGIC: Scanner (Motor de cerca de materials) - v2.4.2
 * ============================================================================
 */
(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const log = (...args) => FASTPASS_UI.Utils.log(...args);

    FASTPASS_UI.Logic.Scanner = {
        
        /**
         * Busca els .wott al servidor i determina el títol del tema.
         */
        async findTemaData(ctx) {
            const utils = FASTPASS_UI.Utils;
            const mediaSource = ctx.config.rutas.chyrons;
            const limite48h = Date.now() - (48 * 60 * 60 * 1000); 
    
            // 📍 IMPORTANTE: Usamos el archivo_wott del contexto ACTUAL (ctx)
            const filtroPrograma = ctx.progData.archivo_wott;
            log(`🔍 [SCANNER] Buscant rètols de ${ctx.programa} (Filtre: ${filtroPrograma})`);
    
            const allNames = utils.readFolder(mediaSource);
            const candidates = allNames.filter(name => name.includes(filtroPrograma));
    
            const filtered = candidates.filter(name => {
                const info = window.cep.fs.stat(mediaSource + name);
                return info.err === 0 && info.data.mtime.getTime() > limite48h;
            }).map(name => ({ name: name, path: mediaSource + name })); // Estructura plana
    
            log(`📂 [SCANNER] Wotts trobats: ${filtered.length}`);
            
            // Retornem la llista directament
            return { tema: "TEMA_PENDENT", list: filtered };
        },

        /**
         * Busca el vídeo (.mp4) i els subtítols (.srt)
         */
        async findMediaAssets(ctx) {
            const utils = FASTPASS_UI.Utils;
            const mediaSource = ctx.config.rutas.verticalitzacio;
            const limite48h = Date.now() - (48 * 60 * 60 * 1000);
    
            const allNames = utils.readFolder(mediaSource);
            const filtered = allNames.filter(name => {
                if (!name.endsWith(".mp4") && !name.endsWith(".srt")) return false;
                // 📍 FILTRE: Només els que coincideixin amb el programa actual
                if (!name.includes(ctx.progData.archivo)) return false; 
                
                const info = window.cep.fs.stat(mediaSource + name);
                return info.err === 0 && info.data.mtime.getTime() > limite48h;
            }).map(name => ({ name: name, path: mediaSource + name }));
    
            return {
                mp4: filtered.find(f => f.name.endsWith(".mp4")),
                srt: filtered.find(f => f.name.endsWith(".srt"))
            };
        }
    };
})();