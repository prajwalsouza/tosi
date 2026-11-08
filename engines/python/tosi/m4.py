"""Finland's national frequency allocation table (Traficom Radio Frequency Regulation 4), as spec/tables/m4.json.
Used by both ladders to say which Finnish uses, and which licence-exempt uses, share a case's frequencies."""
import hashlib
import json

from .space_common import ROOT


def m4_table():
    raw = (ROOT / "spec" / "tables" / "m4.json").read_bytes()
    return {"rows": json.loads(raw)["rows"], "sha256": hashlib.sha256(raw).hexdigest()}


def finnish_use(table, ranges):
    """Every use whose sub-band touches any of the ranges (lo, hi in MHz, ends included), each once, in table order;
    and, of those, the ones the table marks licence-exempt."""
    uses, exempt = [], []
    for lo, hi, use, ex in table["rows"]:
        if not any(lo <= b and hi >= a for a, b in ranges):
            continue
        if use not in uses:
            uses.append(use)
        if ex and use not in exempt:
            exempt.append(use)
    return {"uses": uses, "exempt": exempt}
