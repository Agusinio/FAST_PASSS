# 🔧 GUÍA DE WORKFLOW - Arreglo Sistemático de Problemas

## 📋 Proceso de Trabajo

### 1️⃣ ANTES DE EMPEZAR UN FIX

```bash
# Asegúrate de estar en la rama principal
git checkout main

# Actualiza tu rama (si trabajas en equipo)
git pull origin main

# Verifica que no hay cambios sin guardar
git status
```

---

### 2️⃣ CREAR RAMA PARA EL FIX

**Convención de nombres:**
```
fix/[NUMERO]-[descripcion-corta]
```

**Ejemplos:**
```bash
# Para el Problema #2 (Debugger en producción)
git checkout -b fix/002-remove-debugger

# Para el Problema #3 (JSON inseguro)
git checkout -b fix/003-secure-json-handling

# Para el Problema #6 (Código comentado)
git checkout -b fix/006-remove-commented-code
```

---

### 3️⃣ TRABAJAR EN EL FIX

1. **Haz los cambios necesarios** en los archivos
2. **Prueba que funciona** (si es posible)
3. **Revisa qué has cambiado:**
   ```bash
   git status
   git diff
   ```

---

### 4️⃣ GUARDAR LOS CAMBIOS (COMMIT)

**Plantilla de mensaje de commit:**

```bash
git add .
git commit -m "Fix #[NUMERO]: [Título del problema]

[Descripción de qué se hizo]

Cambios:
- [Cambio 1]
- [Cambio 2]
- [Cambio 3]

Archivos modificados:
- [archivo1.js]
- [archivo2.jsx]

Relacionado con: INFORME_REVISION_CODIGO.md - Problema #[NUMERO]"
```

**Ejemplo Real:**

```bash
git add jsx/main.jsx
git commit -m "Fix #002: Eliminar debugger activo en producción

Se ha eliminado el debugger y $.level=1 de la función jsx_findOrCreateBin
que causaba que la extensión se congelara si el usuario tenía el debugger
de ExtendScript abierto.

Cambios:
- Eliminadas líneas 87-88 de jsx/main.jsx
- Función jsx_findOrCreateBin ahora ejecuta sin pausas

Archivos modificados:
- jsx/main.jsx

Relacionado con: INFORME_REVISION_CODIGO.md - Problema #002"
```

---

### 5️⃣ INTEGRAR EL FIX A MAIN

```bash
# Volver a la rama principal
git checkout main

# Integrar los cambios de tu rama de fix
git merge fix/002-remove-debugger

# (Opcional) Eliminar la rama de fix ya integrada
git branch -d fix/002-remove-debugger
```

---

### 6️⃣ CREAR TAG DE VERSIÓN (Cada X Fixes)

Después de completar varios fixes importantes, crea una versión:

```bash
# Ver tags existentes
git tag

# Crear nuevo tag (ejemplo: después de arreglar los 5 críticos)
git tag -a v7.0.2 -m "Versión 7.0.2 - Fixes críticos completados

Problemas resueltos:
- #002: Debugger en producción eliminado
- #003: Manejo seguro de JSON implementado
- #004: Validación de importación añadida
- #005: Validación de rutas de red
- #035: Sanitización de inputs en callJSX"

# Ver información del tag
git show v7.0.2
```

---

## 🎯 ORDEN SUGERIDO DE FIXES

### 🔴 Fase 1: Críticos (Semana 1)
```bash
git checkout -b fix/002-remove-debugger
git checkout -b fix/003-secure-json-handling
git checkout -b fix/004-import-validation
git checkout -b fix/005-network-path-validation
git checkout -b fix/035-sanitize-inputs
```
**Tag después:** `v7.0.2-critical-fixes`

### 🟠 Fase 2: Altos (Semana 2)
```bash
git checkout -b fix/006-remove-commented-code
git checkout -b fix/007-standardize-naming
git checkout -b fix/008-error-handling
git checkout -b fix/011-magic-numbers-constants
```
**Tag después:** `v7.1.0-high-priority-fixes`

