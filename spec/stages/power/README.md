# Stage 6: Power

**The question:** how much power could this satellite send towards Finland?

## Worst case, always

Traficom ruled that beam shapes are not used: every antenna is taken to point straight at Finland. So the power towards Finland is the satellite's power plus the **full gain** of its antenna, its e.i.r.p.

## The rule

Each limit is stated in a reference bandwidth, for example per 4 kHz or per 1 MHz. For each complete row from Data, the power in that bandwidth comes from the filed peak power and power density, by the rule of Recommendation ITU-R SF.675 as the Radiocommunication Bureau applies it:

- a limit on total power uses the peak power;
- otherwise the density times the reference bandwidth, or the peak power, whichever the rule picks for the emission's width and the averaging bandwidth (4 kHz below 15 GHz, 1 MHz above).

Then **e.i.r.p. = that power + the antenna's gain**. Each emission of the group is tried, and the most power is kept.

Every step and constant is in [`spec/rulebook/power.json`](../../rulebook/power.json).

## In Space 3074

All **13,765 rows** of the 111 filings get a power. The strongest reach 65 dBW in their reference bandwidth.

## What goes in, what comes out

- **In:** the database, `intake.json` and `data.json`.
- **Out:** `power.json`, matching [`spec/schemas/power.schema.json`](../../schemas/power.schema.json): each filing's highest e.i.r.p., and each row with its e.i.r.p. in dBW.
- **Reads:** `grp.grp_id`, `grp.beam_name`, `s_beam.gain`, `freq.freq_mhz`, `freq.freq_min`, `freq.freq_max`, `emiss.grp_id`, `emiss.design_emi`, `emiss.pep_max`, `emiss.pwr_ds_max`.

All three engines must write identical files.
