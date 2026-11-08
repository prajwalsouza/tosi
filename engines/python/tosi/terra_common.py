"""Shared terrestrial readers, geometry and TypeScript-compatible output conventions."""
import hashlib
import json
import math
import re
from pathlib import Path

from .intake import ROOT, emit


def cites_of(rules):
    """The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them."""
    return {k: v for k, v in rules.items() if k == "method" or k == "basis" or k.endswith("_basis")}

RAD = math.pi / 180


def rulebook(stage):
    raw = (ROOT / "spec" / "rulebook" / f"{stage}.json").read_bytes()
    rules = json.loads(raw)
    return rules, {"version": rules["version"], "sha256": hashlib.sha256(raw).hexdigest(), "cites": cites_of(rules)}


def table_sha(name):
    return hashlib.sha256((ROOT / "spec" / "tables" / f"{name}.json").read_bytes()).hexdigest()


def round2(x):
    v = math.floor(x * 100 + 0.5) / 100
    return int(v) if v.is_integer() else v


def round3(x):
    v = math.floor(x * 1000 + 0.5) / 1000
    return int(v) if v.is_integer() else v


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def read_json(folder, name):
    return json.loads((Path(folder) / f"{name}.json").read_text(encoding="utf-8"))


def _number_text(v):
    if not math.isfinite(v):
        return "null"
    if v == 0:
        return "0"
    text = repr(v)
    if "e" not in text:
        return text[:-2] if text.endswith(".0") else text
    mantissa, exponent = text.split("e")
    exponent = int(exponent)
    if -6 <= exponent < 21:
        sign = "-" if mantissa.startswith("-") else ""
        whole, _, frac = mantissa.lstrip("-").partition(".")
        digits = whole + frac
        point = len(whole) + exponent
        if point <= 0:
            return sign + "0." + "0" * -point + digits
        if point >= len(digits):
            return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    return mantissa + "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))


def compact_json(value):
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + compact_json(v) for k, v in value.items()) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(map(compact_json, value)) + "]"
    if isinstance(value, float):
        return _number_text(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_result(folder, name, result):
    text = compact_json(result)
    (Path(folder) / f"{name}.json").write_text(text + "\n", encoding="utf-8")
    return text


def need_terrestrial(folder):
    intake = read_json(folder, "intake")
    if intake["kind"] != "terrestrial" or intake["check"]["status"] != "accepted":
        raise ValueError("This stage needs an accepted terrestrial filing")
    return intake


def open_db(folder):
    from access_parser import AccessParser

    db = AccessParser(str(Path(folder) / "database.mdb"))
    names = set(db.catalog)

    def read(step, table, columns):
        if table not in names:
            return []
        parsed = db.parse_table(table)
        have = [c for c in columns if c in parsed]
        count = len(next(iter(parsed.values()), []))
        out = [{c: parsed[c][i] for c in have} for i in range(count)]
        emit(step, "progress", table=table, rows=count)
        return out

    return read


def bandwidth_khz(code, fallback):
    m = re.match(r"^([0-9]*)([HKMGT])([0-9]*)", str(code if code is not None else "").strip().upper())
    if m and (m[1] or m[3]):
        return float(f"{m[1] or '0'}.{m[3] or '0'}") * {"H": 1e-3, "K": 1, "M": 1e3, "G": 1e6, "T": 1e9}[m[2]]
    return num(fallback)


def stations(read, step):
    geo = {g.get("geo_key"): g for g in read(step, "fxm_geo", ["geo_key", "geo_type", "long_dec", "lat_dec", "radius"])}
    out = []
    for r in read(step, "fxm_terra", ["terrakey", "adm", "stn_cls", "stage", "intent", "freq_assgn", "bdwdth_cde", "bdwdth", "geo_key"]):
        g = geo.get(r.get("geo_key"), {})
        radius = num(g.get("radius"))
        out.append({"terrakey": r.get("terrakey"), "adm": (r.get("adm") or "").strip(),
                    "cls": (r.get("stn_cls") or "").strip(), "stage": (r.get("stage") or "").strip(),
                    "intent": (r.get("intent") or "").strip(), "f": num(r.get("freq_assgn")),
                    "bw": (r.get("bdwdth_cde") or "").strip(), "bwKhz": bandwidth_khz(r.get("bdwdth_cde"), r.get("bdwdth")),
                    "lon": num(g.get("long_dec")), "lat": num(g.get("lat_dec")),
                    "radius": radius if radius is not None else 0, "geo": (g.get("geo_type") or "").strip()})
    out.sort(key=lambda s: s["terrakey"])
    return out


def distance_km(lat1, lon1, lat2, lon2, r):
    a = math.sin((lat2 - lat1) * RAD / 2) ** 2 + math.cos(lat1 * RAD) * math.cos(lat2 * RAD) * math.sin((lon2 - lon1) * RAD / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _ring(pts):
    return pts, (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))


_FIN = read_json(ROOT / "spec" / "tables", "finland")
BORDER = _FIN["border"]
_LAND = [_ring(p) for p in _FIN["land"]]
_OUTER = _ring([p[:2] for p in BORDER])


def _in_ring(ring, x, y):
    pts, (xmin, ymin, xmax, ymax) = ring
    if x < xmin or x > xmax or y < ymin or y > ymax:
        return False
    c = False
    px, py = pts[-1]
    for ix, iy in pts:
        if (iy > y) != (py > y) and x < (px - ix) * (y - iy) / (py - iy) + ix:
            c = not c
        px, py = ix, iy
    return c


def is_land(lon, lat):
    c = False
    for ring in _LAND:
        if _in_ring(ring, lon, lat):
            c = not c
    return c


def inside_finland(lon, lat):
    return _in_ring(_OUTER, lon, lat)


def nearest_border(lon, lat, r):
    best, bd = -1, math.inf
    for i, p in enumerate(BORDER):
        d = distance_km(lat, lon, p[1], p[0], r)
        if d < bd:
            best, bd = i, d
    return {"index": best, "km": 0 if inside_finland(lon, lat) else bd}


def candidates(lon, lat, n, spread_km, stride, r):
    distances = [distance_km(lat, lon, p[1], p[0], r) for p in BORDER]
    order = sorted(range(len(BORDER)), key=lambda i: (distances[i], i))
    pick = set(order[:n])
    dmin = distances[order[0]]
    pick.update(i for i in range(0, len(BORDER), stride) if distances[i] <= dmin + spread_km)
    for kind in ("land", "sea"):
        i = next((i for i in order if BORDER[i][2] == kind), None)
        if i is not None:
            pick.add(i)
    return [{"i": i, "d": distances[i]} for i in sorted(pick)]


def land_sea(lon1, lat1, lon2, lat2, km, samples):
    land = 0
    for k in range(samples):
        t = (k + 0.5) / samples
        if is_land(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t):
            land += 1
    return {"dland": km * land / samples, "dsea": km * (samples - land) / samples, "landShare": land / samples}


def finnish_stations():
    p = ROOT / "state" / "reference" / "stations.json"
    if not p.exists():
        return {"present": False, "sha256": None, "stations": []}
    raw = p.read_bytes()
    return {"present": True, "sha256": hashlib.sha256(raw).hexdigest(), "stations": json.loads(raw)["stations"]}
