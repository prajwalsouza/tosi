# Stage 10: Report

**The question:** what does a person at the administration need to read?

## What it does

The report is the notification. It takes the filings on the red and amber rungs of the ladder and, for each one, says:

- **What it is:** the satellite's name, the administration that filed it, and whether it is fixed in the sky (with its longitude) or moving (with its orbit tilt and height), or travels around another body.
- **Whether Finland can see it.**
- **Which listed stations:** how many, and the first five.
- **Why:** the rung's wording, what it means, the guidebook entries it cites, and any ITU records that name Finland.
- **How much:** the worst excess over the limit, the provision, the arrival angle, the distance, the power per square metre and the limit there.
- **Next:** what a person should do, by rung.

It also writes two files beside `report.json`:

- **`report.csv`:** every filing that entered the screen, one row each, in ascending `ntc_id` order, with plain column names. This is the processed Space file for accuracy evaluation.
- **`report.md`:** the short notification: counts per rung, then each crit and warn item in three lines.

Names of administrations come from [`spec/reference/administrations.json`](../../reference/administrations.json), and the rung wording from [`spec/rulebook/ladder.json`](../../rulebook/ladder.json). The rest of the wording is in [`spec/rulebook/report.json`](../../rulebook/report.json).

## In Space 3074

91 filings are reported: 51 need attention, 40 are worth a look. The first:

> **CSN-SSO** (124545403), China. Moving, orbit tilted 97.79°, up to 600 km up. Can be seen from Finland. Exceeds at a listed station: 42.76 dB over the limit (RR 21.16) at 90° above the horizon, on the frequencies of 356 listed stations.

`report.csv` has 196 rows.

## What goes in, what comes out

- **In:** every earlier space stage's result, and from the database `notice.adm`, `geo.sat_name`, `non_geo.sat_name`, `orbit.inclin_ang`, `orbit.apog_km`.
- **Out:** `report.json` ([schema](../../schemas/report.schema.json)) with the reported items in ladder order and the fingerprints of the two files, plus `report.csv` and `report.md`. CSV: a header row, comma-separated, RFC 4180 quoting, `\n` line endings, numbers in shortest form, empty for none. All three engines must write identical files.

## Finnish use (M4)

Each reported filing carries `finnish_use`, the uses Finland's national frequency allocation table (Traficom Radio Frequency Regulation 4) lists on its frequencies, as the ladder found them, and the licence-exempt ones. The notification names the first `uses_listed` of each; `report.csv` has two columns, "Finnish use (M4)" and "Licence-exempt use (M4)", with every use, separated by semicolons.
