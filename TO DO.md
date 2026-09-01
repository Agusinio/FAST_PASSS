# TO DO — FAST PASS

Pendientes detectados durante el desarrollo de la extensión.

---

## 🔄 Proceso «Actualizar» (UPDATE)

### 1. Importa el clip generado por el motor ✅
- [x] **Problema:** al ejecutar **Actualizar** se importa el clip del programa generado por el motor.
- [x] **Comportamiento esperado:** solo se debe **disparar el corte del clip MP4** cuando **no exista ya** un clip en el proyecto. Si ya existe, no debe reimportarse.

### 2. Importa el SRT a la pista de subtítulos ✅
- [x] **Problema:** el flujo de **Actualizar** también importa el `.srt` a la pista de subtítulos, cosa que no debería hacer.
- [x] **Comportamiento esperado:** revisar el proceso de Actualizar para que **no** modifique la pista de subtítulos.

---

## ✂️ Edición de SRT en el timeline
- [x] **Problema:** la edición de SRT en el timeline tiene **bugs**.
- [x] **Acción:** verificar y corregir los bugs de edición de subtítulos. (Resuelto: marcadores, export y persistencia funcionando)

---

## 🎬 Tema-Títol (Titol)

### Fallback que coloca un Títol sustituto congelado ✅
- [x] **Problema:** cuando no se encuentra el **Tema-Títol**, un fallback coloca un **Títol sustituto** en el Timeline y lo **congela**.
- [x] **Acción:** **eliminar ese fallback**; no debe colocarse ningún títol sustituto.
