# Handoff: Implementació Extracció de Clip via ffmpeg

**Data**: 2026-07-28 15:08  
**Estat**: En progrés — el clip es genera a C:\temp\ però NO es copia al directori del projecte per problemes d'Unicode/execució.

---

## Resum

### ✅ Què funciona
1. **`cep.fs.writeFile`** → escriu .bat a `C:\temp\` (fiable, ho fa servir `Utils._setLogPath`)
2. **`IO.readTxt`** per detectar `.done` quan el fitxer existeix (fiable, sense falsos positius)
3. **`cmd /c` des del terminal** → ffmpeg funciona perfectament (exit code 0, ~130x speed)
4. **Sense accent (`VERTICALITZACIO` → sense `Ó`)** → `copy /y` funciona (`1 file(s) copied`)
5. **Clip a `C:\temp\`** → es crea correctament si s'executa el .bat

### ❌ Què NO funciona des de Premiere CEP
| Mecanisme | Problema |
|-----------|----------|
| `IO.executeShell` | No executa realment la comanda |
| `cep.process.createProcess` | Obre finestra CMD però no executa (asíncron) |
| `File.execute()` JSX | No funciona (restriccions corporatives segurament) |
| `ActiveXObject` ExtendScript | No disponible |
| `System.callSystem` | No existeix a Premiere |
| `window.require('child_process')` | No disponible |
| Polling `IO.exists` a UNC | Falsos positius (retorna "true" sempre) |
| Polling `IO.readTxt` a UNC | Error de lectura |

---

## Últims canvis fets (avui)

### 1. `11_Configuracio.js`
- Canviat `destino_base`: `VERTICALITZACIO` → `VERTICALITZACIO` (sense accent)
- Els projectes es crearan al directori sense accent

### 2. `15_FFmpeg_Logic.js`
- **Evita UNC completament**. El `.bat` escriu a `C:\temp\` + `.done` a `C:\temp\`
- `waitForFile` usa `IO.readTxt` (fiable)
- Retorna `{ ok: true, path: "C:\\temp\\...mp4" }`
- Premiere importarà des de `C:\temp\`

### 3. Mòduls JSX
- Netejats: 13 fitxers actius (1-14), eliminats duplicats i mòduls antics catalans

---

## Pendents per demà

### Opció A (recomanada): Fer que `extractClip` escrigui directament al UNC sense accent
El test va demostrar que `copy /y` SÍ funciona quan el path no té accents. Com que `destino_base` ja no té accent:
1. Provocar que `extractClip` generi el .bat amb el path del projecte (sense accent)
2. Provar des de Premiere CEP

### Opció B: Fer que el clip es quedi a `C:\temp\`
Ja està implementat. Però Premiere va intentar importar des d'un altre lloc al darrer test — cal verificar.

### Opció C: Provar amb `cmd /c` via JS en lloc de .bat
Al log de les 14:00, `IO.executeShell` amb `cmd /c "C:\temp\extract.bat"` va mostrar que **NO executa**. Però al terminal funciona. Investigar per què.

---

## Tests de referència (des del terminal)

| Test | Resultat | Conclusió |
|------|----------|-----------|
| `ffmpeg -y "C:\temp\clip.mp4"` | ✅ | ffmpeg a local funciona |
| `ffmpeg -y "\\UNC\clip.mp4"` (_amb accent_) | ❌ | `VERTICALITZACIO` corromput a `VERTICALITZACI├ô` |
| `ffmpeg -y "\\UNC sense_accent\clip.mp4"` | ✅ | ffmpeg a UNC **sense accent** funciona |
| `copy /y "C:\temp" "\\UNC\clip.mp4"` (_amb accent_) | ❌ | `The system cannot find the path specified` (Unicode!) |
| `copy /y "C:\temp" "\\UNC_noaccent\clip.mp4"` | ✅ | `copy` a UNC **sense accent** funciona |
| `echo OK > C:\temp\done.txt` + `File.exists` | ✅ | `.done` funciona |
| PowerShell `Copy-Item` al UNC (_amb accent_) | ⚠️ | "was unexpected at this time" (error de parsing dins .bat) |

---

## Fitxers modificats

| Fitxer | Canvi |
|--------|-------|
| `js/core/11_Configuracio.js` | `destino_base` sense accent |
| `js/logic/15_FFmpeg_Logic.js` | Flux temp (evita UNC), fallbacks eliminats |
| `js/workflows/flow_mainButton.js` | Bloc `[EXTRACT]`, error fatal si falla |
| `js/logic/3_Project_Logic.js` | Detecció `_isExtractedClip`, fallback MP4 estàndard eliminat |
| `jsx/modules/14_FFmpeg.jsx` | Netejat (no usat actualment) |
| `jsx/main.jsx` | Bridge `FfmpegExt.extractClip` |
| `jsx/modules/` | 13 fitxers actius, duplicats eliminats |
| `bin/extract_clip.ps1` | Creat |

## Notes per demà
- Si `IO.executeShell` no executa, provar amb `cep.process.createProcess` per `cmd /c` directe (sense .bat)
- El path sense accent hauria de solucionar la meitat dels problemes
- La clau és trobar **un** mètode d'execució que funcioni des de Premiere CEP