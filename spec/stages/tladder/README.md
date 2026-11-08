# Terrestrial stage 7: Ladder

**The question:** how worried should Finland be about each foreign station?

## What it does

Every station in the terrestrial file goes on exactly one rung. The rungs are tried in order, and the first that applies wins.

| Rung | Level | Applies when |
|---|---|---|
| Exceeds at the border | crit | Threshold says over, and Finland has not completed coordination |
| Listed station exposed | crit | Stations says exposed, and it is not "over but coordinated" |
| Near the trigger level | warn | Threshold says near (within 3 dB) |
| Exceeds, but coordinated: to verify | warn | Threshold says over, but Finland has completed coordination. Traficom asks for this to be verified, not closed |
| Cannot calculate | none | Data: power or height is missing |
| Out of scope | none | Land mobile: not a new foreign land mobile station |
| Clear | none | Range: too far, out of band or withdrawn; or Threshold: under |

The stage that decided each station is recorded. Within a rung the worst excess comes first, then the lowest `terrakey`. Rungs and wording are in [`spec/rulebook/tladder.json`](../../rulebook/tladder.json).

## In Terrestrial 3076

| Rung | Stations |
|---|---|
| Exceeds at the border | 1 |
| Listed station exposed | 0 |
| Near the trigger level | 0 |
| Exceeds, but coordinated: to verify | 5 |
| Cannot calculate | 0 |
| Out of scope | 2,199 |
| Clear | 1,852 |

**1 crit, 5 warn.** These are the same six stations the prototype flagged. The three stations Stations found exposed are all among them.

## What goes in, what comes out

- **In:** `mobile.json`, `range.json`, `tdata.json`, `threshold.json`, `tstations.json`, and Finland's national frequency allocation table (`spec/tables/m4.json`, Traficom Radio Frequency Regulation 4).
- **Out:** `tladder.json` ([schema](../../schemas/tladder.schema.json)): every station as a compact row (`fields`: terrakey, rung, the deciding stage, excess, listed stations over the trigger, Finnish use), in ladder order. The table's hash is in `tables.m4`.

## Finnish use (M4)

For every station over, over-but-coordinated or near the trigger, the ladder lists each use in the national frequency allocation table whose sub-band contains the station's frequency (ends included), once each, in table order, and separately the ones the table marks licence-exempt. Traficom asked for exceedances to cite the frequency table's use, licence-exempt use included. The rungs themselves do not change.
