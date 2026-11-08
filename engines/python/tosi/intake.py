"""Stage 1, intake. See spec/stages/intake/README.md.

Fingerprint the file, unpack it, read the database's catalogue, recognise the kind of filing,
and check it has what the rules need. Writes intake.json and the unpacked database into the
output folder. Progress goes to stderr as JSON lines; the result goes to stdout.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

CHUNK = 1 << 20  # 1 MiB
ROOT = Path(__file__).resolve().parents[3]
RULES = json.loads((ROOT / "spec" / "rulebook" / "intake.json").read_text())


def emit(step, state, **fields):
    sys.stderr.write(json.dumps({"event": "step", "step": step, "state": state, **fields}, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def sha256_of(path, step):
    total = path.stat().st_size
    emit(step, "start", total=total)
    h, done, last = hashlib.sha256(), 0, 0
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
            done += len(chunk)
            if done - last >= 16 * CHUNK or done == total:
                emit(step, "progress", done=done, total=total)
                last = done
    digest = h.hexdigest()
    emit(step, "done", sha256=digest)
    return digest


def refuse(result, key, missing=()):
    text = RULES["reasons"][key].replace("{missing}", ", ".join(missing))
    result["check"] = {"status": "refused", "missing": list(missing), "reason": text}
    return result


def read_catalogue(path):
    from access_parser import AccessParser  # imported here so `info` never needs it

    db = AccessParser(str(path))
    names = sorted((n for n in db.catalog if not n.startswith("MSys")), key=lambda s: s.encode())
    emit("database", "progress", done=0, total=len(names))
    tables = []
    for i, name in enumerate(names, 1):
        head = db.get_table(name).table_header
        tables.append({"name": name, "rows": int(head.number_of_rows), "columns": [c.col_name_str for c in head.column_names]})
        emit("database", "progress", done=i, total=len(names), table=name, rows=int(head.number_of_rows))
    return tables


def run(file, name, out):
    file, out = Path(file), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    result = {
        "schema": "intake/1",
        "file": {"name": name, "bytes": file.stat().st_size, "sha256": sha256_of(file, "fingerprint")},
        "archive": None,
        "database": None,
        "kind": "unknown",
        "check": None,
    }

    emit("unpack", "start")
    if not zipfile.is_zipfile(file):
        emit("unpack", "done", refused=True)
        return finish(refuse(result, "not_zip"), out)
    with zipfile.ZipFile(file) as z:
        infos = z.infolist()
        result["archive"] = {"entries": [{"name": i.filename, "bytes": i.file_size, "packed": i.compress_size} for i in infos]}
        mdb = next((i for i in infos if i.filename.lower().endswith(".mdb")), None)
        if mdb is None:
            emit("unpack", "done", refused=True)
            return finish(refuse(result, "no_database"), out)
        target = out / "database.mdb"
        emit("unpack", "progress", done=0, total=mdb.file_size, entry=mdb.filename)
        done, last = 0, 0
        with z.open(mdb) as src, open(target, "wb") as dst:
            while chunk := src.read(CHUNK):
                dst.write(chunk)
                done += len(chunk)
                if done - last >= 32 * CHUNK or done == mdb.file_size:
                    emit("unpack", "progress", done=done, total=mdb.file_size, entry=mdb.filename)
                    last = done
    emit("unpack", "done")

    db_sha = sha256_of(target, "database-fingerprint")
    emit("database", "start")
    try:
        tables = read_catalogue(target)
    except Exception:
        emit("database", "done", refused=True)
        return finish(refuse(result, "unreadable"), out)
    result["database"] = {"name": mdb.filename, "bytes": target.stat().st_size, "sha256": db_sha,
                          "rows": sum(t["rows"] for t in tables), "tables": tables}
    emit("database", "done", tables=len(tables), rows=result["database"]["rows"])

    present = {t["name"]: t["columns"] for t in tables}
    emit("recognise", "start")
    kind = next((k for k, v in RULES["kinds"].items() if all(m in present for m in v["markers"])), "unknown")
    result["kind"] = kind
    emit("recognise", "done", kind=kind)

    emit("check", "start")
    if kind == "unknown":
        emit("check", "done", status="refused")
        return finish(refuse(result, "unknown_kind"), out)
    missing = []
    for table, cols in RULES["kinds"][kind]["required"].items():
        if table not in present:
            missing.append(table)
        else:
            missing += [f"{table}.{c}" for c in cols if c not in present[table]]
    if missing:
        emit("check", "done", status="refused")
        return finish(refuse(result, "missing", missing), out)
    result["check"] = {"status": "accepted", "missing": [], "reason": None}
    emit("check", "done", status="accepted")
    return finish(result, out)


def finish(result, out):
    text = json.dumps(result, separators=(",", ":"), ensure_ascii=False)
    (out / "intake.json").write_text(text + "\n", encoding="utf-8")
    return text
