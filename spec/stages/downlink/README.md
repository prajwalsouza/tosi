# Stage 2: Downlink

**The question:** does this filing send signals down from space towards the ground?

## Why it comes first

A satellite can only interfere with radio users in Finland through what it transmits downwards. A group that only receives is listening, not sending, so it cannot cause interference here. A station on the ground (an earth station) is not part of this screen at all: whether it matters is a question of distance along the ground, which belongs to the terrestrial checks.

Removing these first means every later step works only on what could actually reach a receiver in Finland. It also means a filing that leaves gets the most basic reason: "it sends nothing down" says more than "it cannot be seen from Finland".

## What a space filing looks like

```
notice      one filing: a satellite network or an earth station
 └─ grp     its groups: each one a beam that either transmits (E) or receives (R)
```

- `notice.ntc_type` says what the filing is: `G` a satellite fixed in the sky, `N` a satellite that moves across the sky, `S` a station on the ground.
- `grp.emi_rcp` says whether a group transmits (`E`) or receives (`R`).

## The rule

A filing **goes on** if it is a satellite (`G` or `N`) and has at least one transmitting group. Only its transmitting groups go on with it.

Otherwise it **leaves**, with the first of these reasons that is true:

1. **Not a satellite:** it is a station on the ground.
2. **Nothing filed:** it is a satellite, but it files no groups at all.
3. **Receive only:** it is a satellite, but every group only receives.

The rule and the wording of the reasons are in [`spec/rulebook/downlink.json`](../../rulebook/downlink.json).

## In Space 3074

| | Filings |
|---|---|
| Satellites fixed in the sky that transmit | 70 go on |
| Moving satellites that transmit | 106 go on |
| Stations on the ground | 12 leave |
| Satellites that only receive | 6 leave |
| Satellites that file nothing | 2 leave |

**176 of 196 filings go on.** Of the 34,365 groups, only the transmitting groups of those 176 go on.

## What goes in, what comes out

- **In:** the database and `intake.json` from intake. Downlink runs only on an accepted space filing.
- **Out:** `downlink.json`, matching [`spec/schemas/downlink.schema.json`](../../schemas/downlink.schema.json): every notice with whether it went on and why, the counts, and the list of transmitting groups that go on.
- **Reads:** `notice.ntc_id`, `notice.ntc_type`, `grp.grp_id`, `grp.ntc_id`, `grp.emi_rcp`.

Notices are listed in ascending `ntc_id` order; groups in ascending `grp_id` order. All three engines must write identical files.
