#!/usr/bin/env python3
"""Turn the published sources into the reference tables the engines read. Run once per source update.

    python3 dev/tools/tables.py --pfd PFD.mdb --p1546 P1546FieldStrMixed.m --geo countries.geojson --m4 fa_en.json [--stations stations.xlsx]

Writes, each with its source file's SHA-256:
  spec/tables/pfd.json        ITU BR PFD limit tables (RR Article 21 and related), used by Limit and Compare
  spec/tables/p1546.json      ITU-R P.1546-6 tabulated field strengths (24 curves), used by Field strength
  spec/tables/finland.json    Finland's test points, border and sea-limit points, and land outlines nearby
  spec/tables/m4.json         Finland's national frequency allocation table (Traficom Radio Frequency Regulation 4), used by the ladders
  ui/public/region.json       outlines of Finland's neighbours for the terrestrial map (display only)
  state/reference/stations.json   Traficom's station list, cleaned (this computer only, never committed)

Needs shapely and openpyxl (the preparation tool only; no engine uses them).
"""
import argparse, hashlib, json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KM_DEG = 111.32
SEA_KM = 22.224            # 12 nautical miles of territorial sea
LAT0 = 64.0                # local projection centre for buffering


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p, obj):
    p = ROOT / p; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"{p.relative_to(ROOT)}  {p.stat().st_size:,} bytes")


def pfd(path):
    import logging; logging.disable(logging.CRITICAL)
    from access_parser import AccessParser
    db = AccessParser(str(path))
    def rows(t):
        d = db.parse_table(t); cols = list(d)
        out = []
        for i in range(len(d[cols[0]])):
            r = {}
            for c in cols:
                v = d[c][i]
                if isinstance(v, float): v = round(v, 6)
                r[c.lower()] = v.strip() if isinstance(v, str) else v
            out.append(r)
        return out
    names = ["FREQ_EXAM", "NGSO_FREQ_EXAM", "PROVISIONS", "NGSO_PROVISIONS", "PFD_MASK", "NGSO_PFD_MASK", "PROT_AREA", "CLASSES_OF_STN", "VERSION"]
    t = {n.lower(): rows(n) for n in names}
    write("spec/tables/pfd.json", {
        "about": "The ITU's tables of power-flux-density limits for space stations (Radio Regulations Article 21, Appendix 5 and related Resolutions), as published by the Radiocommunication Bureau in its PFD examination software. Frequencies in MHz; dates as YYYYMMDD; limits in dB(W/m²) in the reference bandwidth BW (MHz, 0 = total power).",
        "source": {"file": Path(path).name, "sha256": sha(path), "publisher": "ITU Radiocommunication Bureau, BR PFD Technical Annexes"},
        **t})


def p1546(path):
    text = Path(path).read_text(encoding="latin-1")
    m = re.search(r"exceltables\s*=\s*\.\.\.\s*\{(.*?)\};", text, re.S)
    if not m: sys.exit("exceltables not found")
    mats = re.findall(r"\[([^\[\]]*)\]", m.group(1))
    tables = []
    for mat in mats:
        rows = [[float(x) for x in r.split(",") if x.strip()] for r in mat.replace("\n", "").split(";") if r.strip()]
        tables.append({"h1": rows[0][1:9], "rows": [{"d": r[0], "e": r[1:9], "emax": r[9]} for r in rows[1:]]})
    f = re.search(r"figure_rec\s*=\s*\[(.*?)\];", text, re.S).group(1)
    figs = [[float(x) for x in r.split(",") if x.strip()] for r in f.replace("\n", "").split(";") if r.strip()]
    if len(tables) != 24 or len(figs) != 24: sys.exit(f"expected 24 curves, found {len(tables)} tables and {len(figs)} figures")
    PATH = {1: "land", 2: "sea", 3: "cold_sea", 4: "warm_sea"}
    curves = [{"figure": int(fg[3]), "time": fg[0], "path": PATH[int(fg[1])], "f_mhz": fg[2], **tables[int(fg[3]) - 1]} for fg in figs]
    write("spec/tables/p1546.json", {
        "about": "ITU-R P.1546-6 field-strength curves: dB(µV/m) for 1 kW e.r.p., by distance (km) and transmitting antenna height h1 (m), for nominal frequencies 100, 600 and 2000 MHz, time percentages 50, 10 and 1, and land, sea, cold-sea and warm-sea paths. emax is the maximum field strength at that distance.",
        "source": {"file": Path(path).name, "sha256": sha(path), "publisher": "ITU-R Working Party 3K, reference implementation of Recommendation ITU-R P.1546-6, version 6.2"},
        "curves": curves})


