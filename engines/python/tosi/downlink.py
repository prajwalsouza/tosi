"""Stage 2, downlink. See spec/stages/downlink/README.md.

Which space filings send signals down towards the ground: a satellite with at least one transmitting group goes on,
with only its transmitting groups. Reads notice and grp from the database intake unpacked. Progress goes to stderr
as JSON lines; the result goes to stdout and downlink.json.
"""
import hashlib
import json
from pathlib import Path

from .intake import emit, ROOT


def cites_of(rules):
    """The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them."""
    return {k: v for k, v in rules.items() if k == "method" or k == "basis" or k.endswith("_basis")}

RULES_BYTES = (ROOT / "spec" / "rulebook" / "downlink.json").read_bytes()
RULES = json.loads(RULES_BYTES)
RULEBOOK = {"version": RULES["version"], "sha256": hashlib.sha256(RULES_BYTES).hexdigest(), "cites": cites_of(RULES)}


def run(folder):
    folder = Path(folder)
    intake = json.loads((folder / "intake.json").read_text())
    if intake["kind"] != "space" or intake["check"]["status"] != "accepted":
        raise ValueError("Downlink needs an accepted space filing")
    from access_parser import AccessParser

    emit("downlink", "start")
    db = AccessParser(str(folder / "database.mdb"))
    n = db.parse_table("notice")
    emit("downlink", "progress", table="notice", rows=len(n["ntc_id"]))
    g = db.parse_table("grp")
    emit("downlink", "progress", table="grp", rows=len(g["grp_id"]))

    tx, rx, by = {}, {}, {}
    for gid, nid, er in zip(g["grp_id"], g["ntc_id"], g["emi_rcp"]):
        if er == RULES["transmit"]:
            tx[nid] = tx.get(nid, 0) + 1
            by.setdefault(nid, []).append(int(gid))
        elif er == RULES["receive"]:
            rx[nid] = rx.get(nid, 0) + 1

    notices, groups = [], []
    left = {k: 0 for k in RULES["reasons"]}
    for nid, typ in sorted(zip(n["ntc_id"], n["ntc_type"]), key=lambda x: int(x[0])):
        t, r = tx.get(nid, 0), rx.get(nid, 0)
        if typ not in RULES["satellite_types"]:
            reason = "not_satellite"
        elif t == 0 and r == 0:
            reason = "nothing_filed"
        elif t == 0:
            reason = "receive_only"
        else:
            reason = None
        if reason:
            left[reason] += 1
        else:
            groups += by[nid]
        notices.append({"ntc_id": int(nid), "type": typ, "kept": reason is None, "reason": reason, "transmit": t, "receive": r})
    groups.sort()
    result = {
        "schema": "downlink/1",
        "rulebook": RULEBOOK,
        "file": intake["file"]["sha256"],
        "counts": {"notices": len(notices), "kept": sum(x["kept"] for x in notices), "left": left, "groups": len(g["grp_id"]), "groups_kept": len(groups)},
        "notices": notices,
        "groups": groups,
    }
    emit("downlink", "done", kept=result["counts"]["kept"], notices=len(notices), left=left)
    text = json.dumps(result, separators=(",", ":"), ensure_ascii=False)
    (folder / "downlink.json").write_text(text + "\n", encoding="utf-8")
    return text
