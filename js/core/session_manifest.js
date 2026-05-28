/**
 * ============================================================================
 * FASTPASS_UI.SessionManifest - v1.0.0
 * Mòdul de persistència de sessió (.fastpass.json)
 * Font de veritat per a tots els processos del timeline
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    FASTPASS_UI.SessionManifest = {

        /**
         * Retorna la ruta del fitxer manifest per al context actual.
         * Ubicació: mateixa carpeta que el .prproj
         */
        getPath: function(ctx) {
            // El ctx conté config.rutas.destinoBase, progData.directorio i dateDir
            // ctx.progData.wott sol ser el progId (TNV, TNC...)
            const folder = ctx.config.rutas.destinoBase + ctx.progData.directorio + '\\' + ctx.dateDir;
            const filename = (ctx.progData.wott || 'PROG') + '_' + ctx.bloque + '.fastpass.json';
            return folder + '\\' + filename;
        },

        /**
         * Llegeix el manifest existent o retorna un objecte buit inicial si no existeix.
         */
        load: async function(ctx) {
            const path = this.getPath(ctx);
            const utils = window.FASTPASS_UI.Utils;
            try {
                const raw = await utils.callJSX(`IO.readTxt('${utils.escape(path)}')`);
                if (raw && !raw.startsWith('ERR') && raw !== '') {
                    const parsed = JSON.parse(raw);
                    const items = parsed.escaletaItems ? parsed.escaletaItems.length : 0;
                    utils.log(`📂 [SessionManifest] Manifest carregat: ${items} items d'escaleta (${path.substring(Math.max(0, path.length - 60))})`, 'DEBUG');
                    return parsed;
                }
                utils.log(`⚠️ [SessionManifest] Manifest buit o no trobat: ${path}`, 'DEBUG');
            } catch (e) {
                utils.log(`⚠️ [SessionManifest] Error parsejant manifest: ${e.message} (${path})`, 'WARN');
            }
            return this._empty(ctx);
        },

        /**
         * Desa el manifest fusionant les dades noves amb les existents (deep merge).
         */
        save: async function(ctx, patch) {
            const existing = await this.load(ctx);
            const updated = this._deepMerge(existing, patch);
            updated._lastUpdated = new Date().toISOString();
            
            const path = this.getPath(ctx);
            const json = JSON.stringify(updated);
            const utils = window.FASTPASS_UI.Utils;
            
            const writeResult = await utils.callJSX(`IO.writeTxt('${utils.escape(path)}', '${utils.escape(json)}')`);
            if (writeResult === '[]') {
                utils.log(`❌ [SessionManifest] Error escrivint manifest a: ${path} (writeTxt ha fallat)`, 'ERROR');
            }
            
            // Sincronització immediata amb l'estat global per a compatibilitat
            if (updated.ref) {
                window.FASTPASS_UI.State.ref = updated.ref;
            }
            if (updated.hierarchy) {
                window.FASTPASS_UI.State.hierarchy = updated.hierarchy;
            }
            
            return updated;
        },

        /** Objecte inicial buit amb l'estructura base */
        _empty: function(ctx) {
            return {
                _version:    '1.0',
                _generated:  new Date().toISOString(),
                _lastUpdated: new Date().toISOString(),
                program: {
                    progId:        ctx.progData?.wott || '',
                    blockId:       ctx.bloque || '',
                    projectFile:   '', // s'omple al crear projecte
                    projectFolder: ctx.config?.rutas?.destinoBase + (ctx.progData?.directorio || '') + '\\' + (ctx.dateDir || ''),
                    escaletaFile:  ''  // s'omple al carregar JSON
                },
                cleanFeed: {},
                blockBounds: {},
                ref: {
                    worldSecMediaStart: null,
                    mp4ExpandedInPoint: null,
                    tlBlockInPointSec:  null,
                    tlClipStartSec:     null,
                    offsetSec:          null,
                    blockInSec:         null
                },
                hierarchy: {}, // Fase 4: Mapa de lineID -> data
                clips: [],
                escaletaItems: [],
                footprintVerification: null,
                phases: {
                    boundsCalculated:   false,
                    mp4Imported:        false,
                    tcRefEstablished:   false,
                    trossejaDone:       false,
                    clipsLogged:        false,
                    footprintVerified:  false,
                    clipAnalysisDone:   false,
                    markersPlaced:      false,
                    chyronsPlaced:      false,
                    hierarchyResolved:  false
                }
            };
        },

        /** Merge profund recursiu (les llistes es substitueixen) */
        _deepMerge: function(base, patch) {
            const result = Object.assign({}, base);
            for (const key of Object.keys(patch)) {
                if (Array.isArray(patch[key])) {
                    result[key] = patch[key];
                } else if (patch[key] && typeof patch[key] === 'object') {
                    result[key] = this._deepMerge(base[key] || {}, patch[key]);
                } else {
                    result[key] = patch[key];
                }
            }
            return result;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
