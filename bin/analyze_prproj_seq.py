# ============================================================================
# Analitza un .prproj descomprimit (XML pla) resolvent ObjectID/ObjectRef:
# per a cada Sequence → track items (tl Start/End, media In/Out, nom media).
# Ús: analyze_prproj_seq.py <xml_path> [seqNameDetall]
# ============================================================================
import re, sys
from collections import Counter

TICKS = 254016000000.0

def sec(t):
    return None if t is None else int(t) / TICKS

OBJ_RE = re.compile(r'<(\w+) Object(?:ID|UID)="([^"]+)"[^>]*>(.*?)</\1>', re.S)

def tag(body, name):
    m = re.search(r'<%s>([^<]*)</%s>' % (name, name), body)
    return m.group(1) if m else None

def main():
    path = sys.argv[1]
    target = sys.argv[2] if len(sys.argv) > 2 else None
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        xml = f.read()
    print("XML: %.1f MB" % (len(xml) / 1e6))

    # 1. Indexar objectes per ObjectID
    objs = {}
    for m in OBJ_RE.finditer(xml):
        objs[m.group(2)] = (m.group(1), m.group(3))
    print("Objectes indexats:", len(objs))

    # 2. Resoldre nom de media d'un track item seguint refs (SubClip→Clip→ProjectItem)
    def media_name(body, depth=0):
        if depth > 4:
            return '?'
        nm = tag(body, 'Name')
        if nm and ('.' in nm[-6:] or depth > 0):
            return nm
        for rm in re.finditer(r'<\w+ ObjectRef="(\d+)"/>', body):
            ref = objs.get(rm.group(1))
            if ref:
                n2 = media_name(ref[1], depth + 1)
                if n2 != '?':
                    return n2
        return nm or '?'

    # 3. Per cada Sequence: track items amb Start/End + In/Out del SubClip
    seqs = []
    for oid, (typ, body) in objs.items():
        if typ != 'Sequence':
            continue
        name = tag(body, 'Name') or '?'
        items = []
        for rm in re.finditer(r'<TrackItem Index="\d+" ObjectRef="(\d+)"/>', body):
            ref = objs.get(rm.group(1))
            if not ref:
                continue
            tb = ref[1]
            s, e = sec(tag(tb, 'Start')), sec(tag(tb, 'End'))
            sub = re.search(r'<SubClip ObjectRef="(\d+)"/>', tb)
            mi = mo = None
            mn = '?'
            if sub:
                so = objs.get(sub.group(1))
                if so:
                    mi, mo = sec(tag(so[1], 'InPoint')), sec(tag(so[1], 'OutPoint'))
                    mn = media_name(so[1])
            items.append({'s': s, 'e': e, 'i': mi, 'o': mo, 'name': mn, 'type': ref[0]})
        seqs.append((name, items))

    print("\nSEQÜÈNCIES (%d):" % len(seqs))
    for name, items in seqs:
        medias = Counter(i['name'] for i in items)
        top = ", ".join("%dx %s" % (c, n[:38]) for n, c in medias.most_common(3))
        tl_max = max([(i['e'] or 0) for i in items], default=0)
        print("  - %-36s items=%3d tl=[0..%7.1fs] %s" % (name[:36], len(items), tl_max, top))

    if target:
        for name, items in seqs:
            if name == target:
                items.sort(key=lambda x: (x['s'] if x['s'] is not None else -1))
                print("\nDETALL '%s': %d track items" % (target, len(items)))
                fmt = lambda v: ("%8.2f" % v) if v is not None else "     ---"
                for i in items[:24]:
                    print("  %s→%s ← %s→%s  %-14s %s" % (fmt(i['s']), fmt(i['e']), fmt(i['i']), fmt(i['o']), i['type'], i['name'][:55]))
                return
        print("\nSeqüència '%s' NO trobada" % target)

if __name__ == '__main__':
    main()