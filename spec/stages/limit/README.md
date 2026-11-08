# Stage 4: Limit

**The question:** is there an international limit for what this satellite sends towards Finland?

## Why it comes here

A satellite can only break a limit that exists. The Radio Regulations set limits on how much satellite power may arrive on the ground, but only in some frequency bands, for some kinds of station, for filings received in some periods, and protecting some parts of the world. A filing that no limit covers leaves here with **no applicable limit**. That is one of the three outcomes the guidebook keeps apart (MD-9), and it is not the same as clear.

Limit runs on the filings Reach found can be seen from Finland, one transmitting group at a time.

## The rule

Each transmitting group is matched against the ITU's limit tables (`spec/tables/pfd.json`, the Radiocommunication Bureau's tables for Article 21 and Appendix 5). A limit applies when all of these hold:

1. **Frequency:** its band overlaps the group's span, from its lowest to its highest filed frequency.
2. **Kind of station:** they share a station class, such as `EB` for broadcasting-satellite.
3. **Date:** the group's date of protection, or the date the ITU received the filing, lies within the limit's dates. With no date, every date matches.
4. **Orbit,** moving satellites only: the steepest tilt and highest apogee lie within the limit's windows. With no orbit filed, every window matches; the Data step then stops the filing.
5. **Area:** the limit protects an area that includes Finland, such as all the world or Region 1. Limits protecting only countries named in a footnote are not applied (guidebook L-3), and are counted.

Limits stated against orbital separation protect other satellites, not the ground, and are skipped. Every match of a group and a limit is a **row**. A filing goes on if it has at least one row.

The area list, the matching and the wording of each outcome are in [`spec/rulebook/limit.json`](../../rulebook/limit.json).

## In Space 3074

| | Filings |
|---|---|
| A limit applies (30 fixed in the sky, 90 moving) | 120 go on |
| No limit covers their frequencies (5 fixed, 13 moving) | 18 leave |

**120 of 138 filings go on**, with 10,598 of their 15,162 transmitting groups and 13,839 rows. 1,159 more matches protected only named countries and were not applied.

## What goes in, what comes out

- **In:** the database, `intake.json`, `downlink.json` and `reach.json`.
- **Out:** `limit.json`, matching [`spec/schemas/limit.schema.json`](../../schemas/limit.schema.json): every filing Reach saw, whether a limit applies and why not, the counts, and the rows as `[grp_id, ntc_id, table, exam row, provision]`, where table is `G` (fixed) or `N` (moving).
- **Reads:** `notice.ntc_id`, `notice.d_rcv`, `grp.grp_id`, `grp.ntc_id`, `grp.beam_name`, `grp.d_prot_eff`, `freq.grp_id`, `freq.freq_mhz`, `freq.freq_min`, `freq.freq_max`, `srv_cls.grp_id`, `srv_cls.stn_cls`, `orbit.ntc_id`, `orbit.inclin_ang`, `orbit.apog_km`, `orbit.perig_km`.

Dates are compared as `YYYYMMDD`; a date in or before 1900 counts as none. Notices are in ascending `ntc_id` order; rows by `grp_id`, then table, exam row and provision. All three engines must write identical files.
