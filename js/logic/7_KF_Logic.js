/**
 * ============================================================================
 * LOGIC: ANIM (Orquestació d'animacions i Keyframes) - v2.5.3 literal
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Anim = {
        
        /**
         * extreme: Crea una corba Bezier extrema (Usada en rètols).
         */
        extreme: async function(ti, ci, t) {
            const comp = "AE.ADBE Motion";
            const prop = "ADBE Video Position";
            
            // 1. Add Key principal al temps T
            await utils.callJSX(`Anim.add(${ti}, ${ci}, '${comp}', '${prop}', ${t})`);
            
            // 2. Auxiliar per forçar corba (0.04s després)
            const auxT = t + 0.04;
            await utils.callJSX(`Anim.add(${ti}, ${ci}, '${comp}', '${prop}', ${auxT})`);
            
            // 3. Interpolació Bezier (5)
            await utils.callJSX(`Anim.interp(${ti}, ${ci}, '${comp}', '${prop}', ${t}, 5)`);
            
            // 4. Neteja auxiliar
            await utils.callJSX(`Anim.remove(${ti}, ${ci}, '${comp}', '${prop}', ${auxT})`);

            return "OK_EXTREME";
        },

        /**
         * slider: Gestiona el moviment del slider de la UI cap al clip.
         */
        slider: async function(valPx, isFinal) {
            // Conversió literal del canvas (608px) a Normalitzat (0-1)
            const valNorm = parseFloat(valPx) / 608.0;
            return await utils.callJSX(`Anim.x(${valNorm}, ${isFinal})`);
        },

        /**
         * reframe: Aplica Auto Reframe.
         */
        reframe: async function(ti, ci) {
            return await utils.callJSX(`Anim.reframe(${ti}, ${ci})`);
        }
    };

    // Alias global literal window.Anim
    window.Anim = FASTPASS_UI.Logic.Anim;

    window.FASTPASS_UI = FASTPASS_UI;
})();
