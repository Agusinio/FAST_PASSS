# ============================================================================
# Substitueix "VERTICALITZACIÓ" (ruta amb accent) per "VERTICALITZACIO"
# en tots els fitxers de text de l'extensió (excepte .git i binaris).
# Ús: fix_ruta_accent.py [--dry]  (sense --dry fa els canvis)
# ============================================================================
import os, sys

ROOT = r"c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS"
OLD = "VERTICALITZACI" + "\u00d3"   # VERTICALITZACIÓ
NEW = "VERTICALITZACIO"
DRY = "--dry" in sys.argv

changed = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    if ".git" in dirpath.split(os.sep):
        continue
    for fn in filenames:
        p = os.path.join(dirpath, fn)
        if "fix_ruta_accent.py" in p:
            continue  # aquest script ha de conservar l'OLD per poder buscar
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read()
        except Exception:
            continue
        if OLD in txt:
            n = txt.count(OLD)
            changed.append((p, n))
            if not DRY:
                with open(p, "w", encoding="utf-8") as f:
                    f.write(txt.replace(OLD, NEW))

print("Fitxers amb la ruta amb accent: %d" % len(changed))
for p, n in changed:
    print("  [%d] %s" % (n, p))
if DRY:
    print("(mode dry-run: no s'ha modificat res)")
else:
    print("Substitucio completada.")
