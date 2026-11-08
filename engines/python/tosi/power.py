"""Stage 6: the largest e.i.r.p. in each limit's reference bandwidth."""
import math

from .space_common import (
    bandwidth_hz, beam_gains, beam_key, beam_names, emitter, frequency_spans,
    limits, num, open_db, power_in, read_json, require_space, round2, rulebook, write,
)


def run(folder):
    intake = require_space(folder, "Power")
    rules, stamp = rulebook("power")
    dat = read_json(folder, "data.json")
    emit = emitter("power")
    emit("start")
    read = open_db(folder, emit)
    want, ntcs = {r[0] for r in dat["rows"]}, {r[1] for r in dat["rows"]}
    grp = beam_names(read, want)
    gain = beam_gains(read, ntcs, rules["transmit"])
    span = frequency_spans(read, want)
    emis = {}
    for r in read("emiss", ["grp_id", "design_emi", "pep_max", "pwr_ds_max"]):
        if r.get("grp_id") in want:
            emis.setdefault(r["grp_id"], []).append((num(r.get("pep_max")), num(r.get("pwr_ds_max")), bandwidth_hz(r.get("design_emi"))))
    lim = limits()
    rows, per = [], {}
    skipped = 0
    for r in dat["rows"]:
        g, ntc, t, _, provn = r
        pv, s = lim["provision"][t][provn], span[g]
        f, bref = (s[0] + s[1]) / 2, pv["bw"] * rules["mhz_to_hz"]
        best = None
        for pep, dens, b in emis.get(g, []):
            p = power_in(pep, dens, b, f, bref, rules)
            if p is not None and (best is None or p > best):
                best = p
        if best is None:
            skipped += 1
            continue
        eirp = best + gain[beam_key(ntc, grp.get(g))]
        rows.append([*r, round2(eirp)])
        n = per.setdefault(ntc, {"eirp": -math.inf, "rows": 0})
        n["rows"] += 1
        n["eirp"] = max(n["eirp"], eirp)
    notices = []
    for n in dat["notices"]:
        if not n["complete"]:
            continue
        p = per.get(n["ntc_id"])
        notices.append({"ntc_id": n["ntc_id"], "type": n["type"], "rows": p["rows"] if p else 0, "eirp": round2(p["eirp"]) if p else None})
    result = {"schema": "power/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "rows": len(rows), "rows_without_power": skipped}, "notices": notices, "rows": rows}
    emit("done", notices=len(notices), rows=len(rows))
    return write(folder, "power.json", result)
