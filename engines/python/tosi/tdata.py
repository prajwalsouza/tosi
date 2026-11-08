"""Filed power and effective height. See spec/stages/tdata/README.md."""
from .terra_common import emit, need_terrestrial, num, open_db, read_json, round2, rulebook, stations, write_result


def run(folder):
    intake = need_terrestrial(folder)
    prev = read_json(folder, "range")
    rules, stamp = rulebook("tdata")
    emit("tdata", "start")
    read = open_db(folder)
    by = {s["terrakey"]: s for s in stations(read, "tdata")}
    ants = {}
    for a in read("tdata", "fxm_ant", ["terrakey", "ant_key", "pwr_dbw", "pwr_eiv", "tx_rx", "hgt_agl", "eff_hgtmax"]):
        ants.setdefault(a.get("terrakey"), []).append(a)
    hgt = {}
    for h in read("tdata", "fxm_ant_hgt", ["terrakey", "eff_hgt"]):
        v = num(h.get("eff_hgt"))
        if v is not None:
            key = h.get("terrakey")
            hgt[key] = max(hgt.get(key, -float("inf")), v)
    left = dict.fromkeys(rules["reasons"], 0)
    notices = []
    for r in prev["notices"]:
        if r[3] is not None:
            continue
        key = r[0]
        s = by[key]
        # Missing tx_rx is JS undefined, distinct from an explicitly null value.
        tx = sorted((a for a in ants.get(key, []) if "tx_rx" in a and a["tx_rx"] in ("TX", None, "")),
                    key=lambda a: a.get("ant_key") or 0)
        top = None
        for a in tx:
            p = num(a.get("pwr_dbw"))
            if p is not None and (top is None or p > num(top.get("pwr_dbw"))):
                top = a

        def max_of(column):
            return max((v for a in tx if (v := num(a.get(column))) is not None), default=None)

        assumptions = []
        heff = max_of("eff_hgtmax")
        source = "eff_hgtmax" if heff is not None else None
        if heff is None and key in hgt:
            heff, source = hgt[key], "fxm_ant_hgt"
        if heff is None:
            heff = max_of("hgt_agl")
            if heff is not None:
                source = "hgt_agl"
                assumptions.append("height_above_ground")
        if heff is None and s["cls"] == "ML":
            heff, source = rules["mobile_default_m"], "default"
            assumptions.append("mobile_default_height")
        erp = None
        if top is not None:
            erp = num(top.get("pwr_dbw"))
            ref = (top.get("pwr_eiv") or "").strip()
            if ref == "I":
                erp -= rules["eirp_to_erp_db"]
                assumptions.append("eirp_to_erp")
            elif ref != "E":
                assumptions.append("power_reference_taken_as_erp")
        if s["radius"] > 0:
            assumptions.append("area_station_edge")
        reason = ("no_position" if s["lon"] is None or s["lat"] is None else "no_power" if erp is None else "no_height" if heff is None else None)
        if reason:
            left[reason] += 1
        notices.append({"terrakey": key, "kept": reason is None, "reason": reason,
                        "erp_dbw": None if erp is None else round2(erp), "heff_m": None if heff is None else round2(heff),
                        "heff_from": source, "assumptions": assumptions})
    kept = sum(n["kept"] for n in notices)
    result = {"schema": "tdata/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "kept": kept, "left": left}, "notices": notices}
    emit("tdata", "done", kept=kept, notices=len(notices), left=left)
    return write_result(folder, "tdata", result)
