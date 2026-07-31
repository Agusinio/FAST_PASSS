# ============================================================================
# Verifica si TNC_V2_CLIP_AUDIO_REF.bin (WAV u8 8kHz) conte el MATEIX audio
# que TNC_V2_CLIP.mp4. Compara empremtes de peaks (max |b-128| per finestra
# de 10ms) i cerca el millor desfasament temporal (lag).
# ============================================================================
import subprocess, sys, os

FFMPEG = r"E:\ffmpeg\bin\ffmpeg.exe"
BASE = r"\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2"
# Ús: verify_audio_match.py [DIR_REL] [MP4_NAME] [BIN_NAME]
DIR_REL = sys.argv[1] if len(sys.argv) > 1 else r"PROVES\02_COMARQUES_PROJECTES\2026_07_30"
MP4_NAME = sys.argv[2] if len(sys.argv) > 2 else "TNC_V2_CLIP.mp4"
BIN_NAME = sys.argv[3] if len(sys.argv) > 3 else MP4_NAME.replace(".mp4", "_AUDIO_REF.bin")
SECONDS = 60      # trams a comparar
PPS = 100         # peaks/segon (finestra 10ms)
SR = 8000

def find_dir():
    for d in os.listdir(BASE):
        if d.startswith("AAA_PROJECTES"):
            cand = os.path.join(BASE, d, DIR_REL)
            if os.path.isdir(cand):
                return cand
    sys.exit("NO trobo la carpeta del projecte")

def extract_pcm(path, seconds):
    r = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-t", str(seconds),
                        "-ac", "1", "-ar", str(SR), "-f", "u8", "-"],
                       capture_output=True)
    if r.returncode != 0:
        sys.exit("ffmpeg error: " + r.stderr.decode("utf8", "replace")[:300])
    return r.stdout

def wav_data(p):
    with open(p, "rb") as f:
        b = f.read()
    if b[:4] != b"RIFF":
        return b, 0
    pos = 12
    while pos + 8 <= len(b):
        cid = b[pos:pos+4]
        size = int.from_bytes(b[pos+4:pos+8], "little")
        if cid == b"data":
            return b, pos + 8
        pos += 8 + size + (size % 2)
    return b, 44

def peaks(data, off=0, limit=None):
    step = SR // PPS
    n = len(data) if limit is None else min(len(data), off + limit * step)
    out = []
    i = off
    while i + step <= n:
        m = 0
        for byte in data[i:i+step]:
            v = byte - 128
            if v < 0:
                v = -v
            if v > m:
                m = v
        out.append(m)
        i += step
    return out

def compare(pa, pb, lag):
    """mitjana |a-b| comparant pa[i] amb pb[i+lag]"""
    s, c = 0, 0
    for i in range(len(pa)):
        j = i + lag
        if 0 <= j < len(pb):
            s += abs(pa[i] - pb[j]); c += 1
    return (s / c) if c > 200 else None

def main():
    d = find_dir()
    mp4, binp = os.path.join(d, MP4_NAME), os.path.join(d, BIN_NAME)
    print("MP4:", mp4)
    print("BIN:", binp)

    raw = extract_pcm(mp4, SECONDS)
    wav, doff = wav_data(binp)
    print("PCM mp4: %d bytes | WAV data off=%d len=%d (%.1fs)" % (len(raw), doff, len(wav)-doff, (len(wav)-doff)/SR))

    pa = peaks(raw)                       # mp4
    pb = peaks(wav, doff)                 # bin
    print("peaks mp4=%d, peaks bin=%d (%.1fs)" % (len(pa), len(pb), len(pb)/PPS))

    # Cerca de lag (+-3s en passos de 10ms)
    best = None
    for lag in range(-300, 301):
        m = compare(pa, pb, lag)
        if m is not None and (best is None or m < best[1]):
            best = (lag, m)
    m0 = compare(pa, pb, 0)
    print("\nDiff mitjana lag=0: %.2f (de 128)" % m0)
    print("Millor lag: %+d finestres (%+.2fs) amb diff %.2f" % (best[0], best[0]/PPS, best[1]))
    ok = best[1] < 6
    print("\nVEREDICTE: %s" % ("MATEIX AUDIO (diff petita)" if ok else "AUDIO DIFERENT o molt sorollos"))

    # Mostra visual: segons 20-24
    lag = best[0] if ok else 0
    i0 = 20 * PPS
    print("\nMostra 20-24s (mp4 vs bin, lag aplicat):")
    print("mp4:", " ".join("%3d" % v for v in pa[i0:i0+40]))
    print("bin:", " ".join("%3d" % (pb[i+lag] if 0 <= i+lag < len(pb) else -1) for i in range(i0, i0+40)))

if __name__ == "__main__":
    main()