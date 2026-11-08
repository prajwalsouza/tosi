"""Stage 8: find listed Finnish stations on the frequencies over or near a limit."""
from .space_common import emitter, gso_from, read_json, require_space, rulebook, stations, write



def _sort_ids(ids):
    return sorted(ids, key=lambda s: (float(s), s))

def run(folder):
    intake = require_space(folder, "Stations")
    rules, stamp = rulebook("stations")
    reach, compare = read_json(folder, "reach.json"), read_json(folder, "compare.json")
    emit = emitter("stations")
    emit("start")
    st = stations()
    emit("progress", table="stations", rows=len(st["list"]))
    bands = []
    for s in st["list"]:
        w = (s.get("bw_mhz") or 0) / 2
        fs = []
        rx, tx = s.get("rx_mhz"), s.get("tx_mhz")
        if rx is not None:
            fs.append(rx)
        if tx is not None and (rx is None or abs(tx - rx) > rules["same_frequency_mhz"]):
            fs.append(tx)
        for f in fs:
            bands.append({"id": str(s["station"]), "lo": f - w, "hi": f + w, "lon": s.get("lon"), "lat": s.get("lat")})
    lon = {n["ntc_id"]: n["longitude"] for n in reach["notices"] if n["longitude"] is not None}
    rows = {}
    for r in compare["rows"]:
        rows.setdefault(r[1], []).append(r)
    how = dict.fromkeys(rules["outcomes"], 0)
    notices = []
    for n in compare["notices"]:
        if n["outcome"] not in ("over", "near"):
            continue
        longitude = lon.get(n["ntc_id"])

        def sees(b):
            return (longitude is None or b["lon"] is None or b["lat"] is None or
                    gso_from(b["lon"], b["lat"], longitude, rules["earth_radius_km"], rules["geostationary_radius_km"])["el"] >= rules["horizon_deg"])

        # Evidence stays with its transmission: each row (one transmission in one limit band) is matched on its own.
        hit, over = set(), set()
        at_over = at_near = None
        for r in rows.get(n["ntc_id"], []):
            grp, excess, lo, hi = r[0], r[5], r[6], r[7]
            here = {b["id"] for b in bands if b["lo"] <= hi and b["hi"] >= lo and sees(b)}
            hit |= here
            is_over = excess > 0
            if is_over:
                over |= here
            # the strongest transmission of each kind that reaches a listed station (the first, if two are equal)
            best = at_over if is_over else at_near
            if here and (best is None or excess > best["excess"]):
                ev = {"grp_id": grp, "excess": excess, "lo_mhz": lo, "hi_mhz": hi, "stations": _sort_ids(here)}
                if is_over:
                    at_over = ev
                else:
                    at_near = ev
        ids = _sort_ids(hit)
        k = "no_list" if not st["present"] else "stations" if ids else "no_station"
        how[k] += 1
        notices.append({"ntc_id": n["ntc_id"], "type": n["type"], "outcome": n["outcome"], "how": k, "stations": ids,
                        "over": _sort_ids(over), "near": [i for i in ids if i not in over], "at_over": at_over, "at_near": at_near})
    result = {"schema": "stations/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "list": {"present": st["present"], "sha256": st["sha256"], "stations": len(st["list"])},
              "counts": {"notices": len(notices), "how": how, "stations_hit": len({s for n in notices for s in n["stations"]})}, "notices": notices}
    emit("done", notices=len(notices), **how)
    return write(folder, "stations.json", result)
