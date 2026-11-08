"""Terrestrial stage 8: the notification and byte-stable CSV and Markdown."""
import hashlib
import json
from pathlib import Path

from .terra_common import (
    BORDER, ROOT, compact_json, emit, need_terrestrial, open_db, read_json,
    rulebook, write_result,
)


def _n2s(value):
    return "" if value is None else compact_json(value)


def _csv_cell(value):
    if value is None:
        text = ""
    elif isinstance(value, (int, float)):
        text = compact_json(value)
    else:
        text = str(value)
    return '"' + text.replace('"', '""') + '"' if any(c in text for c in '\",\n\r') else text


def _yes_no(value):
    return "" if value is None else "yes" if value else "no"



def _use_text(u, n):
    """Finnish use in a sentence: the first few uses the frequency table (M4) lists, then the licence-exempt ones."""
    if not u:
        return ""
    if not u["uses"]:
        return " Finland's frequency table (M4) lists no use on these frequencies."
    few = lambda l: ", ".join(l[:n]) + (", …" if len(l) > n else "")
    exempt = f"; licence-exempt: {few(u['exempt'])}" if u["exempt"] else ""
    return f" Finland's frequency table (M4) lists {few(u['uses'])}{exempt}."


def _use_cells(u):
    return ["; ".join(u["uses"]), "; ".join(u["exempt"])] if u else [None, None]


