#!/usr/bin/env python3
"""Run every stage in every engine on one file and compare each stage's result byte for byte.

    python3 compare/agree.py <file> [out-dir]

Engines are started exactly as engines/engines.json says. Prints each engine's time and the
SHA-256 of its intake.json, then whether they agree. Exit code 0 only if all agree.
"""
import hashlib, json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    f = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / "runs" / "agree").resolve()
    engines = json.loads((ROOT / "engines" / "engines.json").read_text())["engines"]
    hashes = {}
    for e in engines:
        cwd = ROOT / e["cwd"]
        base = [str(cwd / e["cmd"]) if "/" in e["cmd"] else e["cmd"], *e["args"]]
        folder = out / e["id"]
        stages = [("intake", ["intake", "--file", str(f), "--out", str(folder)])]
        hashes[e["id"]] = {}
        for stage, args in stages:
            t = time.time()
            p = subprocess.run(base + args, cwd=cwd, capture_output=True, text=True)
            ms = round((time.time() - t) * 1000)
            res = folder / f"{stage}.json"
            h = hashlib.sha256(res.read_bytes()).hexdigest() if p.returncode == 0 and res.exists() else None
            hashes[e["id"]][stage] = h
            print(f"{e['name']:11} {stage:9} {ms:7} ms  {h[:16] if h else 'FAILED':16}  {(p.stderr.strip().splitlines() or [''])[-1][:110] if not h else ''}")
            if stage == "intake" and h:
                r = json.loads(res.read_text())
                if r["kind"] == "space" and r["check"]["status"] == "accepted":
                    stages.append(("downlink", ["downlink", "--in", str(folder)]))
        (folder / "database.mdb").unlink(missing_ok=True)
    same = True
    for stage in {s for h in hashes.values() for s in h}:
        vals = [h.get(stage) for h in hashes.values()]
        ok = None not in vals and len(set(vals)) == 1
        same &= ok
        print(f"{stage}: {'agree' if ok else 'DISAGREE'}")
    sys.exit(0 if same else 1)


if __name__ == "__main__":
    main()
