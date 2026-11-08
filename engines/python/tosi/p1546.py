"""P.1546-6 steps 6–11, 14 and 19, matching engines/ts/src/p1546.ts.

Run ``python -m tosi.p1546 <validation_results>`` to check the ITU step-11
CSV logs, or omit the folder for a quick check of every tabulated curve.
Terrain, clutter and location corrections are outside this port's scope.
"""
import csv
import hashlib
import json
import math
from pathlib import Path

from .intake import ROOT

_BYTES = (ROOT / "spec" / "tables" / "p1546.json").read_bytes()
CURVES = json.loads(_BYTES)["curves"]
P1546_SHA = hashlib.sha256(_BYTES).hexdigest()
DIST = [r["d"] for r in CURVES[0]["rows"]]
HEIGHTS = [10, 20, 37.5, 75, 150, 300, 600, 1200]
FREQS = [100, 600, 2000]
TIMES = [1, 10, 50]
log10 = math.log10
# Index the table without changing curve selection or the order of arithmetic.
_ROWS = {c["figure"]: {r["d"]: r["e"] for r in c["rows"]} for c in CURVES}


def closest(x, v):
    if x[-1] < v:
        return x[-2], x[-1]
    if x[0] > v:
        return x[0], x[1]
    for i, a in enumerate(x):
        if a == v:
            return v, v
        if a > v:
            return x[i - 1], a
    return x[-2], x[-1]


def emax(t, dland, dsea):
    d = dland + dsea
    efs = 106.9 - 20 * log10(d)
    ese = 2.38 * (1 - math.exp(-d / 8.94)) * log10(50 / t)
    return efs + dsea * ese / d


def _d06(f, h1, h2):
    if h1 < 0:
        h1 = 0
    df = 0.0000389 * f * h1 * h2
    dh = 4.1 * (math.sqrt(h1) + math.sqrt(h2))
    return max(0.001, df * dh / (df + dh))


def _qi(x):
    def T(y):
        return math.sqrt(-2 * math.log(y))

    def C(z):
        t = T(z)
        return ((0.010328 * t + 0.802853) * t + 2.515517) / (((0.001308 * t + 0.189269) * t + 1.432788) * t + 1)

    return T(x) - C(x) if x <= 0.5 else -(T(1 - x) - C(1 - x))


def _v(fnom, h1):
    k = 1.35 if fnom == 100 else 3.31 if fnom == 600 else 6
    return k * (math.atan(-h1 / 9000) * 180 / math.pi)


def _j(nu):
    return 6.9 + 20 * log10(math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1) if nu > -0.7806 else 0


def _at_height(c, h, dinf, dsup, d):
    k = c["h1"].index(h)
    rows = _ROWS[c["figure"]]
    ei, es = rows[dinf][k], rows[dsup][k]
    return ei + (es - ei) * log10(d / dinf) / log10(dsup / dinf) if dsup != dinf else es


def _step81(c, h1, dinf, dsup, d, em):
    hi, hs = closest(HEIGHTS, h1)
    ei = _at_height(c, hi, dinf, dsup, d)
    e = ei + (_at_height(c, hs, dinf, dsup, d) - ei) * log10(h1 / hi) / log10(hs / hi) if hi != hs else _at_height(c, hs, dinf, dsup, d)
    return min(e, em)


