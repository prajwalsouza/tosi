"""Strongest border field strength. See spec/stages/field/README.md."""
from .p1546 import P1546_SHA, field_strength
from .terra_common import (BORDER, candidates, distance_km, emit, inside_finland, land_sea, need_terrestrial,
                           open_db, read_json, round2, rulebook, stations, table_sha, write_result)


def run(folder):
    intake = need_terrestrial(folder)
    prev = read_json(folder, "tdata")
    rules, stamp = rulebook("field")
    emit("field", "start")
    by = {s["terrakey"]: s for s in stations(open_db(folder), "field")}
    r = rules["earth_radius_km"]
    notices = []
    for n in prev["notices"]:
        if not n["kept"]:
            continue
        s = by[n["terrakey"]]
        inside = inside_finland(s["lon"], s["lat"])
        best = None
        for c in candidates(s["lon"], s["lat"], rules["nearest_points"], rules["spread_km"], rules["stride"], r):
            p = BORDER[c["i"]]
            km = max(rules["min_km"], 0 if inside else max(0, distance_km(s["lat"], s["lon"], p[1], p[0], r)
                                                         - (s["radius"] if s["radius"] > 0 else 0)))
            path = land_sea(s["lon"], s["lat"], p[0], p[1], km, rules["samples"])
            e = field_strength(f=s["f"], t=rules["time_percent"], h1=n["heff_m"], h2=rules["receiver_height_m"],
                               dland=path["dland"], dsea=path["dsea"], erp_dbw=n["erp_dbw"])["e"]
            if best is None or e > best["e"]:
                best = {"e": e, "border": c["i"], "km": km, "land": path["landShare"]}
        notices.append({"terrakey": n["terrakey"], "e": round2(best["e"]), "border": best["border"],
                        "km": round2(best["km"]), "land": round2(best["land"])})
    result = {"schema": "field/1", "rulebook": stamp, "tables": {"p1546": P1546_SHA, "finland": table_sha("finland")},
              "file": intake["file"]["sha256"], "counts": {"notices": len(notices)}, "notices": notices}
    emit("field", "done", notices=len(notices))
    return write_result(folder, "field", result)
