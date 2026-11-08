# Terrestrial stage 5: Threshold

**The question:** is the signal at Finland's border over the trigger level?

## The rule

The trigger level is ECC Recommendation T/R 25-08, Annex 1, A1.2.3, for the station's band, in a 25 kHz reference bandwidth:

| Band (MHz) | dB(µV/m) |
|---|---|
| 29.7–47 | 0 |
| 47–108 | 6 |
| 108–380 | 12 |
| 380–400 | 18 |
| 400–470 | 20 |
| above 470 | 20 (the 400–470 MHz level, as Traficom said) |

A channel wider than 25 kHz adds 10·log10(width / 25 kHz). The station is:

- **over** if its field strength is above the level;
- **over, coordinated:** over, but Finland has completed coordination for it. This is a case to verify, never closed;
- **near** if under by less than 3 dB (administration policy);
- **under** otherwise.

## In Terrestrial 3076

| | Stations |
|---|---|
| Over | 1 (Russia, 152.9 MHz, 9.0 dB over) |
| Over, coordinated with Finland | 5 |
| Near | 0 |
| Under | 51 |

## What goes in, what comes out

- **In:** `field.json` and the database.
- **Out:** `threshold.json` ([schema](../../schemas/threshold.schema.json)): per station, the trigger level, the bandwidth correction, the margin (field strength minus level, dB), the outcome and whether Finland has coordinated it.
- **Reads:** `fxm_terra.freq_assgn`, `bdwdth_cde`, `bdwdth`; `fxm_coord.terrakey`, `adm`, `coord_st`.
