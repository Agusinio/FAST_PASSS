/**
 * ============================================================================
 * LOGIC: KEYFRAMES (Orquestación de animaciones)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    FASTPASS_UI.Logic.KF = {
        
        /**
         * Orquesta la creación de una curva Bezier "Extrema".
         * (Antiguamente una función compleja en el JSX).
         */
        applyExtremeCurves: async function(ti, ci, t) {
            const utils = window.FASTPASS_UI.Utils;
            const comp = "AE.ADBE Motion";
            const prop = "ADBE Video Position";
            
            // 1. Aseguramos el punto en el tiempo T
            await utils.callJSX(`jsx_addKey(${ti}, ${ci}, '${comp}', '${prop}', ${t})`);
            
            // 2. Truco de Premiere para crear una curva (usamos un punto auxiliar)
            const auxT = t + 0.04;
            await utils.callJSX(`jsx_addKey(${ti}, ${ci}, '${comp}', '${prop}', ${auxT})`);
            
            // 3. Establecemos interpolación Bezier (5 = Bezier en Premiere)
            await utils.callJSX(`jsx_setInterpolation(${ti}, ${ci}, '${comp}', '${prop}', ${t}, 5)`);
            
            // 4. Limpiamos el punto auxiliar
            await utils.callJSX(`jsx_removeKey(${ti}, ${ci}, '${comp}', '${prop}', ${auxT})`);

            return "OK_EXTREME_CURVE";
        },

        /**
         * Gestiona el movimiento del slider del panel.
         */
        handleSliderEvent: async function(sliderVal, isFinal, ti, ci, t) {
            const utils = window.FASTPASS_UI.Utils;
            const valX = parseFloat(sliderVal) / 608.0; // Normalización a 0.0-1.0
            
            if (isFinal) {
                // Al soltar el ratón: creamos el Keyframe físico
                await utils.callJSX(`jsx_addKey(${ti}, ${ci}, 'AE.ADBE Motion', 'ADBE Video Position', ${t})`);
                await utils.callJSX(`jsx_setKeyValue(${ti}, ${ci}, 'AE.ADBE Motion', 'ADBE Video Position', ${t}, [${valX}, 0.5])`);
            } else {
                // Durante el arrastre: solo actualizamos el valor visual (sin crear KF)
                await utils.callJSX(`jsx_setClipProperty(${ti}, ${ci}, 'AE.ADBE Motion', 'ADBE Video Position', [${valX}, 0.5])`);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