def _step82(c, h1, dinf, dsup, d, sea, fnom, em, t):
    e10 = _at_height(c, 10, dinf, dsup, d)
    e20 = _at_height(c, 20, dinf, dsup, d)
    ch = 6.03 - _j(_v(fnom, -10))
    ezero = e10 + 0.5 * (e10 - e20 + ch)
    if not sea:
        return ezero + 0.1 * h1 * (e10 - ezero) if h1 >= 0 else ezero + 6.03 - _j(_v(fnom, h1))
    dh1, d20 = _d06(fnom, h1, 10), _d06(fnom, 20, 10)
    if d <= dh1:
        return em
    if d < d20:
        a, b = closest(DIST, d20)
        e10d, e20d = _at_height(c, 10, a, b, d20), _at_height(c, 20, a, b, d20)
        ed20 = e10d + (e20d - e10d) * log10(h1 / 10) / log10(2)
        edh1 = emax(t, 0, dh1)
        return edh1 + (ed20 - edh1) * log10(d / dh1) / log10(d20 / dh1)
    # The reference deliberately has a natural log in this denominator.
    e1 = e10 + (e20 - e10) * log10(h1 / 10) / math.log(2)
    e2 = ezero + 0.1 * h1 * (e10 - ezero)
    fs = (d - d20) / d
    return e1 * (1 - fs) + e2 * fs


def _step7(curves, h1, dinf, dsup, d, sea, f, em, t):
    fi, fs = closest(FREQS, f)

    def at(fn):
        c = next(c for c in curves if c["f_mhz"] == fn)
        return min(_step81(c, h1, dinf, dsup, d, em), em) if h1 >= 10 else _step82(c, h1, dinf, dsup, d, sea, fn, em, t)

    if fi == fs:
        return at(fs)
    ei = at(fi)
    e = ei + (at(fs) - ei) * log10(f / fi) / log10(fs / fi)
    return min(e, em) if f > 2000 else e


def _step6to10(kind, h1, dinf, dsup, d, f, em, t):
    sea = kind != "land"
    ti, ts = closest(TIMES, t)

    def at(tn):
        curves = [c for c in CURVES if (c["path"] != "land" if sea else c["path"] == "land") and c["time"] == tn
                  and (not (kind == "warm" and tn != 50) or c["path"] == "warm_sea")]
        df, d600 = _d06(f, h1, 10), _d06(600, h1, 10)
        if sea and f < 100 and d < d600:
            if d <= df:
                return emax(t, 0, d)
            edf = emax(t, 0, df)
            a, b = closest(DIST, d600)
            ed600 = _step7(curves, h1, a, b, d600, sea, f, em, t)
            return edf + (ed600 - edf) * log10(d / df) / log10(d600 / df)
        return _step7(curves, h1, dinf, dsup, d, sea, f, em, t)

    if ti == ts:
        return at(ts)
    qs, qn, qt = _qi(ts / 100), _qi(ti / 100), _qi(t / 100)
    return at(ts) * (qn - qt) / (qn - qs) + at(ti) * (qt - qs) / (qn - qs)


def _mixed(el, es, dland, dsea):
    d = dland + dsea
    if dsea == 0:
        return el
    if dland == 0:
        return es
    fsea, delta = dsea / d, es - el
    a = (1 - (1 - fsea) ** (2 / 3)) ** max(1, 1 + delta / 40)
    return (1 - a) * el + a * es


def e11(*, f, t, h1, dland, dsea, emax, sea="cold"):
    """Step-11 field for 1 kW e.r.p., before receiver/terrain corrections."""
    d = dland + dsea
    dinf, dsup = (1, 1) if d < 1 else closest(DIST, d)
    dd = d if d >= 1 else 1
    el = _step6to10("land", h1, dinf, dsup, dd, f, emax, t) if dland > 0 else 0
    es = _step6to10(sea, max(3, h1), dinf, dsup, dd, f, emax, t) if dsea > 0 else 0
    return _mixed(el, es, dland, dsea)


def _step14(h1, d, h2, f, area):
    k = 3.2 + 6.2 * log10(f)
    if area == "rural" or h2 >= 10:
        return k * log10(h2 / 10)
    d10, dh2 = _d06(f, h1, 10), _d06(f, h1, h2)
    c10 = k * log10(h2 / 10)
    return c10 if d >= d10 else 0 if d <= dh2 else c10 * log10(d / dh2) / log10(d10 / dh2)


