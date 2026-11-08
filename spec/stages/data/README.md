# Stage 5: Data

**The question:** is everything needed to work out the power filed?

## Why it comes here

The next steps work out how much power could arrive in Finland. That needs four things from the filing. When one is missing, the honest answer is **cannot calculate**: not clear, not a breach, but something a person should look at (guidebook MD-9).

## The rule

For each row from Limit (a group and a limit that applies to it), these must all be filed, checked in this order:

1. **Where the satellite is:** its longitude if fixed in the sky, or the lowest perigee of its orbits if it moves.
2. **The antenna's gain:** for the beam the group transmits through.
3. **A power:** the peak power or the power density. A limit on total power needs the peak power.
4. **A usable limit:** at least one part of the limit's mask that needs no values from outside the filing.

A row missing something gets the first missing item. A filing goes on if at least one row is complete; otherwise it leaves with the first reason, in that order, that any of its rows had.

The reasons and their wording are in [`spec/rulebook/data.json`](../../rulebook/data.json).

## In Space 3074

| | Filings |
|---|---|
| Everything filed | 111 go on |
| No usable position or orbit | 9 leave |

The 9 are the satellites around the Moon, the Sun and Jupiter, and the one with no orbit filed. **111 of 120 filings go on**, with 13,765 of 13,839 rows.

## What goes in, what comes out

- **In:** the database, `intake.json`, `reach.json` and `limit.json`.
- **Out:** `data.json`, matching [`spec/schemas/data.schema.json`](../../schemas/data.schema.json): every filing with a limit, complete or why not, counts of rows by what they miss, and the complete rows in the same form as Limit's.
- **Reads:** `grp.grp_id`, `grp.beam_name`, `s_beam.ntc_id`, `s_beam.beam_name`, `s_beam.emi_rcp`, `s_beam.gain`, `emiss.grp_id`, `emiss.pep_max`, `emiss.pwr_ds_max`, `orbit.ntc_id`, `orbit.perig_km`, and Reach's longitude.

All three engines must write identical files.