def run(folder):
    intake = need_terrestrial(folder)
    rules, stamp = rulebook("treport")
    lad_bytes = (ROOT / "spec" / "rulebook" / "tladder.json").read_bytes()
    lad = json.loads(lad_bytes)
    adm = read_json(ROOT / "spec" / "reference", "administrations")["administrations"]
    mob, rng, tda, fld, thr, tst, ladder = (
        read_json(folder, name) for name in ("mobile", "range", "tdata", "field", "threshold", "tstations", "tladder")
    )
    emit("treport", "start")
    read = open_db(folder)
    geo = {g.get("geo_key"): g for g in read("treport", "fxm_geo", ["geo_key", "site_name", "ctry"])}
    site = {}
    for r in read("treport", "fxm_terra", ["terrakey", "geo_key"]):
        g = geo.get(r.get("geo_key"))
        if g is not None:
            site[r.get("terrakey")] = g
    coord = {}
    for c in read("treport", "fxm_coord", ["terrakey", "adm", "coord_prov", "coord_st"]):
        if (c.get("adm") or "").strip() != rules["administration"]:
            continue
        prov, status = c.get("coord_prov"), c.get("coord_st")
        record = f"{str(prov if prov is not None else '').strip()}:{str(status if status is not None else '').strip()}"
        coord.setdefault(c.get("terrakey"), set()).add(record)

    def rows(stage):
        fields = stage["fields"]
        key = fields.index("terrakey")
        return {r[key]: dict(zip(fields, r)) for r in stage["notices"]}

    mobile_by, range_by, ladder_by = (rows(stage) for stage in (mob, rng, ladder))
    data_by, field_by, threshold_by, station_by = (
        {n["terrakey"]: n for n in stage["notices"]} for stage in (tda, fld, thr, tst)
    )
    rung = {r["key"]: r for r in lad["rungs"]}

    def describe(key):
        m, g = mobile_by[key], site.get(key, {})
        a = (m.get("adm") or "").strip()
        return {"administration": a, "country": adm.get(a, a),
                "site": str(g["site_name"]).strip() if g.get("site_name") else None,
                "site_country": str(g["ctry"]).strip() if g.get("ctry") else None,
                "class": m["cls"], "f_mhz": m["f_mhz"], "lon": m["lon"], "lat": m["lat"]}

    items = []
    for key, p in ladder_by.items():
        rg = rung[p["rung"]]
        if rg["level"] not in rules["levels_reported"]:
            continue
        d, r, f = describe(key), range_by.get(key, {}), field_by.get(key)
        t, s, dt = threshold_by.get(key, {}), station_by.get(key, {}), data_by.get(key)
        b = BORDER[f["border"]] if f is not None else None
        over = s.get("over") or []
        items.append({
            "terrakey": key, **d, "distance_km": r.get("km"),
            "field": {"e": f["e"], "limit": t.get("limit"), "excess": t.get("excess"), "bandwidth_correction": t.get("bc"),
                      "at": {"lon": b[0], "lat": b[1], "kind": b[2]} if b is not None else None, "km": f["km"], "land": f["land"]} if f is not None else None,
            "power": {"erp_dbw": dt["erp_dbw"], "heff_m": dt["heff_m"], "heff_from": dt["heff_from"], "assumptions": dt["assumptions"]} if dt is not None else None,
            "coordination": {"completed": bool(t.get("coordinated")), "records": sorted(coord.get(key, []))},
            "stations": {"over": len(over), "first": over[:rules["stations_listed"]], "worst": s.get("worst")},
            "finnish_use": p.get("m4"),
            "why": {"rung": p["rung"], "level": rg["level"], "wording": rg["rung"], "means": rg["means"], "cites": rg["cites"]},
            "next": rules["next"].get(p["rung"]),
        })

    head = ["Station (terrakey)", "Administration", "Country", "Site", "Class", "Frequency (MHz)", "Longitude", "Latitude", "In scope",
            "Distance to Finland (km)", "e.r.p. (dBW)", "Effective height (m)", "Field strength at the border (dBuV/m)", "Trigger level (dBuV/m)",
            "Over the trigger by (dB)", "Coordinated with Finland", "Listed stations over the trigger", "Finnish use (M4)", "Licence-exempt use (M4)", "Concern", "Level", "Decided by"]
    lines = [",".join(map(_csv_cell, head))]
    for key in sorted(mobile_by):
        d, m, r, dt = describe(key), mobile_by[key], range_by.get(key, {}), data_by.get(key, {})
        f, t, s, p = field_by.get(key, {}), threshold_by.get(key, {}), station_by.get(key), ladder_by[key]
        rg = rung[p["rung"]]
        row = [key, d["administration"], d["country"], d["site"], d["class"], d["f_mhz"], d["lon"], d["lat"],
               "yes" if m["reason"] is None else f"no: {m['reason']}", r.get("km"), dt.get("erp_dbw"), dt.get("heff_m"),
               f.get("e"), t.get("limit"), t.get("excess"), _yes_no(t.get("coordinated")),
               len(s.get("over") or []) if s is not None else None, *_use_cells(p.get("m4")), rg["rung"], rg["level"], p["by"]]
        lines.append(",".join(map(_csv_cell, row)))
    csv = "\n".join(lines) + "\n"

    crit = [x for x in items if x["why"]["level"] == "crit"]
    warn = [x for x in items if x["why"]["level"] == "warn"]
    md = [f"# Terrestrial notification: {intake['file']['name']}", "",
          f"{ladder['counts']['notices']} stations screened. {len(crit)} need attention, {len(warn)} are worth a look.", "",
          "| Concern | Level | Stations |", "|---|---|---|"]
    md.extend(f"| {r['rung']} | {r['level']} | {ladder['counts']['rungs'].get(r['key'], 0)} |" for r in lad["rungs"])
    md.append("")

    def notification_line(x, i):
        name = x["site"] if x["site"] is not None else f"Station {x['terrakey']}"
        head = f"{i + 1}. **{name}** ({x['terrakey']}), {x['country']}, class {x['class']}, {_n2s(x['f_mhz'])} MHz, {_n2s(x['distance_km'])} km from Finland."
        f, s = x["field"], x["stations"]
        if f is not None:
            where = "territorial-sea limit" if (f["at"] or {}).get("kind") == "sea" else "border"
            # JS treats a null margin as zero in comparison and Math.abs.
            excess = f["excess"] if f["excess"] is not None else 0
            margin = f"{_n2s(f['excess'])} dB over" if excess > 0 else f"{_n2s(abs(excess))} dB under"
            amount = f"{_n2s(f['e'])} dB(µV/m) at the {where} against a trigger of {_n2s(f['limit'])}, {margin}"
        else:
            amount = "no field strength"
        stations = ""
        if s["over"]:
            suffix = "" if s["over"] == 1 else "s"
            stations = f"; over the trigger at {s['over']} listed station{suffix} ({', '.join(s['first'])})"
        coordination = "; coordination with Finland completed" if x["coordination"]["completed"] else ""
        return [head, f"   {x['why']['wording']}: {amount}{stations}{coordination}.{_use_text(x['finnish_use'], rules['uses_listed'])}",
                f"   Next: {x['next'] if x['next'] is not None else 'null'}"]

    for title, group in (("Needs attention", crit), ("Worth a look", warn)):
        if group:
            md.extend([f"## {title}", ""])
            for i, x in enumerate(group):
                md.extend(notification_line(x, i))
            md.append("")
    text = "\n".join(md)

    (Path(folder) / "report.csv").write_bytes(csv.encode("utf-8"))
    (Path(folder) / "report.md").write_bytes(text.encode("utf-8"))
    result = {"schema": "treport/1", "rulebook": stamp, "uses": {"tladder": hashlib.sha256(lad_bytes).hexdigest()},
              "file": intake["file"]["sha256"], "name": intake["file"]["name"],
              "counts": {"notices": ladder["counts"]["notices"], "items": len(items), "crit": len(crit), "warn": len(warn), "rungs": ladder["counts"]["rungs"]},
              "files": {"csv": {"name": "report.csv", "rows": len(lines) - 1, "sha256": hashlib.sha256(csv.encode("utf-8")).hexdigest()},
                        "md": {"name": "report.md", "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}}, "items": items}
    emit("treport", "done", items=len(items), crit=len(crit), warn=len(warn))
    return write_result(folder, "treport", result)
