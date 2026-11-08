"""Shared readers and exact numeric helpers for the space stages after Reach."""
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

from .intake import ROOT, emit
from .reach import RAD, DEG, num


def cites_of(rules):
    """The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them."""
    return {k: v for k, v in rules.items() if k == "method" or k == "basis" or k.endswith("_basis")}


def round2(x):
    scaled = x * 100 + 0.5
    # JS keeps non-finite arithmetic values until JSON.stringify writes null.
    if not math.isfinite(scaled):
        return scaled
    value = math.floor(scaled) / 100
    return int(value) if value == int(value) else value


def rulebook(stage):
    raw = (ROOT / "spec" / "rulebook" / f"{stage}.json").read_bytes()
    rules = json.loads(raw)
    return rules, {"version": rules["version"], "sha256": hashlib.sha256(raw).hexdigest(), "cites": cites_of(rules)}


def table(name):
    return read_json(ROOT / "spec" / "tables", f"{name}.json")


def emitter(stage):
    def progress(state, **fields):
        emit(stage, state, **fields)
    return progress


def ymd(value):
    """Access-parser returns naive UTC date strings; 1900 and earlier mean none."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc)
    return value.year * 10000 + value.month * 100 + value.day if value.year > 1900 else None


def read_json(folder, name):
    return json.loads((Path(folder) / name).read_text(encoding="utf-8"))


def _number_text(value):
    """Use JSON.stringify's decimal/exponent boundaries and integral float spelling."""
    if not math.isfinite(value):
        return "null"
    if value == 0:
        return "0"
    text = repr(value).lower()
    if "e" not in text:
        return text[:-2] if text.endswith(".0") else text
    mantissa, exponent = text.split("e")
    exponent = int(exponent)
    if -6 <= exponent < 21:
        sign = "-" if mantissa.startswith("-") else ""
        mantissa = mantissa.lstrip("-")
        whole, _, frac = mantissa.partition(".")
        digits = whole + frac
        point = len(whole) + exponent
        if point <= 0:
            return sign + "0." + "0" * -point + digits
        if point >= len(digits):
            return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    return mantissa + "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))


