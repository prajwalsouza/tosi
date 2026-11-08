"""Band/channel trigger and Finnish coordination. See spec/stages/threshold/README.md."""
import math

from .terra_common import emit, need_terrestrial, open_db, read_json, round2, rulebook, stations, write_result


def trigger_level(rules, f, bw_khz):
    band = next((b for b in rules["bands"] if f >= b["from_mhz"] and
                 (f < b["to_mhz"] or (b["to_mhz"] == rules["bands"][-1]["to_mhz"] and f <= b["to_mhz"]))), None)
    if band is None:
        return None
    bc = 10 * math.log10(bw_khz / rules["reference_khz"]) if bw_khz is not None and bw_khz > rules["reference_khz"] else 0
    return {"limit": band["dbuvm"] + bc, "bc": bc}


def run(folder):
    intake = need_terrestrial(folder)
    prev = read_json(folder, "field")
    rules, stamp = rulebook("threshold")
    emit("threshold", "start")
    read = open_db(folder)
    by = {s["terrakey"]: s for s in stations(read, "threshold")}
    coord = {}
    for c in read("threshold", "fxm_coord", ["terrakey", "adm", "coord_st"]):
        if (c.get("adm") or "").strip() == "FIN":
            coord.setdefault(c.get("terrakey"), []).append(str(c.get("coord_st") or ""))
    how = dict.fromkeys(rules["outcomes"], 0)
    notices = []
    for n in prev["notices"]:
        s = by[n["terrakey"]]
        t = trigger_level(rules, s["f"], s["bwKhz"])
        limit = round2(t["limit"])
        excess = round2(n["e"] - limit)
        st = coord.get(n["terrakey"], [])
        coordinated = any("COMPLETED" in x for x in st) and not any("REQUIRED" in x for x in st)
        outcome = ("over_coordinated" if coordinated else "over") if excess > 0 else "near" if excess > -rules["near_db"] else "under"
        how[outcome] += 1
        notices.append({"terrakey": n["terrakey"], "limit": limit, "bc": round2(t["bc"]), "excess": excess,
                        "outcome": outcome, "coordinated": coordinated})
    result = {"schema": "threshold/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "how": how}, "notices": notices}
    emit("threshold", "done", notices=len(notices), how=how)
    return write_result(folder, "threshold", result)
