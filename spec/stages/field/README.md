# Terrestrial stage 4: Field strength

**The question:** how strong is the station's signal at Finland's border?

## The method

Recommendation ITU-R P.1546-6, without a terrain profile (accepted by Traficom), for the field strength exceeded 10% of the time at 50% of locations, at a receiving antenna 10 m above rural ground. The curves are the ITU's own tables ([`spec/tables/p1546.json`](../../tables/p1546.json)), and the steps are ported from the ITU-R WP 3K reference implementation (version 6.2):

- steps 6 to 10: interpolation in transmitter height, distance, frequency and time, and heights below 10 m;
- step 11: paths over land and sea together (the RRC-06 method), with the Baltic and Arctic as cold sea;
- step 14: the receiving antenna height (no correction at 10 m);
- step 19: the maximum field strength.

The port matches all 52 ITU validation examples at step 11 to within 0.001 dB (`node compare/p1546_check.ts <validation_results folder>`).

## Where it is worked out

Worst case, at several points of Finland's outer limit: the 5 nearest; every third border point (about every 30 km) within 100 km of the nearest distance; and the nearest land-border and sea-limit points. The strongest counts. Each path is a straight line, split into land and sea by testing 60 evenly spaced points against the land outlines in [`spec/tables/finland.json`](../../tables/finland.json). The result is scaled from 1 kW to the station's e.r.p.

## In Terrestrial 3076

57 stations, from −99 to 39 dB(µV/m) at their strongest border point. Against the earlier prototype, 54 of 57 agree within 2 dB; the rest are higher here, because more border points are tried.

## What goes in, what comes out

- **In:** `tdata.json` and the database.
- **Out:** `field.json` ([schema](../../schemas/field.schema.json)): per station, the field strength (dB(µV/m)), the border point used (index into `spec/tables/finland.json`), its distance (km) and the share of the path over land. The fingerprints of both tables are recorded.