### 🟡 Fase 3: Medios (Semana 3)
```bash
git checkout -b fix/013-add-jsdoc
git checkout -b fix/015-standardize-returns
git checkout -b fix/016-type-validation
```
**Tag después:** `v7.2.0-medium-priority-fixes`

---

## 📊 COMANDOS ÚTILES

### Ver historial de cambios
```bash
# Historial completo
git log --oneline --graph --all

# Solo los últimos 10 commits
git log --oneline -10

# Cambios de un archivo específico
git log --oneline -- jsx/main.jsx
```

### Ver diferencias
```bash
# Diferencias no guardadas
git diff

# Diferencias entre commits
git diff v7.0.1 v7.0.2

# Diferencias de un archivo específico
git diff main fix/002-remove-debugger -- jsx/main.jsx
```

### Deshacer cambios
```bash
# Descartar cambios no guardados de un archivo
git checkout -- archivo.js

# Volver a un commit anterior (CUIDADO)
git reset --hard [hash-del-commit]

# Crear un commit que deshace otro commit
git revert [hash-del-commit]
```

### Gestión de ramas
```bash
# Ver todas las ramas
git branch -a

# Eliminar rama local
git branch -d fix/002-remove-debugger

# Eliminar rama remota (si usas GitHub/GitLab)
git push origin --delete fix/002-remove-debugger
```

---

## 🚨 REGLAS DE ORO

1. **NUNCA** hagas commit directamente en `main` sin probar
2. **SIEMPRE** crea una rama para cada fix
3. **NUNCA** mezcles múltiples fixes en un mismo commit
4. **SIEMPRE** escribe mensajes de commit descriptivos
5. **NUNCA** hagas `git push --force` en `main`
6. **SIEMPRE** haz `git status` antes de commit
7. **NUNCA** versiones archivos grandes (videos, renders)
8. **SIEMPRE** prueba antes de hacer merge a `main`

---

## 🆘 PROBLEMAS COMUNES

### "Tengo cambios sin guardar y quiero cambiar de rama"
```bash
# Opción 1: Guardar temporalmente (stash)
git stash
git checkout otra-rama
# Cuando vuelvas:
git stash pop

# Opción 2: Hacer commit de los cambios
git add .
git commit -m "WIP: Trabajo en progreso"
```

### "Me equivoqué en el último commit"
```bash
# Si NO has hecho push todavía:
git commit --amend -m "Mensaje corregido"

# Si ya hiciste push:
# Mejor hacer un nuevo commit con la corrección
```

### "Quiero ver cómo estaba un archivo antes"
```bash
# Ver versión de hace 3 commits
git show HEAD~3:jsx/main.jsx

# Ver versión de un tag específico
git show v7.0.1:jsx/main.jsx
```

---

## 📝 PLANTILLA DE COMMIT RÁPIDA

Crea un archivo `.gitmessage` en tu home:

```bash
# Crear plantilla
cat > ~/.gitmessage << 'EOF'
Fix #XXX: [Título corto del problema]

[Descripción detallada de qué se hizo y por qué]

Cambios:
- 
- 

Archivos modificados:
- 

Relacionado con: INFORME_REVISION_CODIGO.md - Problema #XXX
EOF

# Configurar Git para usarla
git config --global commit.template ~/.gitmessage
```

Ahora cuando hagas `git commit` sin `-m`, se abrirá tu editor con la plantilla.

---

## 🎓 RECURSOS

- [Git Cheat Sheet](https://education.github.com/git-cheat-sheet-education.pdf)
- [Visualizador de Git](https://git-school.github.io/visualizing-git/)
- [Oh Shit, Git!?!](https://ohshitgit.com/) - Soluciones a problemas comunes

---

**Última actualización:** 26 de Enero de 2026  
**Versión del documento:** 1.0
