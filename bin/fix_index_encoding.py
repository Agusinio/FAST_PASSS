# ============================================================================
# Recupera index.html del commit bf6677b (contingut correcte UTF-8), aplica
# cachebuster v5 sense corrompre encoding, i escaneja mojibake a la resta.
# ============================================================================
import subprocess, os, re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = r"c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS"
GIT = r"E:\PortableGit\cmd\git.exe"
INDEX = os.path.join(REPO, "index.html")
GOOD_COMMIT = "bf6677b"

# 1. Extreure els bytes exactes del blob correcte
r = subprocess.run([GIT, "show", GOOD_COMMIT + ":index.html"], cwd=REPO, capture_output=True)
if r.returncode != 0:
    print("ERROR git show:", r.stderr.decode("utf-8", "replace"))
    raise SystemExit(1)
data = r.stdout
print("Blob recuperat:", len(data), "bytes")

# 2. Decodificar UTF-8 (ha de ser vàlid si el commit era correcte)
try:
    t = data.decode("utf-8")
except UnicodeDecodeError as e:
    print("El blob NO és UTF-8 vàlid:", e)
    raise SystemExit(1)

# 3. Cachebuster v2 -> v5
n = t.count("?v=2")
t = t.replace("?v=2", "?v=5")
print("cachebusters v2->v5:", n)

# 4. Escriure UTF-8 sense BOM, amb LF
with open(INDEX, "w", encoding="utf-8", newline="\n") as f:
    f.write(t)
print("index.html reescrit OK")

# 5. Verificació ràpida
check = open(INDEX, encoding="utf-8").read()
for token in ["SUBTÍTOLS", "GRÀFICS", "VÍDEO", "⇒ MOURE", "?v=5", "CHYRONS"]:
    print("  token '%s': %s" % (token, "OK" if token in check else "FALTA!"))

# 6. Escaneig de mojibake a la resta d'arxius de text (patrons típics)
MOJI = re.compile(r"Ã|Â|â€|â„¢|ï¿½|Ã¢|Ãƒ")
bad = []
for dirpath, dirnames, filenames in os.walk(REPO):
    if ".git" in dirpath.split(os.sep):
        continue
    for fn in filenames:
        if not fn.lower().endswith((".js", ".jsx", ".html", ".css", ".json", ".md", ".ps1")):
            continue
        p = os.path.join(dirpath, fn)
        try:
            with open(p, "r", encoding="utf-8", errors="strict") as f:
                content = f.read()
        except Exception:
            continue
        m = MOJI.search(content)
        if m:
            # mostrar context
            i = m.start()
            ctx = content[max(0, i - 20):i + 20].replace("\n", " ")
            bad.append((p, m.group(0), ctx))
print("\nMojibake detectat en %d fitxers:" % len(bad))
for p, pat, ctx in bad[:25]:
    print("  %s  [%s] ...%s..." % (p.replace(REPO, "."), pat, ctx))
