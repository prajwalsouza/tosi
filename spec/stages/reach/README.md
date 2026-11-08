# Stage 3: Reach

**The question:** can this satellite ever be seen from Finland?

## Why it comes here

A satellite can only interfere with a receiver in Finland if it rises above Finland's horizon. One that is always below the horizon, seen from everywhere in Finland, has the whole Earth between it and us. It cannot interfere, so it is **clear**. This is one of three outcomes the guidebook keeps apart (MD-9): clear, no applicable limit, and cannot calculate.

Reach runs on the filings Downlink kept: satellites that transmit.

## Worst case, always

Every choice leans towards "seen":

- **Finland is a box** around its land and territorial sea, rounded outwards (59.3–70.1° N, 19.0–31.6° E). It holds more than Finland, never less.
- **The horizon is 0°.** Any height above the horizon counts.
- A fixed satellite is moved **towards Finland by its filed tolerance**.
- A moving satellite is taken at **its highest point** (apogee), and **every orbit** it files is tried. One that reaches is enough.
- A filing whose position is **not filed in full** is treated as seen. The Data step later asks for what is missing.

## The rule

**A satellite fixed in the sky** (`G`) has one longitude. The highest it ever appears from Finland is at the south edge of the box, at the box longitude nearest to it. With the angle `ψ` between that point and the satellite:

```
cos ψ = cos(south) · cos(Δλ)                 Δλ: longitude gap, less the tolerance, never below 0
elevation = atan2(cos ψ − R / r, sin ψ)      R: Earth radius 6378.14 km, r: geostationary radius 42164.2 km
```

It is **seen** if the elevation is at least 0°. Otherwise it is **clear: below the horizon**. Seen from the south of Finland, that leaves roughly 52.5° W to 103° E.

**A satellite that moves across the sky** (`N`) and orbits the Earth goes as far north as its orbit's tilt (folded to at most 90°). From its highest point it can see over the horizon to an angle `ρ` around the Earth:

```
cos ρ = R / (R + apogee)
north = min(tilt, 180° − tilt) + ρ
```

It is **seen** if `north` is at least the south edge of the box, for any of its orbits. Otherwise it is **clear: too far south**. The Earth turns beneath every orbit, so its longitude does not matter.

**A satellite that travels around another body** (the Moon, the Sun, Jupiter) is far away, and like that body it appears in Finland's sky at times. It is **seen**. Whether its signal is strong enough to matter is a question for the Power step.

The wording of every outcome, and every constant with its source, are in [`spec/rulebook/reach.json`](../../rulebook/reach.json).

## In Space 3074

| | Filings |
|---|---|
| Fixed satellites that rise above Finland's horizon | 35 seen |
| Fixed satellites below the horizon | 35 clear |
| Moving satellites that reach far enough north | 93 seen |
| Moving satellites that stay too far south | 3 clear |
| Satellites around the Moon, the Sun or Jupiter | 9 seen |
| Orbit not filed | 1 assumed seen |

**138 of 176 filings can be seen from Finland. 38 are clear.**

## What goes in, what comes out

- **In:** the database, `intake.json` and `downlink.json`. Reach runs only on an accepted space filing.
- **Out:** `reach.json`, matching [`spec/schemas/reach.schema.json`](../../schemas/reach.schema.json): every filing Downlink kept, whether it can be seen and why, the numbers behind it, the counts, and the transmitting groups of the filings that can be seen.
- **Reads:** `geo.ntc_id`, `geo.long_nom`, `geo.tol_east`, `geo.tol_west`, `non_geo.ntc_id`, `non_geo.ref_body`, `orbit.ntc_id`, `orbit.orb_id`, `orbit.inclin_ang`, `orbit.apog_km`, `grp.grp_id`, `grp.ntc_id`. A table that is missing counts as filing nothing.

Notices are listed in ascending `ntc_id` order and groups in ascending `grp_id` order. Angles are rounded to two decimals as `floor(x · 100 + 0.5) / 100` and written in shortest form (`66`, not `66.0`; never `-0`). All three engines must write identical files.
