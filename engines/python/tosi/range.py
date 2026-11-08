"""Distance and frequency applicability. See spec/stages/range/README.md."""
from .terra_common import emit, need_terrestrial, nearest_border, open_db, read_json, round2, rulebook, stations, write_result


def run(folder):
    intake = need_terrestrial(folder)
    prev = read_json(folder, "mobile")
    rules, stamp = rulebook("range")
    emit("range", "start")
    by = {s["terrakey"]: s for s in stations(open_db(folder), "range")}
    left = dict.fromkeys(rules["reasons"], 0)
    notices = []
    for n in prev["notices"]:
        if n[6] is not None:
            continue
        s = by[n[0]]
        km = border = None
        if s["lon"] is not None and s["lat"] is not None:
            b = nearest_border(s["lon"], s["lat"], rules["earth_radius_km"])
            km = max(0, b["km"] - (s["radius"] if s["radius"] > 0 else 0))
            border = b["index"]
        reason = ("withdrawn" if s["intent"] == rules["withdrawn_intent"] else "too_far" if km is not None and km > rules["max_km"]
                  else "out_of_band" if s["f"] is None or s["f"] < rules["f_min_mhz"] or s["f"] > rules["f_max_mhz"] else None)
        if reason:
            left[reason] += 1
        notices.append([s["terrakey"], None if km is None else round2(km), border, reason])
    kept = sum(n[3] is None for n in notices)
    result = {"schema": "range/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "kept": kept, "left": left},
              "fields": ["terrakey", "km", "border", "reason"], "notices": notices}
    emit("range", "done", kept=kept, notices=len(notices), left=left)
    return write_result(folder, "range", result)
