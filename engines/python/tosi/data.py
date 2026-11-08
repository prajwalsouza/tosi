"""Stage 5: check whether every value needed to calculate a row is filed."""
from .space_common import (
    beam_gains, beam_key, beam_names, emitter, limits, num, open_db, orbits,
    read_json, require_space, rulebook, usable, write,
)


def run(folder):
    intake = require_space(folder, "Data")
    rules, stamp = rulebook("data")
    reach, lim = read_json(folder, "reach.json"), read_json(folder, "limit.json")
    emit = emitter("data")
    emit("start")
    read = open_db(folder, emit)
    want, ntcs = {r[0] for r in lim["rows"]}, {r[1] for r in lim["rows"]}
    beam = beam_names(read, want)
    gain = beam_gains(read, ntcs, rules["transmit"])
    pw = {}
    for r in read("emiss", ["grp_id", "pep_max", "pwr_ds_max"]):
        if r.get("grp_id") not in want:
            continue
        p = pw.setdefault(r["grp_id"], {"pep": False, "dens": False})
        if num(r.get("pep_max")) is not None:
            p["pep"] = True
        if num(r.get("pwr_ds_max")) is not None:
            p["dens"] = True
    orb = orbits(read)
    lon = {n["ntc_id"]: n["longitude"] for n in reach["notices"]}
    tables = limits()
    order = rules["reasons_order"]
    ok, per = [], {}
    by_reason = dict.fromkeys(order, 0)
    for r in lim["rows"]:
        grp, ntc, t, _, provn = r
        p = per.setdefault(ntc, {"ok": 0, "rows": 0, "reasons": set()})
        p["rows"] += 1
        pv = tables["provision"][t][provn]
        segs = tables["mask"][t].get(pv["mask_code"], [])
        e = pw.get(grp)
        perig = orb.get(ntc, {}).get("perig")
        where = lon.get(ntc) is not None if t == "G" else perig is not None and perig >= 0
        fails = {"no_orbit": not where, "no_gain": beam_key(ntc, beam.get(grp)) not in gain,
                 "no_power": e is None or (not (e["pep"] or e["dens"]) if pv["bw"] > 0 else not e["pep"]),
                 "needs_xy": not any(map(usable, segs))}
        why = next((k for k in order if fails[k]), None)
        if why:
            by_reason[why] += 1
            p["reasons"].add(why)
        else:
            p["ok"] += 1
            ok.append(r)
    how = dict.fromkeys(["complete", *order], 0)
    notices = []
    for n in lim["notices"]:
        if not n["limited"]:
            continue
        p = per[n["ntc_id"]]
        k = "complete" if p["ok"] else next(k for k in order if k in p["reasons"])
        how[k] += 1
        notices.append({"ntc_id": n["ntc_id"], "type": n["type"], "complete": k == "complete", "how": k, "rows": p["rows"], "rows_ok": p["ok"]})
    complete = how["complete"]
    result = {"schema": "data/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "complete": complete, "left": len(notices) - complete, "how": how,
                         "rows": len(lim["rows"]), "rows_ok": len(ok), "rows_missing": by_reason},
              "notices": notices, "rows": ok}
    emit("done", complete=complete, notices=len(notices), rows=len(ok))
    return write(folder, "data.json", result)
