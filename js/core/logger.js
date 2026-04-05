/**
 * ============================================================================
 * logger.js (Sistema de Logs i Diagnosi de la UI)
 * ============================================================================
 */
(function () {
    // 1. Protección de Namespace (Igual que hicimos en Eines)
    var FASTPASS_UI = window.FASTPASS_UI || {};

    FASTPASS_UI.Logger = {

        // Función principal de LOG
        log: function (msg, level) {
            // Fix #37: Obfuscate server paths in logs
            if (typeof msg === 'string') {
                msg = msg.replace(/\\\\.*?\\[^\\]+/g, "[SERVER]");
            }

            // Niveles: 0=OFF, 1=ERROR, 2=WARN, 3=INFO (default), 4=DEBUG
            let currentLevel = 3;
            try {
                if (window.FASTPASS_UI && window.FASTPASS_UI.Config) {
                    const cfg = window.FASTPASS_UI.Config.get();
                    if (cfg && cfg.LOG_LEVEL !== undefined) currentLevel = cfg.LOG_LEVEL;
                }
            } catch (e) { }

            let reqLevel = 3;
            if (level) {
                if (typeof level === 'number') reqLevel = level;
                else if (level.toUpperCase() === 'ERROR') reqLevel = 1;
                else if (level.toUpperCase() === 'WARN') reqLevel = 2;
                else if (level.toUpperCase() === 'INFO') reqLevel = 3;
                else if (level.toUpperCase() === 'DEBUG') reqLevel = 4;
            }

            if (reqLevel > currentLevel) return;

            let prefix = "[LOG]";
            let color = "#aaa";
            if (reqLevel === 1) { prefix = "❌ [ERR]"; color = "#ff4444"; }
            if (reqLevel === 2) { prefix = "⚠️ [WARN]"; color = "#ffaa00"; }
            if (reqLevel === 4) { prefix = "🔍 [DEBUG]"; color = "#00aaff"; }

            // A) Siempre imprimir en la consola del depurador
            console.log(`%c${prefix} [${new Date().toLocaleTimeString()}] ${msg}`, `color: ${color}`);

            // B) Intentar imprimir en la ventanita negra de la extensión
            const c = document.getElementById('console');
            if (c) {
                const e = document.createElement('div');
                e.textContent = `[${new Date().toLocaleTimeString()}] ${prefix} ${msg}`;
                e.style.color = color;
                e.style.borderBottom = "1px solid #333";
                c.appendChild(e);
                c.scrollTop = c.scrollHeight;
            }
        },

        // Función de ESTADO (Barrita de colores)
        status: function (msg, type) {
            // A) Consola
            console.log(`[STATUS ${type}]: ${msg}`);

            // B) UI Visual
            const s = document.getElementById('estado');
            if (s) {
                s.textContent = msg;
                // Asignamos la clase (asegúrate de tener estilos CSS para .exito, .error, .procesando)
                s.className = type;
            }
        }
    };

    // Exportar al global
    window.FASTPASS_UI = FASTPASS_UI;
})();