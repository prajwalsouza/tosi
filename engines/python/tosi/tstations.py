"""Protection at listed Finnish stations. See spec/stages/tstations/README.md."""
from .p1546 import field_strength
from .terra_common import (distance_km, emit, finnish_stations, land_sea, need_terrestrial, open_db,
                           read_json, round2, rulebook, stations, write_result)


def run(folder):
    intake = need_terrestrial(folder)
    thr, data = read_json(folder, "threshold"), read_json(folder, "tdata")
    rules, stamp = rulebook("tstations")
    field, _ = rulebook("field")
    emit("tstations", "start")
    by = {s["terrakey"]: s for s in stations(open_db(folder), "tstations")}
    dat = {n["terrakey"]: n for n in data["notices"]}
    listing = finnish_stations()
    bands = []
    for st in listing["stations"]:
        if st["lon"] is None or st["lat"] is None:
            continue
        half = (st.get("bw_mhz") or 0) / 2
        fs = [st["rx_mhz"], st["tx_mhz"] if st["tx_mhz"] is not None and st["tx_mhz"] != st["rx_mhz"] else None]
        for f in fs:
            if f is not None:
                bands.append({"id": st["station"], "lo": f - half, "hi": f + half, "lon": st["lon"], "lat": st["lat"]})
    how = dict.fromkeys(rules["outcomes"], 0)
    notices = []
    for n in thr["notices"]:
        s, d = by[n["terrakey"]], dat[n["terrakey"]]
        if not listing["present"]:
            how["no_list"] += 1
            notices.append({"terrakey": n["terrakey"], "outcome": "no_list", "checked": 0, "over": [], "worst": None})
            continue
        half = (s["bwKhz"] if s["bwKhz"] is not None else 0) / 2000
        lo, hi = s["f"] - half, s["f"] + half
        seen = {}
        for b in bands:
            if b["hi"] < lo or b["lo"] > hi or b["id"] in seen:
                continue
            km = distance_km(s["lat"], s["lon"], b["lat"], b["lon"], field["earth_radius_km"])
            if km > rules["max_km"]:
                continue
            k = max(field["min_km"], km)
            path = land_sea(s["lon"], s["lat"], b["lon"], b["lat"], k, field["samples"])
            e = field_strength(f=s["f"], t=field["time_percent"], h1=d["heff_m"], h2=rules["receiver_height_m"],
                               dland=path["dland"], dsea=path["dsea"], erp_dbw=d["erp_dbw"])["e"]
            seen[b["id"]] = {"e": round2(e), "excess": round2(round2(e) - n["limit"]), "km": round2(k)}
        ids = sorted(seen, key=float)
        over = [i for i in ids if seen[i]["excess"] > 0]
        worst = None
        for i in ids:
            if worst is None or seen[i]["excess"] > seen[worst]["excess"]:
                worst = i
        outcome = "no_station" if not ids else "exposed" if over else "not_exposed"
        how[outcome] += 1
        notices.append({"terrakey": n["terrakey"], "outcome": outcome, "checked": len(ids), "over": over,
                        "worst": None if worst is None else {"station": worst, **seen[worst]}})
    result = {"schema": "tstations/1", "rulebook": stamp,
              "list": {"present": listing["present"], "sha256": listing["sha256"], "stations": len(listing["stations"])},
              "file": intake["file"]["sha256"], "counts": {"notices": len(notices), "how": how}, "notices": notices}
    emit("tstations", "done", notices=len(notices), how=how)
    return write_result(folder, "tstations", result)
