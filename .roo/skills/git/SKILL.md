---
name: git
description: Flujo de trabajo Git para FAST >>> PASS usando Git Portable en E:\PortableGit.
modeSlugs:
  - code
  - debug
  - architect
---

# 🐙 Git — Flujo de Trabajo para FAST >>> PASS

Skill para gestionar el control de versiones del proyecto usando Git Portable ubicado en `E:\PortableGit`.

---

## ⚙️ Configuración

| Variable | Valor |
|----------|-------|
| **Binario Git** | `E:\PortableGit\bin\git.exe` |
| **Directorio del repo** | `c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS` |
| **Flag obligatorio** | `-C` para especificar el directorio de trabajo |
| **user.name** | `Agusinio` |
| **user.email** | `agonzalez.x@gmail.com` |
| **Remote origin** | `https://github.com/Agusinio/FAST_PASSS_81c-LIPO.git` |

---

## 📋 Comandos Esenciales

### Ver estado del repo

```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" status
```

### Ver diff de cambios

```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" diff --stat
```

### Commit acumulativo

```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" add -A
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" commit -m "mensaje descriptivo"
```

### Ver log reciente

```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" log --oneline -10
```

### Push a GitHub

```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" push origin main
```

### Pull de GitHub

```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" pull origin main
```

---

## 📝 Convenciones de Commit

### Formato del mensaje

```
[tipo]: [descripción breve en español/catalán]

Tipos:
- BUGs #X-#Y:  → fixes de bugs
- feat:        → nueva funcionalidad
- refactor:    → reestructuración sin cambiar comportamiento
- docs:        → cambios en documentación
- cleanup:     → eliminación de código muerto/archivos
- consolidacion: → unificación de estructuras
```

### Ejemplos

```
BUGs #14-#16: fix marcadores F3.5/F4/F5 verde + F2·Deducido 00:00 + MP4 IN cross-agrupacio
consolidacion: limpiar bin/, estandarizar archive/ a .md, eliminar OLD_CODE/ y graphify-out/
refactor: reestructuración Harness Engineering — .roo/ como centro de control
```

---

## 🛡️ Reglas de Oro

1. **No commit sin testear** — El usuario debe verificar en Premiere antes de commitear fixes de código.
2. **Commits atómicos** — Un commit = un tema (un bug, una feature, una limpieza).
3. **No commitear basura** — `.gitignore` excluye `._*` (resource forks), `graphify-out/`, `.roo/progress/*.md` (excepto README).
4. **Siempre usar `-C` flag** — Git Portable no está en PATH, requiere ruta absoluta al binario y flag `-C` para el directorio.
5. **Push puede fallar** — La red puede ser inestable. Si `push` falla con `Connection was reset`, los commits quedan locales. Reintentar más tarde.

---

## ⚠️ Troubleshooting

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `git : The term 'git' is not recognized` | Git Portable no está en PATH | Usar ruta completa: `"E:\PortableGit\bin\git.exe"` |
| `fatal: not a git repository` | Falta el flag `-C` | Añadir `-C "ruta\al\repo"` |
| `fatal: unable to access ... Recv failure` | Problema de red | Los commits son locales. Reintentar push más tarde. |
| `Your branch is ahead of 'origin/main' by N commits` | Commits locales sin push | Hacer `push` cuando la red esté disponible |
| `warning: LF will be replaced by CRLF` | Conversión de finales de línea | Inofensivo. Windows ↔ Unix line endings. |

---

## 🔗 Referencias

- Guía de desarrollo: [`docs/guides/DEVELOPMENT.md`](docs/guides/DEVELOPMENT.md)
- Git workflow: [`docs/guides/GIT_WORKFLOW.md`](docs/guides/GIT_WORKFLOW.md)
- Inicio rápido Git: [`docs/guides/README_GIT.md`](docs/guides/README_GIT.md)

---

© 2026 FAST >>> PASS | git Skill v1.0.0
