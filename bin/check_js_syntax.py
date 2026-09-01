# ============================================================================
# Check ràpid de sintaxi JS: balance de {} () [] fora de strings/comentaris.
# Ús: check_js_syntax.py <fitxer...>
# ============================================================================
import sys

def check(path):
    with open(path, "r", encoding="utf-8") as f:
        t = f.read()
    state = "code"  # code | s1 | s2 | tpl | lc | bc
    stack = []
    errors = []
    i = 0
    n = len(t)
    line = 1
    while i < n:
        c = t[i]
        if c == "\n":
            line += 1
        if state == "code":
            if c == "/" and i + 1 < n and t[i + 1] == "/":
                state = "lc"; i += 2; continue
            if c == "/" and i + 1 < n and t[i + 1] == "*":
                state = "bc"; i += 2; continue
            if c == "'":
                state = "s1"; i += 1; continue
            if c == '"':
                state = "s2"; i += 1; continue
            if c == "`":
                state = "tpl"; i += 1; continue
            if c in "([{":
                stack.append((c, line)); i += 1; continue
            if c in ")]}":
                pairs = {")": "(", "]": "[", "}": "{"}
                if not stack or stack[-1][0] != pairs[c]:
                    errors.append("L%d: tancament '%s' sense obertura" % (line, c))
                else:
                    stack.pop()
                i += 1; continue
            i += 1; continue
        if state == "s1":
            if c == "\\":
                i += 2; continue
            if c == "'":
                state = "code"
            i += 1; continue
        if state == "s2":
            if c == "\\":
                i += 2; continue
            if c == '"':
                state = "code"
            i += 1; continue
        if state == "tpl":
            if c == "\\":
                i += 2; continue
            if c == "`":
                state = "code"
            i += 1; continue
        if state == "lc":
            if c == "\n":
                state = "code"
            i += 1; continue
        if state == "bc":
            if c == "*" and i + 1 < n and t[i + 1] == "/":
                state = "code"; i += 2; continue
            i += 1; continue
    if state in ("s1", "s2", "tpl"):
        errors.append("string/template sense tancar")
    for open_ch, open_line in stack:
        errors.append("L%d: '%s' sense tancar" % (open_line, open_ch))
    print("%-45s %s" % (path.split("\\")[-1], "OK" if not errors else "; ".join(errors)))

def main():
    for p in sys.argv[1:]:
        check(p)

if __name__ == "__main__":
    main()