def field_strength(*, f, t, h1, h2, dland, dsea, erp_dbw, area="rural"):
    d = dland + dsea
    h1 = min(3000, max(3, h1) if dsea > 0 and dland == 0 else h1)
    em = emax(t, dland, dsea)
    e = e11(f=f, t=t, h1=h1, dland=dland, dsea=dsea, emax=em)
    e += _step14(h1, max(d, 1), h2, f, area)
    if e > em:
        e = em
    return {"e": e + erp_dbw - 30, "emax": em + erp_dbw - 30}


def check_validation(folder):
    """Same inputs and 0.1 dB tolerance as compare/p1546_check.ts."""
    ok = n = 0
    for path in sorted(Path(folder).glob("*_log.csv")):
        with path.open(encoding="utf-8", newline="") as stream:
            lines = list(csv.reader(stream))

        def get(prefix):
            return next((r for r in lines if r and r[0].startswith(prefix)), [])

        def number(prefix):
            r = get(prefix)
            return float(r[3]) if len(r) > 3 and r[3].strip() else (0.0 if len(r) > 3 else math.nan)

        want = number("Field strength (dBuV/m)")
        if not math.isfinite(want):
            continue
        sea_row = get("Sea path")
        got = e11(f=number("Frequency f"), t=number("Percentage time"), h1=number("Tx antenna height h1"),
                  dland=number("Land path"), dsea=number("Sea path"), emax=number("Maximum field strength Emax"),
                  sea="warm" if len(sea_row) > 1 and sea_row[1].lower() == "warm" else "cold")
        dev = got - want
        passed = abs(dev) <= 0.1
        n += 1
        ok += passed
        print(f"{'ok  ' if passed else 'DIFF'} {path.name:44} want {want:9.4f}  got {got:9.4f}  {dev:+.4f}")
    print(f"\n{ok} of {n} ITU validation examples match within 0.1 dB at step 11.")
    return n > 0 and ok == n


def self_test():
    """All table knots, plus pinned step-11 interpolation/low-height examples.

    The latter values come from the TypeScript reference (not an independent
    ITU validation); use check_validation for the official example logs.
    """
    count = 0
    for c in CURVES:
        land = c["path"] == "land"
        for row in c["rows"]:
            for h, want in zip(c["h1"], row["e"]):
                got = e11(f=c["f_mhz"], t=c["time"], h1=h, dland=row["d"] if land else 0,
                          dsea=0 if land else row["d"], sea="warm" if c["path"] == "warm_sea" else "cold", emax=math.inf)
                if got != want:
                    raise AssertionError((c["figure"], row["d"], h, want, got))
                count += 1
    print(f"ok: {count} tabulated curve values")
    # f, t, h1, dland, dsea, sea kind, logged maximum, expected step 11.
    examples = [
        (30, 1, -20, 0, 0.1, "cold", 126.94497782741676, 96.18942394611568),
        (30, 1, -20, 40, 60, "warm", 69.3260955124152, 30.808389840352085),
        (30, 5, 0, 0, 2, "warm", 101.35648523866654, 82.46760915996086),
        (30, 10, 3, 0, 100, "cold", 68.56352553459311, 20.554550785033207),
        (100, 10, 3, 999, 0, "warm", 46.90869023548036, -63.37854291922201),
        (175, 1, -20, 6.800000000000001, 10.2, "cold", 84.35484576163604, 45.73563856221373),
        (600, 1, 8, 999, 0, "cold", 46.90869023548036, -61.976003332671745),
        (4000, 1, 3500, 40, 60, "cold", 69.3260955124152, 66.54122341399952),
    ]
    for f, t, h1, dl, ds, sea, em, want in examples:
        got = e11(f=f, t=t, h1=h1, dland=dl, dsea=ds, sea=sea, emax=em)
        if abs(got - want) > 1e-10:
            raise AssertionError((f, t, h1, dl, ds, sea, want, got))
    print(f"ok: {len(examples)} TypeScript step-11 regression examples")
    return True


if __name__ == "__main__":
    import sys

    sys.exit(0 if (check_validation(sys.argv[1]) if len(sys.argv) > 1 else self_test()) else 1)
