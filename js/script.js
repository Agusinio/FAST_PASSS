// ★★★ script.js (VERSIÓN LIMPIA) ★★★

document.addEventListener('DOMContentLoaded', function() {
    const programaSelect = document.getElementById('programa');
    const nombreTemaInput = document.getElementById('nombreTema');
    const btnEjecutar = document.getElementById('btnEjecutar');
    const estadoDiv = document.getElementById('estado');
    
    // ★★★ SOSPECHOSO #2 ★★★
    // Asegúrate de que tu <select> en index.html tenga id="conductor"
    const conductorSelect = document.getElementById('conductor'); 

    // Validar campos en tiempo real
    function validarCampos() {
        const programaValido = programaSelect.value !== '';
        // Asumimos que "nombreTemaInput" es el "bloc"
        const temaValido = nombreTemaInput.value.trim() !== ''; 
        // (Opcional) Añadir validación del conductor
        // const conductorValido = conductorSelect.value !== '';
        
        // btnEjecutar.disabled = !(programaValido && temaValido && conductorValido);
        btnEjecutar.disabled = !(programaValido && temaValido); // Dejado como estaba
    }

    programaSelect.addEventListener('change', validarCampos);
    nombreTemaInput.addEventListener('input', validarCampos);

    // Ejecutar proceso
    btnEjecutar.addEventListener('click', function() {
        const programa = programaSelect.value;
        const conductor = conductorSelect.value; // Usamos la variable ya definida
        const bloc = nombreTemaInput.value.trim(); 

        mostrarEstado('Procesando...', 'procesando');
        ejecutarEnPremiere(programa, conductor, bloc);
    });

    function ejecutarEnPremiere(programa, conductor, bloc) {
        if (typeof csInterface !== 'undefined') {
            
            var script = 'executeAutomation("' 
                         + encodeURIComponent(programa) + '", "' 
                         + encodeURIComponent(conductor) + '", "' 
                         + encodeURIComponent(bloc) + '")';

            console.log('Llamando a executeAutomation...');
            
            csInterface.evalScript(script, function(result) {
                console.log('Respuesta de executeAutomation: ' + result);
                
                if (result.indexOf('¡ÉXITO!') === 0) {
                    mostrarEstado('Proceso completado exitosamente', 'exito');
                } else {
                    mostrarEstado('Error: ' + result, 'error');
                }
            });
        } else {
            // Modo desarrollo/demo
            setTimeout(() => {
                mostrarEstado(`Simulación: Proyecto ${programa}_${bloc} creado`, 'exito');
            }, 1000);
        }
    }

    function mostrarEstado(mensaje, tipo) {
        estadoDiv.textContent = mensaje;
        estadoDiv.className = tipo;
    }

    // VALIDACIÓN INICIAL
    validarCampos();

    // ★★★ CÓDIGO PARA RELLENAR EL DESPLEGABLE ★★★
    
    if (typeof csInterface !== 'undefined') {
        console.log('Solicitando lista de conductores a Premiere...');
        csInterface.evalScript('getConductorsList()', function(jsonResult) {
            console.log('Respuesta de getConductorsList: ' + jsonResult);
            
            if (!conductorSelect) {
                console.error('Error: No se encontró el <select> con id="conductor". Verifica tu index.html');
                mostrarEstado('Error: No se encontró el desplegable.', 'error');
                return;
            }

            try {
                // Limpiar el desplegable
                conductorSelect.innerHTML = '<option value="">Selecciona un conductor...</option>'; 
                
                const conductores = JSON.parse(jsonResult);
                
                conductores.forEach(function(nombre) {
                    const option = document.createElement('option');
                    option.value = nombre;
                    option.textContent = nombre;
                    conductorSelect.appendChild(option);
                });
                
                // Re-validar campos
                validarCampos(); 

            } catch (e) {
                console.error('Error al procesar JSON de conductores: ' + e);
                console.error('JSON Recibido: ' + jsonResult); // Log extra
                mostrarEstado('Error al cargar conductores. Revisa el log de Premiere.', 'error');
            }
        });
    } else {
        console.warn('csInterface no definido. Saltando carga de conductores.');
    }
    // ★★★ FIN DEL CÓDIGO ★★★
});