def geography(path):
    from shapely.geometry import shape, Point, box, mapping
    from shapely.ops import unary_union, transform
    from shapely.prepared import prep
    feats = json.loads(Path(path).read_text())["features"]
    fin = unary_union([shape(f["geometry"]) for f in feats if f["properties"]["ADMIN"] in ("Finland", "Aland")])
    region = box(0, 50, 50, 75)
    others = unary_union([shape(f["geometry"]).buffer(0) for f in feats if f["properties"]["ADMIN"] not in ("Finland", "Aland") and shape(f["geometry"]).intersects(region)])
    k = math.cos(math.radians(LAT0))
    fwd = lambda x, y, z=None: ((x - 25) * KM_DEG * k, (y - LAT0) * KM_DEG)
    inv = lambda x, y, z=None: (x / (KM_DEG * k) + 25, y / KM_DEG + LAT0)
    # Finland with its territorial sea: 12 nautical miles out from the coast, never onto another country's land.
    # Where another country's coast is closer than that, the band stops 12 nautical miles from it: a simple stand-in for
    # the median line, so Finland's limit never reaches into a neighbour's waters (such as Vyborg Bay).
    others_km = transform(fwd, others)
    sea = transform(inv, transform(fwd, fin).buffer(SEA_KM, 16).difference(others_km.buffer(SEA_KM, 16)))
    outer = unary_union([fin, sea])
    outer = max(getattr(outer, "geoms", [outer]), key=lambda g: g.area)
    near_land = prep(others.buffer(0.05))
    ring = outer.exterior
    n = max(1, int(ring.length / 0.09))          # about every 10 km
    border = []
    for i in range(n):
        x, y = ring.interpolate(i / n, normalized=True).coords[0]
        border.append([round(x, 3), round(y, 3), "land" if near_land.contains(Point(x, y)) else "sea"])
    tf = prep(fin); b = fin.bounds
    pts = [[round(x, 2), round(y, 2)] for x in [b[0] + 0.5 * i for i in range(int((b[2] - b[0]) / 0.5) + 1)]
           for y in [b[1] + 0.5 * j for j in range(int((b[3] - b[1]) / 0.5) + 1)] if tf.contains(Point(x, y))]
    pts += [[p[0], p[1]] for p in border[::5]]
    land = unary_union([fin, others]).intersection(box(5, 50, 50, 75)).simplify(0.02)
    rings = []
    for g in getattr(land, "geoms", [land]):
        if g.area < 0.01: continue
        rings.append([[round(x, 3), round(y, 3)] for x, y in g.exterior.coords])
        rings += [[[round(x, 3), round(y, 3)] for x, y in h.coords] for h in g.interiors if len(h.coords) > 3]
    write("spec/tables/finland.json", {
        "about": "Finland for the rules. test_points: where a satellite's power is checked (a 0.5° grid inside Finland plus points on its outer limit). border: Finland's outer limit, land border and the 12-nautical-mile territorial sea, about every 10 km, each marked land or sea. land: outlines of all land nearby, to tell land paths from sea paths. Longitude, latitude in degrees.",
        "source": {"file": Path(path).name, "sha256": sha(path), "publisher": "Natural Earth 1:50m admin 0 countries (public domain); territorial sea drawn 12 nautical miles from the coast"},
        "test_points": pts, "border": border, "land": rings})
    # Neighbours for the terrestrial map, display only.
    show = ["Finland", "Aland", "Sweden", "Norway", "Russia", "Estonia", "Latvia", "Lithuania", "Belarus", "Poland", "Denmark", "Germany", "Ukraine", "Netherlands", "Czechia", "Kazakhstan"]
    view = box(-2, 46, 56, 76)          # wider than any map view, so outlines fade out instead of ending at a cut
    out = []
    for f in feats:
        if f["properties"]["ADMIN"] not in show: continue
        g = shape(f["geometry"]).intersection(view).simplify(0.05)
        for p in getattr(g, "geoms", [g]):
            if p.is_empty or p.area < 0.02: continue
            out.append({"name": f["properties"]["ADMIN"], "ring": [[round(x, 2), round(y, 2)] for x, y in p.exterior.coords]})
    write("ui/public/region.json", {"about": "Outlines of Finland and its neighbours for the terrestrial map in the Flow. Display only: no rule reads this file.",
                                     "source": "Natural Earth 1:50m admin 0 countries (public domain), simplified to 0.05°", "shapes": out,
                                     "sea_limit": [[p[0], p[1]] for p in border]})


