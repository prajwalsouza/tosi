"""Terrestrial stage 7: place every station on its first applicable rung."""
import math

from .m4 import finnish_use, m4_table
from .terra_common import emit, need_terrestrial, read_json, rulebook, write_result


def run(folder):
    intake = need_terrestrial(folder)
    rules, stamp = rulebook("tladder")
    mob, rng, tda, thr, tst = (
        read_json(folder, name) for name in ("mobile", "range", "tdata", "threshold", "tstations")
    )
    emit("tladder", "start")
    mk, mf, mr = (mob["fields"].index(k) for k in ("terrakey", "f_mhz", "reason"))
    freq_table = m4_table()
    rk, rr = (rng["fields"].index(k) for k in ("terrakey", "reason"))
    range_by = {r[rk]: r for r in rng["notices"]}
    data_by, threshold_by, station_by = (
        {n["terrakey"]: n for n in o["notices"]} for o in (tda, thr, tst)
    )
    order = {r["key"]: i for i, r in enumerate(rules["rungs"])}
    placed = []
    for m in sorted(mob["notices"], key=lambda r: r[mk]):
        key = m[mk]
        t, s = threshold_by.get(key, {}), station_by.get(key, {})
        rung, by = "clear", "threshold"
        if m[mr] is not None:
            rung, by = "out_of_scope", "mobile"
        # In the reference, an absent range row is undefined, which is !== null.
        elif key not in range_by or range_by[key][rr] is not None:
            rung, by = "clear", "range"
        elif not data_by.get(key, {}).get("kept"):
            rung, by = "cannot_calculate", "tdata"
        elif t.get("outcome") == "over":
            rung, by = "exceeds", "threshold"
        elif s.get("outcome") == "exposed" and t.get("outcome") != "over_coordinated":
            rung, by = "station_exposed", "tstations"
        elif t.get("outcome") == "near":
            rung, by = "near_threshold", "threshold"
        elif t.get("outcome") == "over_coordinated":
            rung, by = "exceeds_coordinated", "threshold"
        # Finnish use on its frequency, from the national frequency table (M4), for every station over or near the trigger
        m4 = (finnish_use(freq_table, [(m[mf], m[mf])])
              if t.get("outcome") in ("over", "over_coordinated", "near") and m[mf] is not None else None)
        placed.append([key, rung, by, t.get("excess"), len(s.get("over") or []), m4])

    placed.sort(key=lambda p: (order[p[1]], -p[3] if p[3] is not None else math.inf, p[0]))
    rungs = dict.fromkeys(order, 0)
    levels = {"crit": 0, "warn": 0, "none": 0}
    level = {r["key"]: r["level"] for r in rules["rungs"]}
    for p in placed:
        rungs[p[1]] += 1
        levels[level[p[1]]] += 1
    result = {"schema": "tladder/1", "rulebook": stamp, "file": intake["file"]["sha256"], "tables": {"m4": freq_table["sha256"]},
              "counts": {"notices": len(placed), "levels": levels, "rungs": rungs},
              "fields": ["terrakey", "rung", "by", "excess", "stations_over", "m4"], "notices": placed}
    emit("tladder", "done", notices=len(placed), **levels)
    return write_result(folder, "tladder", result)
