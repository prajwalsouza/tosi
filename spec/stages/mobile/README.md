# Terrestrial stage 1: Land mobile

**The question:** is this a new foreign land mobile station?

## Why it comes first

Traficom asked for land mobile stations only: base stations (class `FB`) and land mobile stations (`ML`), as listed in the BR IFIC terrestrial preface. Fixed links and other services stay out. A station already in the Master Register is not new in this issue, and Finland's own filings are not foreign. Removing these first leaves only what the rest of the screen should work on.

## The rule

A station **goes on** if its filing is a new notice (`fxm_terra.stage` is `NOTICE`), it is not Finland's (`adm` is not `FIN`), and its class is `FB` or `ML`.

Otherwise it **leaves**, with the first of these reasons that is true:

1. **Recorded:** it is already in the Master Register, not a new notice.
2. **Finnish:** it is Finland's own filing.
3. **Not land mobile:** its class is something else.

The rule and the wording are in [`spec/rulebook/mobile.json`](../../rulebook/mobile.json).

## In Terrestrial 3076

| | Stations |
|---|---|
| Base stations (FB) and land mobile stations (ML) filed by others | 1,858 go on (994 FB, 864 ML) |
| Already recorded | 576 leave |
| Finland's own | 4 leave |
| Other classes (mostly fixed links) | 1,619 leave |

**1,858 of 4,057 stations go on.** Most come from Slovenia (1,127), Kazakhstan (412), China (194) and Russia (114).

## What goes in, what comes out

- **In:** the database and `intake.json`. Runs only on an accepted terrestrial filing.
- **Out:** `mobile.json` ([schema](../../schemas/mobile.schema.json)): every station as a compact row (`terrakey`, administration, class, frequency in MHz, longitude, latitude to three decimals, reason or null), so the map can show the whole file; and the counts.
- **Reads:** `fxm_terra.terrakey`, `adm`, `stn_cls`, `stage`, `freq_assgn`, `geo_key`; `fxm_geo.geo_key`, `long_dec`, `lat_dec`.

Rows are in ascending `terrakey` order. All three engines must write identical files.
