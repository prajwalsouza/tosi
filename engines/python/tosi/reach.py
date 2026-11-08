"""Stage 3, reach. See spec/stages/reach/README.md.

Which transmitting satellites can ever be seen from Finland: a fixed satellite must rise above the horizon somewhere
in the box around Finland; a moving one must pass far enough north. Every choice leans to "seen". Progress goes to
stderr as JSON lines; the result goes to stdout and reach.json.
"""
import hashlib
import json
import math
from pathlib import Path

from .intake import emit, ROOT


def cites_of(rules):
    """The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them."""
    return {k: v for k, v in rules.items() if k == "method" or k == "basis" or k.endswith("_basis")}

RULES_BYTES = (ROOT / "spec" / "rulebook" / "reach.json").read_bytes()
RULES = json.loads(RULES_BYTES)
RULEBOOK = {"version": RULES["version"], "sha256": hashlib.sha256(RULES_BYTES).hexdigest(), "cites": cites_of(RULES)}

# Shared with the other engines, exactly: degrees to radians and back, wrapping, rounding to two decimals.
RAD, DEG = math.pi / 180, 180 / math.pi


def wrap(x):
    return math.fmod(math.fmod(x, 360) + 360, 360)


def round2(x):
    v = math.floor(x * 100 + 0.5) / 100
    return int(v) if v == int(v) else v  # shortest form, as the other engines write it; never -0


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def rows(db, names, table, columns):
    """A table that is missing counts as filing nothing."""
    if table not in names:
        return []
    t = db.parse_table(table)
    out = [dict(zip(columns, r)) for r in zip(*(t[c] for c in columns))]
    emit("reach", "progress", table=table, rows=len(out))
    return out


def run(folder):
    folder = Path(folder)
    intake = json.loads((folder / "intake.json").read_text())
    if intake["kind"] != "space" or intake["check"]["status"] != "accepted":
        raise ValueError("Reach needs an accepted space filing")
    down = json.loads((folder / "downlink.json").read_text())
    from access_parser import AccessParser

    emit("reach", "start")
    db = AccessParser(str(folder / "database.mdb"))
    names = set(db.catalog)
    geo = {r["ntc_id"]: r for r in rows(db, names, "geo", ["ntc_id", "long_nom", "tol_east", "tol_west"])}
    ngeo = {r["ntc_id"]: r for r in rows(db, names, "non_geo", ["ntc_id", "ref_body"])}
    orbits = {}
    for r in rows(db, names, "orbit", ["ntc_id", "orb_id", "inclin_ang", "apog_km"]):
        orbits.setdefault(r["ntc_id"], []).append(r)
    owner = {r["grp_id"]: r["ntc_id"] for r in rows(db, names, "grp", ["grp_id", "ntc_id"])}

    R, RG, F, H = RULES["earth"]["radius_km"], RULES["geostationary_radius_km"], RULES["finland"], RULES["horizon_deg"]
    how = {k: 0 for k in [*RULES["outcomes"]["seen"], *RULES["outcomes"]["clear"]]}
    notices = []
    for n in sorted((x for x in down["notices"] if x["kept"]), key=lambda x: x["ntc_id"]):
        o = {"ntc_id": n["ntc_id"], "type": n["type"], "seen": True, "how": "assumed", "longitude": None, "elevation": None, "north": None, "orbit": None, "body": None}
        if RULES["satellite_types"].get(n["type"]) == "geostationary":
            g = geo.get(n["ntc_id"]) or {}
            L = num(g.get("long_nom"))
            if L is not None:
                te, tw = num(g.get("tol_east")) or 0.0, num(g.get("tol_west")) or 0.0
                in_box = wrap(L - F["west"]) <= F["east"] - F["west"]
                gap = 0.0 if in_box else min(180.0, max(0.0, min(wrap(F["west"] - L) - te, wrap(L - F["east"]) - tw)))
                c = math.cos(F["south"] * RAD) * math.cos(gap * RAD)
                el = math.atan2(c - R / RG, math.sqrt(1 - c * c)) * DEG
                o["seen"] = el >= H
                o.update(how="above_horizon" if o["seen"] else "below_horizon", longitude=round2(L), elevation=round2(el))
        else:
            body = (ngeo.get(n["ntc_id"]) or {}).get("ref_body")
            if body is not None and body != RULES["earth_body"]:
                o.update(how="beyond_earth", body=body)
            else:
                best = at = None
                for r in sorted(orbits.get(n["ntc_id"], []), key=lambda r: r["orb_id"]):
                    i, a = num(r["inclin_ang"]), num(r["apog_km"])
                    if i is None or a is None or a < 0:
                        continue
                    north = min(i, 180 - i) + math.acos(R / (R + a)) * DEG
                    if best is None or north > best:
                        best, at = north, int(r["orb_id"])
                if best is not None:
                    o["seen"] = best >= F["south"]
                    o.update(how="reaches_north" if o["seen"] else "too_far_south", north=round2(best), orbit=at)
        how[o["how"]] += 1
        notices.append(o)
    seen_ids = {x["ntc_id"] for x in notices if x["seen"]}
    groups = sorted(g for g in down["groups"] if owner.get(g) in seen_ids)
    seen = len(seen_ids)
    result = {
        "schema": "reach/1",
        "rulebook": RULEBOOK,
        "file": intake["file"]["sha256"],
        "counts": {"notices": len(notices), "seen": seen, "clear": len(notices) - seen, "how": how, "groups": len(down["groups"]), "groups_kept": len(groups)},
        "notices": notices,
        "groups": groups,
    }
    emit("reach", "done", seen=seen, clear=len(notices) - seen, notices=len(notices))
    text = json.dumps(result, separators=(",", ":"), ensure_ascii=False)
    (folder / "reach.json").write_text(text + "\n", encoding="utf-8")
    return text
