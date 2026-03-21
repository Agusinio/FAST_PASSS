# 🗄️ ARCHIU DE CODI OBSOLET (FAST >>> PASS)

En este document es guarden els blocs de codi logicament vàlids però funcionalment reemplaçats que han estat eliminats dels fitxers font per millorar la netedat (Fix #6).

---

## 📄 js/core/utils.js

### Antiga Implementació de `callJSX`
*Data d'eliminació: 26 de Gener de 2026*
```javascript
/*callJSX: function(script) {
    return new Promise((resolve, reject) => {
        const full = `try{${script}}catch(e){"ERROR:"+e.message}`;
        csInterface.evalScript(full, (res) => {
            if (res && res.indexOf("ERROR:") === 0) reject(new Error(res.substring(6)));
            else resolve(res);
        });
    });
},*/
```
*Motiu: Reemplaçada per una versió amb millor maneig de logs i error trapping.*

---

## 📄 modules/3_Project.jsx

### Antiga Implementació de `findRootBin`
```javascript
/*function findRootBin(binName) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        // Comparamos convirtiendo ambos a Mayúsculas
        if (root.children[i].name.toUpperCase() === binName.toUpperCase() && root.children[i].type === 2) {
            return root.children[i];
        }
    }
    return null;
}*/
```
*Motiu: Reemplaçada per una funció més sensible a majúscules/minúscules segons el nou estàndard.*

---

## 📄 modules/4_Timeline.jsx

### Versió Prèvia de `setCTI_Safe`
```javascript
/*setCTI_Safe: function(seconds) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR: No Seq";
        
        // Usamos Ticks (0 ticks = 0 segundos) para el reset a 0
        // Es el método más estable para que la UI se mueva de verdad
        if (parseFloat(seconds) === 0) {
            seq.setPlayerPosition("0");
        } else {
            // Para otros tiempos usamos QE que es más rápido en snapshots
            if (typeof app.enableQE === "function") app.enableQE();
            qe.project.getActiveSequence().CTI.setSeconds(parseFloat(seconds));
        }
        
        // Forzamos el redibujado que ya tienes en tus otros módulos
        if (typeof jsx_nuclearRefresh === "function") jsx_nuclearRefresh();
        
        return "OK";
    } catch(e) { return "ERR_CTI: " + e.message; }
},*/
```
*Motiu: Versió inestable amb QE vs Ticks. La nova versió utilitza Ticks de forma nativa per a qualsevol temps.*

### Versió Prèvia de `isolateTrack`
```javascript
/*isolateTrack: function(trackIndex) {
    var seq = app.project.activeSequence;
    if (!seq) return false;
    
    // Mutear todos
    for (var i = 0; i < seq.videoTracks.numTracks; i++) {
        seq.videoTracks[i].setMute(true);
    }
    
    // Desmutear el elegido
    if (trackIndex < seq.videoTracks.numTracks) {
        seq.videoTracks[trackIndex].setMute(false);
        return true;
    }
    return false;
},*/
```

---

## 📄 jsx/main.jsx

### Funcions de Pont Duplicate/Obsoletes
```javascript
/*function jsx_setTargetedTrack(videoIdx) {
    // Restamos 1 para que al enviar 1 desde el panel se seleccione V1 (índice 0)
    return FASTPASS.Timeline.setTargetedTrack(videoIdx - 1);
}*/
```

---

*Nota: Totes aquestes funcions estan disponibles en l'historial de Git, però s'arxiven aquí per a una consulta ràpida del desenvolupador.*
