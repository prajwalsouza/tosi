"""Stage 4: match transmitting groups to the international limits for Finland."""
from .space_common import (
    emitter, groups, limits, open_db, orbits, read_json, require_space, rulebook,
    table_of, write,
)


def run(folder):
    intake = require_space(folder, "Limit")
    rules, stamp = rulebook("limit")
    reach, down = read_json(folder, "reach.json"), read_json(folder, "downlink.json")
    emit = emitter("limit")
    emit("start")
    read = open_db(folder, emit)
    gs, seen = groups(read, reach, down)
    orb, lim = orbits(read), limits()
    finland = set(rules["areas_protecting_finland"])
    rows, per = [], {}
    named_rows = 0

    def empty():
        return {"groups": 0, "rows": 0, "named": 0, "nofreq": 0, "all": 0}

    for g in gs:
        p = per.setdefault(g["ntc_id"], empty())
        p["all"] += 1
        if g["lo"] is None or g["hi"] is None:
            p["nofreq"] += 1
            continue
        t, o, cls = table_of(g["type"]), orb.get(g["ntc_id"], {}), set(g["classes"])
        mine = []
        for x in lim["exam"][t]:
            if not (x["freq_min"] < g["hi"] and x["freq_max"] > g["lo"]):
                continue
            if not cls.intersection(lim["classes"].get(x["ix_serv"], ())):
                continue
            if g["date"] is not None and not x["date_min"] <= g["date"] <= x["date_max"]:
                continue
            if t == "N" and o.get("incl") is not None and not x["inclin_fr"] <= o["incl"] <= x["inclin_to"]:
                continue
            if t == "N" and o.get("apog") is not None and not x["apog_fr"] <= o["apog"] <= x["apog_to"]:
                continue
            area = lim["area"].get(x["ix_prot_area"], "")
            if area not in finland:
                if rules["named_countries_marker"] in area:
                    p["named"] += 1
                    named_rows += 1
                continue
            pv = lim["provision"][t].get(x["ix_provn"])
            if pv is None or pv.get("ang_type") == rules["skip_angle_type"]:
                continue
            mine.append([g["grp_id"], g["ntc_id"], t, x["ix_freq"], x["ix_provn"]])
        if mine:
            p["groups"] += 1
            p["rows"] += len(mine)
            rows.extend(mine)
    rows.sort(key=lambda r: (r[0], r[2], r[3], r[4]))
    how = dict.fromkeys(rules["outcomes"], 0)
    notices = []
    for ntc, kind in sorted(seen.items()):
        p = per.get(ntc, empty())
        k = ("limited" if p["rows"] else "no_frequency" if p["all"] == 0 or p["nofreq"] == p["all"]
             else "named_countries_only" if p["named"] else "no_limit")
        how[k] += 1
        notices.append({"ntc_id": ntc, "type": kind, "limited": k == "limited", "how": k, "groups": p["groups"], "rows": p["rows"]})
    limited = sum(n["limited"] for n in notices)
    result = {"schema": "limit/1", "rulebook": stamp, "tables": lim["source"]["sha256"], "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "limited": limited, "left": len(notices) - limited, "how": how,
                         "groups": len(gs), "groups_limited": sum(n["groups"] for n in notices), "rows": len(rows), "named_countries_rows": named_rows},
              "notices": notices, "rows": rows}
    emit("done", limited=limited, notices=len(notices), rows=len(rows))
    return write(folder, "limit.json", result)
