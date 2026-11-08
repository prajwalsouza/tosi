"""Stage 10: the space notification and byte-stable CSV and Markdown exports."""
import hashlib
import json
import re
from pathlib import Path

from .space_common import (
    ROOT, compact_json, emitter, num, open_db, read_json, require_space, round2,
    rulebook, write,
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


def _fill(text, values):
    return re.sub(r"\{(\w+)\}", lambda m: str(values.get(m[1]) if values.get(m[1]) is not None else ""), text)



def _band(e):
    return f"{_n2s(e['lo_mhz'])}–{_n2s(e['hi_mhz'])} MHz"


def _margin(x):
    return f"{_n2s(x)} dB over" if x > 0 else f"{_n2s(round2(-x))} dB under"


def _band_use(u, n, at):
    """The Finnish use on one band: every number beside a margin is about that band."""
    if not u:
        return ""
    if not u["uses"]:
        return f" At {at}, Finland's frequency table (M4) lists no use."
    few = lambda l: ", ".join(l[:n]) + (", …" if len(l) > n else "")
    exempt = f"; licence-exempt: {few(u['exempt'])}" if u["exempt"] else ""
    return f" At {at}, Finland's frequency table (M4) lists {few(u['uses'])}{exempt}."


def _use_cells(u):
    return ["; ".join(u["uses"]), "; ".join(u["exempt"])] if u else [None, None]


def run(folder):
    intake = require_space(folder, "Report")
    rules, stamp = rulebook("report")
    lad_bytes = (ROOT / "spec" / "rulebook" / "ladder.json").read_bytes()
    lad = json.loads(lad_bytes)
    adm = read_json(ROOT / "spec" / "reference", "administrations.json")["administrations"]
    down, reach, lim, data, power, cmp, sta, ladder = (
        read_json(folder, f"{name}.json")
        for name in ("downlink", "reach", "limit", "data", "power", "compare", "stations", "ladder")
    )
    emit = emitter("report")
    emit("start")
    read = open_db(folder, emit)
    notice = {r.get("ntc_id"): r for r in read("notice", ["ntc_id", "adm"])}
    names = {}
    for r in read("geo", ["ntc_id", "sat_name"]):
        if r.get("sat_name"):
            names[r.get("ntc_id")] = str(r["sat_name"]).strip()
    for r in read("non_geo", ["ntc_id", "sat_name"]):
        if r.get("sat_name") and r.get("ntc_id") not in names:
            names[r.get("ntc_id")] = str(r["sat_name"]).strip()
    orbit = {}
    for r in read("orbit", ["ntc_id", "inclin_ang", "apog_km"]):
        o = orbit.setdefault(r.get("ntc_id"), {"tilt": None, "apogee": None})
        for key, column in (("tilt", "inclin_ang"), ("apogee", "apog_km")):
            value = num(r.get(column))
            if value is not None:
                o[key] = value if o[key] is None else max(o[key], value)

    down_by, reach_by, limit_by, data_by, power_by, compare_by, station_by, ladder_by = (
        {n["ntc_id"]: n for n in stage["notices"]}
        for stage in (down, reach, lim, data, power, cmp, sta, ladder)
    )
    rung = {r["key"]: r for r in lad["rungs"]}
    words = rules["words"]

    def describe(ntc):
        n, r, o, dn = notice.get(ntc, {}), reach_by.get(ntc, {}), orbit.get(ntc, {}), down_by.get(ntc, {})
        a = (n.get("adm") or "").strip()
        kind = {"G": "fixed", "N": "moving"}.get(dn.get("type"), dn.get("type") or "")
        if r.get("how") == "beyond_earth":
            body = r.get("body")
            where = _fill(words["beyond"], {"body": rules["bodies"].get(body, body)})
        elif dn.get("type") == "G":
            longitude = r.get("longitude")
            where = (_fill(words["fixed"], {"longitude": f"{_n2s(abs(longitude))}° {'W' if longitude < 0 else 'E'}"})
                     if longitude is not None else words["moving_unknown"].replace("Moving", "Fixed", 1))
        elif o.get("tilt") is not None and o.get("apogee") is not None:
            where = _fill(words["moving"], {"tilt": _n2s(round2(o["tilt"])), "apogee": _n2s(round2(o["apogee"]))})
        else:
            where = words["moving_unknown"]
        return {"name": names.get(ntc), "administration": a, "country": adm.get(a, a), "kind": kind, "where": where}

    items = []
    for p in ladder["notices"]:
        rg = rung[p["rung"]]
        if rg["level"] not in rules["levels_reported"]:
            continue
        ntc = p["ntc_id"]
        d, r, c, s = describe(ntc), reach_by.get(ntc, {}), compare_by.get(ntc, {}), station_by.get(ntc, {})
        ids = s.get("stations") or []
        items.append({
            "ntc_id": ntc, **d,
            "seen": {"seen": bool(r.get("seen")), "how": r.get("how"), "elevation": r.get("elevation"), "north": r.get("north")},
            "stations": {"count": len(ids), "over": p["stations_over"], "near": p["stations_near"], "near_frequency": p["near_frequency"]},
            "evidence": {"excess": p["margin"]["excess"], "lo_mhz": p["margin"]["lo_mhz"], "hi_mhz": p["margin"]["hi_mhz"],
                         "count": len(p["margin"]["stations"]), "first": p["margin"]["stations"][:rules["stations_listed"]],
                         "finnish_use": p["margin"]["m4"]} if p.get("margin") else None,
            "why": {"rung": p["rung"], "level": rg["level"], "wording": rg["rung"], "means": rg["means"], "cites": rg["cites"], "itu": p["itu"]},
            "how_much": {"excess": c["excess"], "provision": c.get("provn"), "finding": c.get("finding"), "angle": c["angle"],
                         "distance_km": c["distance_km"], "pfd": c["pfd"], "limit": c["limit"],
                         "lo_mhz": (p.get("worst") or {}).get("lo_mhz"), "hi_mhz": (p.get("worst") or {}).get("hi_mhz"),
                         "finnish_use": (p.get("worst") or {}).get("m4")} if c.get("excess") is not None else None,
            "next": rules["next"].get(p["rung"]),
        })

    head = ["Filing (ntc_id)", "Satellite", "Administration", "Country", "Kind", "Where", "Sends signals down", "Seen from Finland", "Has a limit",
            "Calculable", "Worst e.i.r.p. (dBW)", "Over the limit by (dB)", "Provision", "Arrival angle (deg)", "Distance (km)", "Outcome",
            "Worst band (MHz)", "Listed stations", "At a transmission over the limit", "Only at a transmission near the limit", "Near-frequency stations",
            "Finnish use in the worst band (M4)", "Licence-exempt use in the worst band (M4)", "ITU names Finland", "Concern", "Level", "Decided by"]
    lines = [",".join(map(_csv_cell, head))]
    for n in sorted(down["notices"], key=lambda n: n["ntc_id"]):
        ntc = n["ntc_id"]
        d, r, lm, dt = describe(ntc), reach_by.get(ntc, {}), limit_by.get(ntc, {}), data_by.get(ntc, {})
        pw, c, s, p = power_by.get(ntc, {}), compare_by.get(ntc, {}), station_by.get(ntc), ladder_by[ntc]
        rg = rung[p["rung"]]
        near = p["near_frequency"] or (0 if c.get("outcome") in ("over", "near") else None)
        row = [ntc, d["name"], d["administration"], d["country"], d["kind"], d["where"], _yes_no(n["kept"]),
               _yes_no(r.get("seen")), _yes_no(lm.get("limited")), _yes_no(dt.get("complete")), pw.get("eirp"), c.get("excess"),
               c.get("provn"), c.get("angle"), c.get("distance_km"), c.get("outcome"),
               f"{_n2s(p['worst']['lo_mhz'])}–{_n2s(p['worst']['hi_mhz'])}" if p.get("worst") else None,
               len(s["stations"]) if s is not None else None, len(s["over"]) if s is not None else None, len(s["near"]) if s is not None else None,
               near, *_use_cells((p.get("worst") or {}).get("m4")), " ".join(p["itu"]), rg["rung"], rg["level"], p["by"]]
        lines.append(",".join(map(_csv_cell, row)))
    csv = "\n".join(lines) + "\n"

    crit = [x for x in items if x["why"]["level"] == "crit"]
    warn = [x for x in items if x["why"]["level"] == "warn"]
    md = [f"# Space notification: {intake['file']['name']}", "",
          f"{ladder['counts']['notices']} filings screened. {len(crit)} need attention, {len(warn)} are worth a look.", "",
          "| Concern | Level | Filings |", "|---|---|---|"]
    md.extend(f"| {r['rung']} | {r['level']} | {ladder['counts']['rungs'].get(r['key'], 0)} |" for r in lad["rungs"])
    md.append("")

    def notification_line(x, i):
        name = x["name"] if x["name"] is not None else f"Filing {x['ntc_id']}"
        head = f"{i + 1}. **{name}** ({x['ntc_id']}), {x['country']}. {x['where']}. {words['seen'] if x['seen']['seen'] else words['clear']}."
        much = x["how_much"]
        if much is not None:
            margin = f"{_n2s(much['excess'])} dB over" if much["excess"] > 0 else f"{_n2s(round2(-much['excess']))} dB under"
            provision = f" ({much['provision']})" if much["provision"] else ""
            at = f", at {_band(much)}" if much["lo_mhz"] is not None else ""
            amount = f"{margin} the limit{provision} at {_n2s(much['angle'])}° above the horizon{at}"
        else:
            amount = "No calculated margin"
        s, ev = x["stations"], x["evidence"]
        # station evidence stays with its own transmission: said apart when it is not the worst one
        same = bool(much and ev and ev["lo_mhz"] == much["lo_mhz"] and ev["hi_mhz"] == much["hi_mhz"] and ev["excess"] == much["excess"])
        if ev:
            suffix = "" if ev["count"] == 1 else "s"
            more = ", …" if ev["count"] > len(ev["first"]) else ""
            on = f"on the frequencies of {ev['count']} listed station{suffix} ({', '.join(ev['first'])}{more})"
            if same:
                st = on
            else:
                none_over = "; no listed station is on a transmission over the limit" if much and much["excess"] > 0 and ev["excess"] <= 0 else ""
                st = f"{_margin(ev['excess'])} the limit at {_band(ev)}, {on}{none_over}"
        elif s["near_frequency"]:
            suffix = "" if s["near_frequency"] == 1 else "s"
            st = f"{s['near_frequency']} listed station{suffix} near its frequencies"
        else:
            st = "no listed station on its frequencies"
        itu = f" The ITU's records name Finland ({', '.join(x['why']['itu'])})." if x["why"]["itu"] else ""
        uses = (_band_use(much["finnish_use"], rules["uses_listed"], _band(much)) if much and much["lo_mhz"] is not None else "") + \
               (_band_use(ev["finnish_use"], rules["uses_listed"], _band(ev)) if ev and not same else "")
        return [head, f"   {x['why']['wording']}: {amount}; {st}.{itu}{uses}", f"   Next: {x['next'] if x['next'] is not None else 'null'}"]

    for title, group in (("Needs attention", crit), ("Worth a look", warn)):
        if group:
            md.extend([f"## {title}", ""])
            for i, x in enumerate(group):
                md.extend(notification_line(x, i))
            md.append("")
    text = "\n".join(md)

    (Path(folder) / "report.csv").write_bytes(csv.encode("utf-8"))
    (Path(folder) / "report.md").write_bytes(text.encode("utf-8"))
    result = {"schema": "report/1", "rulebook": stamp, "uses": {"ladder": hashlib.sha256(lad_bytes).hexdigest()},
              "file": intake["file"]["sha256"], "name": intake["file"]["name"],
              "counts": {"notices": ladder["counts"]["notices"], "items": len(items), "crit": len(crit), "warn": len(warn), "rungs": ladder["counts"]["rungs"]},
              "files": {"csv": {"name": "report.csv", "rows": len(lines) - 1, "sha256": hashlib.sha256(csv.encode("utf-8")).hexdigest()},
                        "md": {"name": "report.md", "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}}, "items": items}
    emit("done", items=len(items), crit=len(crit), warn=len(warn))
    return write(folder, "report.json", result)
