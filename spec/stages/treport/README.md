# Terrestrial stage 8: Report

**The question:** what does a person at the administration need to read?

## What it does

For each station on a red or amber rung of the terrestrial ladder, the report says who filed it and where (the site name from `fxm_geo`), its class and frequency, its distance to Finland, its field strength at the border point that gave the strongest signal against the trigger level, its power and height (with any assumptions), its coordination with Finland, the listed Finnish stations it exposes, why it is on its rung, and what to do next.

It also writes `report.csv` (every station in the file, one row each, in ascending `terrakey` order: the processed Terrestrial file for accuracy evaluation) and `report.md` (the short notification). Administration names come from [`spec/reference/administrations.json`](../../reference/administrations.json); rung wording from [`spec/rulebook/tladder.json`](../../rulebook/tladder.json); the rest from [`spec/rulebook/treport.json`](../../rulebook/treport.json).

## In Terrestrial 3076

6 stations are reported. The one that needs attention:

> **KRL LYASKELYA** (93075637), Russian Federation, class FB, 152.9 MHz, 42.3 km from Finland. Exceeds at the border: 20.98 dB(µV/m) at the border against a trigger of 12, 8.98 dB over; over the trigger at 2 listed stations.

`report.csv` has 4,057 rows.

## What goes in, what comes out

- **In:** every earlier terrestrial stage's result, and from the database `fxm_terra.terrakey`, `fxm_terra.geo_key`, `fxm_geo.geo_key`, `fxm_geo.site_name`, `fxm_geo.ctry`, `fxm_coord.terrakey`, `fxm_coord.adm`, `fxm_coord.coord_prov`, `fxm_coord.coord_st`.
- **Out:** `treport.json` ([schema](../../schemas/treport.schema.json)), `report.csv` and `report.md`, written exactly as the space report's files are.

## Finnish use (M4)

Each reported station carries `finnish_use`, the uses Finland's national frequency allocation table (Traficom Radio Frequency Regulation 4) lists on its frequencies, as the ladder found them, and the licence-exempt ones. The notification names the first `uses_listed` of each; `report.csv` has two columns, "Finnish use (M4)" and "Licence-exempt use (M4)", with every use, separated by semicolons.
