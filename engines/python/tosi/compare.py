"""Stage 7: compare arriving power with the limit over Finland's geometry."""
import math

from .space_common import (
    RAD, emitter, frequency_spans, gso_from, limits, mask_at, open_db, orbits,
    read_json, require_space, round2, rulebook, table, write,
)


def spreading(distance_km):
    area = 4 * math.pi * (distance_km * 1000) ** 2
    return 10 * math.log10(area) if area > 0 else -math.inf


def run(folder):
    intake = require_space(folder, "Compare")
    rules, stamp = rulebook("compare")
    reach, power = read_json(folder, "reach.json"), read_json(folder, "power.json")
    emit = emitter("compare")
    emit("start")
    read = open_db(folder, emit)
    span = frequency_spans(read, {r[0] for r in power["rows"]})
    orb = orbits(read)
    lon = {n["ntc_id"]: n["longitude"] for n in reach["notices"] if n["longitude"] is not None}
    lim = limits()
    re, rg = rules["earth_radius_km"], rules["geostationary_radius_km"]
    fin = table("finland")
    points = [(p[0], p[1]) for p in [*fin["test_points"], *fin["border"]]]
    geo, worst = {}, {}

    def geometry(t, ntc):
        key = (t, lon[ntc] if t == "G" else orb[ntc]["perig"])
        if key in geo:
            return key, geo[key]
        if t == "G":
            all_points = [gso_from(x, y, lon[ntc], re, rg) for x, y in points]
            g = [(q["el"], q["d"]) for q in all_points if q["el"] >= 0]
            if not g:
                top = max(all_points, key=lambda q: q["el"])
                g = [(0, top["d"])]
        else:
            h = orb[ntc]["perig"]
            g = []
            i = 0
            while i * rules["ngso_angle_step_deg"] <= 90 + 1e-9:
                a = i * rules["ngso_angle_step_deg"]
                s = math.sin(a * RAD)
                d = -re * s + math.sqrt((re * s) ** 2 + 2 * re * h + h * h)
                g.append((a, d))
                i += 1
        geo[key] = g
        return key, g

    def margin(t, mask, gk, g):
        key = (t, mask, gk)
        if key in worst:
            return worst[key]
        segs = lim["mask"][t].get(mask, [])
        best = None
        for a, d in g:
            limit = mask_at(segs, a)
            if limit is None:
                continue
            m = limit + spreading(d)
            if best is None or m < best["m"]:
                best = {"m": m, "lim": limit, "a": a, "d": d}
        worst[key] = best
        return best

    near = -rules["near_db"]
    keep, per = [], {}
    nogeo = 0
    for r in power["rows"]:
        grp, ntc, t, ixf, provn, eirp = r
        pv = lim["provision"][t][provn]
        key, g = geometry(t, ntc)
        w = margin(t, pv["mask_code"], key, g)
        if w is None:
            nogeo += 1
            continue
        excess = eirp - w["m"]
        cur = per.get(ntc)
        # The upstream rows already have the specified tie order. Keep the first.
        if cur is None or excess > cur["x"]:
            per[ntc] = {"x": excess, "grp": grp, "t": t, "ixf": ixf, "provn": provn,
                        "pfd": eirp - spreading(w["d"]), "lim": w["lim"], "a": w["a"], "d": w["d"]}
        if excess > near:
            x = next(e for e in lim["exam"][t] if e["ix_freq"] == ixf)
            s = span[grp]
            keep.append([grp, ntc, t, ixf, provn, round2(excess), max(s[0], x["freq_min"]), min(s[1], x["freq_max"])])
    how = dict.fromkeys(rules["outcomes"], 0)
    notices = []
    for n in power["notices"]:
        w = per.get(n["ntc_id"])
        if w is None:
            how["no_result"] += 1
            notices.append({"ntc_id": n["ntc_id"], "type": n["type"], "outcome": "no_result", "excess": None,
                            "pfd": None, "limit": None, "angle": None, "distance_km": None, "grp_id": None,
                            "table": None, "provision": None, "provn": None, "finding": None})
            continue
        outcome = "over" if w["x"] > 0 else "near" if w["x"] > near else "under"
        pv = lim["provision"][w["t"]][w["provn"]]
        how[outcome] += 1
        notices.append({"ntc_id": n["ntc_id"], "type": n["type"], "outcome": outcome, "excess": round2(w["x"]),
                        "pfd": round2(w["pfd"]), "limit": round2(w["lim"]), "angle": round2(w["a"]), "distance_km": round2(w["d"]),
                        "grp_id": w["grp"], "table": w["t"], "provision": w["provn"],
                        "provn": str(pv.get("provn") or "").strip(), "finding": str(pv.get("fndg") or "").strip()})
    result = {"schema": "compare/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "how": how, "rows": len(power["rows"]), "rows_kept": len(keep), "rows_without_angle": nogeo},
              "notices": notices, "rows": keep}
    emit("done", notices=len(notices), **how)
    return write(folder, "compare.json", result)
