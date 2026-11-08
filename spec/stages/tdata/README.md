# Terrestrial stage 3: Data

**The question:** is everything the field strength needs filed?

## The rule

A station **goes on** with a position, a transmit power and an antenna height.

- **Power** is the highest power filed on a transmitting antenna row (`fxm_ant`, `tx_rx` TX or blank). An e.i.r.p. (`pwr_eiv` = `I`) has 2.15 dB taken off to give e.r.p.; any other reference is used as e.r.p. and recorded as an assumption.
- **Effective height** is the filed effective height (`eff_hgtmax`), else the highest effective height by direction (`fxm_ant_hgt`), else the height above ground (`hgt_agl`) as if the ground were flat. A land mobile station (`ML`) with none of these is taken at 3 m, a vehicle antenna (administration policy, recorded as an assumption).

Otherwise it **leaves** as **cannot calculate**, with the first missing item: position, power, height.

## In Terrestrial 3076

All 57 stations in range go on. 31 file an effective height, 17 are taken from their height above ground, and 9 mobiles take the 3 m default.

## What goes in, what comes out

- **In:** `range.json` and the database.
- **Out:** `tdata.json` ([schema](../../schemas/tdata.schema.json)): per station, e.r.p. (dBW), effective height (m), where the height came from, and the assumptions made.
- **Reads:** `fxm_ant.terrakey`, `ant_key`, `pwr_dbw`, `pwr_eiv`, `tx_rx`, `hgt_agl`, `eff_hgtmax`; `fxm_ant_hgt.terrakey`, `eff_hgt`.