def compact_json(value):
    """Compact UTF-8 JSON in insertion order, including JS's number spelling."""
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + compact_json(v) for k, v in value.items()) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(map(compact_json, value)) + "]"
    if isinstance(value, float):
        return _number_text(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write(folder, name, result):
    text = compact_json(result)
    (Path(folder) / name).write_text(text + "\n", encoding="utf-8")
    return text


def require_space(folder, stage):
    intake = read_json(folder, "intake.json")
    if intake["kind"] != "space" or intake["check"]["status"] != "accepted":
        raise ValueError(f"{stage} needs an accepted space filing")
    return intake


def open_db(folder, progress):
    from access_parser import AccessParser

    db = AccessParser(str(Path(folder) / "database.mdb"))
    names = set(db.catalog)

    def read(name, columns):
        if name not in names:
            return []
        parsed = db.parse_table(name)
        have = [c for c in columns if c in parsed]
        # Preserve row count even if none of the requested columns exists.
        count = len(next(iter(parsed.values()), []))
        out = [{c: parsed[c][i] for c in have} for i in range(count)]
        progress("progress", table=name, rows=len(out))
        return out

    return read


def frequency_spans(read, want):
    span = {}
    for r in read("freq", ["grp_id", "freq_mhz", "freq_min", "freq_max"]):
        g = r.get("grp_id")
        if g not in want:
            continue
        lo, hi = num(r.get("freq_min")), num(r.get("freq_max"))
        if lo is None:
            lo = num(r.get("freq_mhz"))
        if hi is None:
            hi = num(r.get("freq_mhz"))
        if lo is None or hi is None:
            continue
        old = span.get(g)
        span[g] = (min(old[0], lo), max(old[1], hi)) if old else (lo, hi)
    return span


def groups(read, reach, down):
    seen = {n["ntc_id"]: n["type"] for n in reach["notices"] if n["seen"]}
    want = set(reach["groups"])
    received = {r.get("ntc_id"): ymd(r.get("d_rcv")) for r in read("notice", ["ntc_id", "d_rcv"])}
    span = frequency_spans(read, want)
    classes = {}
    for r in read("srv_cls", ["grp_id", "stn_cls"]):
        if r.get("grp_id") in want and isinstance(r.get("stn_cls"), str):
            classes.setdefault(r["grp_id"], set()).add(r["stn_cls"].strip())
    out = []
    for r in read("grp", ["grp_id", "ntc_id", "beam_name", "d_prot_eff"]):
        g, ntc = r.get("grp_id"), r.get("ntc_id")
        if g not in want or ntc not in seen:
            continue
        s = span.get(g)
        date = ymd(r.get("d_prot_eff"))
        out.append({"grp_id": g, "ntc_id": ntc, "type": seen[ntc],
                    "beam": r.get("beam_name") if isinstance(r.get("beam_name"), str) else None,
                    "lo": s[0] if s else None, "hi": s[1] if s else None,
                    "classes": sorted(classes.get(g, ())), "date": date if date is not None else received.get(ntc)})
    out.sort(key=lambda g: g["grp_id"])
    return out, seen


def orbits(read):
    out = {}
    for r in read("orbit", ["ntc_id", "inclin_ang", "apog_km", "perig_km"]):
        o = out.setdefault(r.get("ntc_id"), {"incl": None, "apog": None, "perig": None})
        for key, column, choose in (("incl", "inclin_ang", max), ("apog", "apog_km", max), ("perig", "perig_km", min)):
            value = num(r.get(column))
            if value is not None:
                o[key] = value if o[key] is None else choose(o[key], value)
    return out


def limits():
    t = table("pfd")
    area = {r["ix_prot_area"]: str(r["area_name"]).strip() for r in t["prot_area"]}
    classes = {}
    for r in t["classes_of_stn"]:
        s = classes.setdefault(r["ix_serv"], set())
        c = str(r.get("class_of_stn") or "")
        s.update(c[i:i + 2] for i in range(0, len(c) - 1, 2))

    def masks(rows):
        out = {}
        for r in rows:
            out.setdefault(r["mask_code"], []).append(r)
        for segs in out.values():
            segs.sort(key=lambda s: s["mask_segment"])
        return out

    return {"source": t["source"], "area": area, "classes": classes,
            "exam": {"G": t["freq_exam"], "N": t["ngso_freq_exam"]},
            "provision": {"G": {r["ix_provn"]: r for r in t["provisions"]},
                          "N": {r["ix_provn"]: r for r in t["ngso_provisions"]}},
            "mask": {"G": masks(t["pfd_mask"]), "N": masks(t["ngso_pfd_mask"])}}


def table_of(kind):
    return "G" if kind == "G" else "N"


def usable(segment):
    return not (num(segment.get("c4")) or 0) and not (num(segment.get("c5")) or 0)


def mask_at(segments, delta):
    out = None
    for s in segments:
        if not usable(s):
            continue
        x = max(delta + (num(s.get("c3")) or 0), 1e-9)
        term = math.log10(x) if s.get("ang_log") else x * x if s.get("ang_square") else x if s.get("ang") else 0
        flat = s["ang_min"] == 0 and s["ang_max"] == 0
        if flat or s["ang_min"] <= delta <= s["ang_max"]:
            out = s["c1"] + (num(s.get("c2")) or 0) * term
    return out


def bandwidth_hz(design):
    m = re.match(r"^([0-9]*)([HKMGT])([0-9]*)", str(design if design is not None else "").strip().upper())
    if not m or not (m[1] or m[3]):
        return None
    return float(f"{m[1] or '0'}.{m[3] or '0'}") * {"H": 1, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}[m[2]]


def power_in(pep, dens, b_hz, f_mhz, bref_hz, rules):
    if bref_hz <= 0:
        return pep
    d = None if dens is None else dens + 10 * math.log10(bref_hz)
    if d is None:
        return pep
    if pep is None or b_hz is None:
        return d
    averaging = rules["averaging"]
    bavg = averaging["below_hz"] if f_mhz < averaging["below_mhz"] else averaging["above_hz"]
    if bavg == bref_hz:
        return d
    if bavg < bref_hz:
        return min(d, pep) if b_hz >= bref_hz else pep
    return pep if b_hz < bref_hz else d


def stations():
    path = ROOT / "state" / "reference" / "stations.json"
    if not path.exists():
        return {"present": False, "sha256": None, "list": []}
    raw = path.read_bytes()
    return {"present": True, "sha256": hashlib.sha256(raw).hexdigest(), "list": json.loads(raw)["stations"]}


def gso_from(lon, lat, longitude, re, rg):
    c = math.cos(lat * RAD) * math.cos((lon - longitude) * RAD)
    s = math.sqrt(max(0, 1 - c * c))
    return {"el": math.atan2(c - re / rg, s) * DEG, "d": math.sqrt(re * re + rg * rg - 2 * re * rg * c)}


def beam_names(read, want):
    return {r.get("grp_id"): r.get("beam_name") if isinstance(r.get("beam_name"), str) else None
            for r in read("grp", ["grp_id", "beam_name"]) if r.get("grp_id") in want}


def beam_key(ntc, beam):
    # Match the TypeScript string key, including an explicitly null beam name.
    return f"{ntc}|{'null' if beam is None else beam}"


def beam_gains(read, ntcs, transmit):
    gain = {}
    for r in read("s_beam", ["ntc_id", "beam_name", "emi_rcp", "gain"]):
        if r.get("ntc_id") not in ntcs or r.get("emi_rcp") != transmit:
            continue
        g = num(r.get("gain"))
        key = beam_key(r["ntc_id"], r.get("beam_name"))
        if g is not None:
            gain[key] = max(gain.get(key, -math.inf), g)
    return gain
