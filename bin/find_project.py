# Localitza la carpeta del projecte al NAS (esquivant problemes d'accents
# de PowerShell) i copia el .prproj indicat a C:\temp per anàlisi offline.
# Ús: find_project.py <dir_rel_proves> <prefix_prproj> <dst>
import os, shutil, sys

BASE = r"\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2"

def main():
    rel, prefix, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    for d in os.listdir(BASE):
        if not d.startswith("AAA_PROJECTES"):
            continue
        p = os.path.join(BASE, d, rel)
        if not os.path.isdir(p):
            continue
        print("DIR:", p)
        cands = [f for f in os.listdir(p) if f.startswith(prefix) and f.endswith(".prproj")]
        if not cands:
            print("Cap .prproj amb prefix", prefix)
            return
        src = os.path.join(p, cands[0])
        shutil.copy(src, dst)
        print("COPIAT:", cands[0], "->", dst, os.path.getsize(dst), "bytes")
        return
    print("NO TROBAT:", rel)

if __name__ == "__main__":
    main()