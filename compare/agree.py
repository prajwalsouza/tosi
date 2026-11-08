#!/usr/bin/env python3
"""Run one stage in every engine on one file and compare the results byte for byte.

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
        cmd = [str(cwd / e["cmd"]) if "/" in e["cmd"] else e["cmd"], *e["args"], "intake", "--file", str(f), "--out", str(out / e["id"])]
        t = time.time()
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
        ms = round((time.time() - t) * 1000)
        res = out / e["id"] / "intake.json"
        h = hashlib.sha256(res.read_bytes()).hexdigest() if p.returncode == 0 and res.exists() else None
        hashes[e["id"]] = h
        check = json.loads(res.read_text())["check"] if h else p.stderr.strip()[-200:]
        print(f"{e['name']:11} {ms:7} ms  {h[:16] if h else 'FAILED':16}  {json.dumps(check)[:140]}")
        (out / e["id"] / "database.mdb").unlink(missing_ok=True)
    same = len(set(hashes.values())) == 1 and None not in hashes.values()
    print("agree" if same else "DISAGREE")
    sys.exit(0 if same else 1)

if __name__ == "__main__":
    main()
