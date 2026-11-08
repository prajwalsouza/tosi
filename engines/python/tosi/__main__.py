"""Tosi engine, Python. Commands print one JSON document on stdout; see dev/docs/modules.md."""
import json
import platform
import sys
from pathlib import Path

from . import __version__

ROOT = Path(__file__).resolve().parents[3]


def info() -> dict:
    return {
        "schema": "engine-info/1",
        "engine": "python",
        "language": "Python",
        "version": __version__,
        "runtime": f"Python {platform.python_version()}",
        "spec": (ROOT / "spec" / "VERSION").read_text().strip(),
        "stages": ["intake", "downlink", "reach", "limit", "data", "power", "compare", "stations", "mobile", "range", "tdata", "field", "threshold", "tstations", "ladder", "report", "tladder", "treport"],
    }


def arg(name):
    a = sys.argv
    if name in a and a.index(name) + 1 < len(a):
        return a[a.index(name) + 1]
    sys.stderr.write(json.dumps({"error": f"missing {name}"}) + "\n")
    sys.exit(2)


def intake():
    from .intake import run
    f = arg("--file")
    return run(f, sys.argv[sys.argv.index("--name") + 1] if "--name" in sys.argv else Path(f).name, arg("--out"))


def downlink():
    from .downlink import run
    return run(arg("--in"))


def reach():
    from .reach import run
    return run(arg("--in"))


def stage_limit():
    from .limit import run
    return run(arg("--in"))


def stage_data():
    from .data import run
    return run(arg("--in"))


def stage_power():
    from .power import run
    return run(arg("--in"))


def stage_compare():
    from .compare import run
    return run(arg("--in"))


def stage_stations():
    from .stations import run
    return run(arg("--in"))


def stage_mobile():
    from .mobile import run
    return run(arg("--in"))


def stage_range():
    from .range import run
    return run(arg("--in"))


def stage_tdata():
    from .tdata import run
    return run(arg("--in"))


def stage_field():
    from .field import run
    return run(arg("--in"))


def stage_threshold():
    from .threshold import run
    return run(arg("--in"))


def stage_tstations():
    from .tstations import run
    return run(arg("--in"))


def stage_ladder():
    from .ladder import run
    return run(arg("--in"))


def stage_report():
    from .report import run
    return run(arg("--in"))


def stage_tladder():
    from .tladder import run
    return run(arg("--in"))


def stage_treport():
    from .treport import run
    return run(arg("--in"))


COMMANDS = {"info": info, "intake": intake, "downlink": downlink, "reach": reach, "limit": stage_limit, "data": stage_data, "power": stage_power, "compare": stage_compare, "stations": stage_stations, "mobile": stage_mobile, "range": stage_range, "tdata": stage_tdata, "field": stage_field, "threshold": stage_threshold, "tstations": stage_tstations, "ladder": stage_ladder, "report": stage_report, "tladder": stage_tladder, "treport": stage_treport}


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else None
    run = COMMANDS.get(command)
    if run is None:
        sys.stderr.write(json.dumps({"error": "unknown command", "command": command, "known": list(COMMANDS)}) + "\n")
        sys.exit(2)
    try:
        out = run()
        sys.stdout.write((out if isinstance(out, str) else json.dumps(out, separators=(",", ":"))) + "\n")
    except Exception as e:
        sys.stderr.write(json.dumps({"error": str(e)}) + "\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