UNIT = {"hz": 1e-6, "khz": 1e-3, "mhz": 1.0, "ghz": 1e3}
BW = {"H": 1e-6, "k": 1e-3, "K": 1e-3, "M": 1.0, "G": 1e3}
def freq(s):
    m = re.fullmatch(r"\s*([\d.,]+)\s*([kKMG]?[Hh][zZ])\s*", s) if isinstance(s, str) else None
    return float(m[1].replace(",", ".")) * UNIT[m[2].lower()] if m else None
def width(s):
    m = re.fullmatch(r"([\d.]+)([HkKMG])(\d*)", s.strip().replace(",", ".")) if isinstance(s, str) else None
    return float(m[1] + ("." + m[3] if m[3] else "")) * BW[m[2]] if m else None
def num(s):
    try: return float(str(s).replace(",", "."))
    except (TypeError, ValueError): return None


def stations(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    rows = [[("" if c is None else str(c)).strip() for c in r] for r in ws.iter_rows(values_only=True)]
    h = next(i for i, r in enumerate(rows[:40]) if "Station number" in r)
    head = rows[h]; col = {c: head.index(c) for c in head if c}
    seen, out = set(), []
    for r in rows[h + 1:]:
        g = lambda c: r[col[c]] if c in col and col[c] < len(r) else ""
        sid = g("Station number")
        if not re.fullmatch(r"\d+", sid): continue
        key = tuple(r)
        if key in seen: continue
        seen.add(key)
        ch, tx = freq(g("Channel bandwidth")), width(g("Transmission bandwidth"))
        bws = [x for x in (ch, tx) if x is not None]
        out.append({"station": sid, "class": g("Class of licence") or "MUUT", "lon": num(g("Longitude")), "lat": num(g("Latitude")),
                    "tx_mhz": freq(g("TX frequency")), "rx_mhz": freq(g("RX frequency")), "bw_mhz": min(bws) if bws else None,
                    "gain_dbi": num(g("Ant gain (dB)")), "azimuth": num(g("Radiation direction (°)")), "directional": g("Directivity") == "D"})
    out.sort(key=lambda s: (int(s["station"]), s["tx_mhz"] or 0, s["rx_mhz"] or 0))
    write("state/reference/stations.json", {
        "about": "Finnish stations to protect, from Traficom's list, cleaned: a blank licence class is MUUT, and the smaller of channel and transmission width is used (guidebook D-1, D-2). This computer only; never committed.",
        "source": {"file": Path(path).name, "sha256": sha(path)}, "stations": out})


EXEMPT = re.compile(r"exempt", re.I)
def m4(path):
    """Traficom's frequency allocation table (open data, Taajuusjakotaulukko, in English): the annex to Radio Frequency
    Regulation 4. One row per sub-band and Finnish use. A use is licence-exempt when the table's own note says it is exempt
    from licensing, or it is a short range device (SRD), which the table's notes refer to Traficom Regulation 15 for."""
    rows = json.loads(Path(path).read_text(encoding="utf-8"))["value"]
    out = set()
    for r in rows:
        lo, hi = r["Sub_band_lower_limit__Hz_"], r["Sub_band_upper_limit__Hz_"]
        if lo is None or hi is None: continue
        use = (r["Sub_band_usage"] or r["Services_in_Finland"] or "").strip()
        if not use: continue
        exempt = bool(EXEMPT.search(r["Comment"] or "")) or use.startswith("(SRD)")
        out.add((lo / 1e6, hi / 1e6, use, exempt))
    out = sorted(out, key=lambda t: (t[0], t[1], t[2], t[3]))
    write("spec/tables/m4.json", {
        "about": "Finland's national frequency allocation table, the annex to Traficom's Radio Frequency Regulation 4 (M4): each sub-band in MHz with a use in Finland, and whether that use is licence-exempt (the table's own note says exempt from licensing, or it is a short range device, SRD, under Traficom Regulation 15). Identical rows are merged; rows are in frequency order.",
        "source": {"file": Path(path).name, "sha256": sha(path), "publisher": "Traficom open data, Taajuusjakotaulukko (frequency allocation table, English), API v13"},
        "fields": ["lo_mhz", "hi_mhz", "use", "exempt"], "rows": [list(t) for t in out]})


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--pfd"); a.add_argument("--p1546"); a.add_argument("--geo"); a.add_argument("--stations"); a.add_argument("--m4")
    x = a.parse_args()
    if x.pfd: pfd(x.pfd)
    if x.p1546: p1546(x.p1546)
    if x.geo: geography(x.geo)
    if x.stations: stations(x.stations)
    if x.m4: m4(x.m4)
