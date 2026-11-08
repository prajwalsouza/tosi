"""Stage 9: place every space filing on its first applicable concern rung."""
import math

from .m4 import finnish_use, m4_table
from .space_common import (
    emitter, gso_from, open_db, read_json, require_space, rulebook, stations, write,
)


def run(folder):
    intake = require_space(folder, "Ladder")
    rules, stamp = rulebook("ladder")
    down, reach, lim, data, cmp, sta = (
        read_json(folder, f"{name}.json")
        for name in ("downlink", "reach", "limit", "data", "compare", "stations")
    )
    emit = emitter("ladder")
    emit("start")
    read = open_db(folder, emit)

    fin = rules["itu_finland"]["administration"]
    owner = {r.get("grp_id"): r.get("ntc_id") for r in read("grp", ["grp_id", "ntc_id"])}
    itu = {}

    def mark(ntc, source):
        if ntc is not None:
            itu.setdefault(ntc, set()).add(source)

    for r in read("provn", ["grp_id", "adm"]):
        if (r.get("adm") or "").strip() == fin:
            mark(owner.get(r.get("grp_id")), "provn")
    for r in read("tr_aff_ntw", ["ntc_id", "adm"]):
        if (r.get("adm") or "").strip() == fin:
            mark(r.get("ntc_id"), "tr_aff_ntw")
    for r in read("srv_area", ["grp_id", "ctry"]):
        if (r.get("ctry") or "").strip() == fin:
            mark(owner.get(r.get("grp_id")), "srv_area")

    listed = stations()
    geo = rules["geostationary"]
    bands = []
    for s in listed["list"]:
        width = s.get("bw_mhz") or 0
        rx, tx = s.get("rx_mhz"), s.get("tx_mhz")
        frequencies = [] if rx is None else [rx]
        if tx is not None and (rx is None or abs(tx - rx) > rules["same_frequency_mhz"]):
            frequencies.append(tx)
        for f in frequencies:
            bands.append({"id": str(s["station"]), "lo": f - width / 2, "hi": f + width / 2,
                          "w": width, "lon": s.get("lon"), "lat": s.get("lat")})
    longitude = {n["ntc_id"]: n["longitude"] for n in reach["notices"] if n.get("longitude") is not None}
    freq_table = m4_table()
    rows = {}
    for r in cmp["rows"]:
        rows.setdefault(r[1], []).append(r)

    def near_frequency(ntc, hits):
        lon = longitude.get(ntc)
        near = set()
        for r in rows.get(ntc, []):
            lo, hi = r[6:8]
            for b in bands:
                if b["id"] in hits or b["id"] in near:
                    continue
                guard = max(b["w"], rules["near_frequency_min_mhz"])
                if b["lo"] <= hi + guard and b["hi"] >= lo - guard:
                    if (lon is None or b["lon"] is None or b["lat"] is None
                            or gso_from(b["lon"], b["lat"], lon, geo["earth_radius_km"],
                                        geo["geostationary_radius_km"])["el"] >= geo["horizon_deg"]):
                        near.add(b["id"])
        return len(near)

    reach_by, limit_by, data_by, compare_by, station_by = (
        {n["ntc_id"]: n for n in stage["notices"]} for stage in (reach, lim, data, cmp, sta)
    )
    order = {r["key"]: i for i, r in enumerate(rules["rungs"])}
    placed = []
    for n in sorted(down["notices"], key=lambda n: n["ntc_id"]):
        ntc = n["ntc_id"]
        c, s = compare_by.get(ntc, {}), station_by.get(ntc, {})
        ids = s.get("stations") or []
        hits = len(ids)
        o = {"ntc_id": ntc, "rung": "clear", "by": "downlink", "excess": c.get("excess"),
             "stations": hits, "stations_over": len(s.get("over") or []), "stations_near": len(s.get("near") or []),
             "near_frequency": 0, "itu": [], "worst": None, "margin": None}
        placed.append(o)
        if not n["kept"]:
            continue
        if not reach_by.get(ntc, {}).get("seen"):
            o["by"] = "reach"
            continue
        o["itu"] = sorted(itu.get(ntc, []))
        outcome = c.get("outcome")
        if outcome in ("over", "near") and listed["present"] and hits == 0:
            o["near_frequency"] = near_frequency(ntc, set(ids))
        if outcome in ("over", "near"):
            # its worst transmission (the first, if two are equal), with the Finnish use (M4) on that band only
            w = None
            for r in rows.get(ntc, []):
                if w is None or r[5] > w[5]:
                    w = r
            if w is not None:
                o["worst"] = {"grp_id": w[0], "excess": w[5], "lo_mhz": w[6], "hi_mhz": w[7], "m4": finnish_use(freq_table, [(w[6], w[7])])}
        # The station evidence: the strongest transmission over the limit that reaches a listed station, else the
        # strongest near one, with its own margin, band and Finnish use (M4). A station rung rests on exactly this.
        ev = s["at_over"] if outcome == "over" and s.get("at_over") else s.get("at_near")
        if ev:
            o["margin"] = {**ev, "m4": finnish_use(freq_table, [(ev["lo_mhz"], ev["hi_mhz"])])}
        if outcome == "over" and s.get("at_over"):
            o.update(rung="exceeds_station", by="stations")
        elif o["itu"]:
            o.update(rung="itu_names_finland", by="ladder")
        elif s.get("at_near"):
            o.update(rung="near_station", by="stations")
        elif outcome in ("over", "near") and o["near_frequency"] > 0:
            o.update(rung="near_frequency", by="ladder")
        elif outcome == "over":
            o.update(rung="exceeds_no_station", by="stations")
        elif not limit_by.get(ntc, {}).get("limited"):
            o.update(rung="no_limit", by="limit")
        elif not data_by.get(ntc, {}).get("complete"):
            o.update(rung="cannot_calculate", by="data")
        elif not c or outcome == "no_result":
            o.update(rung="cannot_calculate", by="compare")
        else:
            o.update(rung="clear", by="compare")

    placed.sort(key=lambda p: (order[p["rung"]], -p["excess"] if p["excess"] is not None else math.inf, p["ntc_id"]))
    rungs = dict.fromkeys(order, 0)
    levels = {"crit": 0, "warn": 0, "none": 0}
    level = {r["key"]: r["level"] for r in rules["rungs"]}
    for p in placed:
        rungs[p["rung"]] += 1
        levels[level[p["rung"]]] += 1
    result = {"schema": "ladder/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "list": {"present": listed["present"], "sha256": listed["sha256"]}, "tables": {"m4": freq_table["sha256"]},
              "counts": {"notices": len(placed), "levels": levels, "rungs": rungs}, "notices": placed}
    emit("done", notices=len(placed), **levels)
    return write(folder, "ladder.json", result)
