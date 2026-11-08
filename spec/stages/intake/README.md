# Stage 1: Intake

**The question:** what exactly is this file, what is inside it, and does it have what the rules need?

Every later stage trusts what intake says, so intake must be exact and must never guess.

## What goes in, what comes out

- **In:** one file, as it arrived (dropped, chosen, or loaded as a sample). Normally an ITU IFIC zip such as `ific3074.zip` (space) or `brific3076.zip` (terrestrial).
- **Out:** `intake.json`, matching [`spec/schemas/intake.schema.json`](../../schemas/intake.schema.json), plus the unpacked database for the next stage.

Intake never refuses by throwing an error. A file that cannot be used is a valid result: `check.status` is `refused` and `check.reason` says why in plain words.

## The five steps

### 1. Fingerprint

Read every byte of the file and compute its SHA-256 hash: 64 hexadecimal characters.

- **Why:** two files with the same bytes always have the same fingerprint, and changing a single byte changes it completely. This is what lets every result say exactly which file it came from, and lets Tosi recognise a file it has already processed.
- **Rule:** SHA-256 of the file exactly as received, before anything is unpacked or changed.
- **Example:** `ific3074.zip`, 60,837,631 bytes, fingerprint `c8adf750…16da721`.

### 2. Unpack

Open the zip and list what is inside: each entry's name, its size inside the zip (packed) and its real size. Extract the database (`.mdb`) and fingerprint it too.

- **Why:** the file's name says nothing reliable. What matters is what it contains.
- **Example:** `ific3074.zip` holds one entry, `ific3074.mdb`: 286,654,464 bytes, packed to about a fifth of that.
- **Refused if:** the file is not a zip, or the zip holds no `.mdb`.

### 3. Open the database

Read the database's catalogue: every user table (system tables starting `MSys` are left out), how many rows each holds, and its column names in stored order. Rows themselves are not read here.

- **Why:** the catalogue tells us what kind of file this is and whether the data we need is present, cheaply, before reading millions of rows.
- **Example:** Space 3074 has 88 tables and 5,174,625 rows. Terrestrial 3076 has 136 tables and 197,355 rows.

### 4. Recognise

Decide the kind of filing from the tables present, using the marker tables in [`spec/rulebook/intake.json`](../../rulebook/intake.json). A kind is recognised when all of its marker tables are present.

- **Space:** `notice`, `grp`, `emiss`, `s_beam`.
- **Terrestrial:** `fxm_terra`.
- **Neither:** the kind is `unknown` and the file is refused.

### 5. Check

Compare the tables and columns present with what later stages need for that kind, from the same rulebook file. Only tables switched on (`"read": true`) are checked, and only the columns listed for them. Every missing table or column is listed, in rulebook order.

The rulebook is edited in the guidebook. Each result records the rulebook's version and SHA-256 (`rulebook` in `intake.json`), so a result always says which rules decided it.

- **Accepted:** nothing is missing.
- **Refused:** something is missing; the reason names it.

## How each engine does it

All three follow these steps and must write identical `intake.json` files.

| Step | TypeScript | Rust | Python |
|---|---|---|---|
| Fingerprint | `node:crypto` | `sha2` | `hashlib` |
| Unpack | own zip reader + `node:zlib` | `zip` | `zipfile` |
| Database | `mdb-reader` | `jetdb` | `access-parser` |

The three database readers are independent implementations by different authors. When they agree, that agreement is evidence, not an accident of shared code.

## Ordering and precision

- Tables are listed in byte order of their names. Columns are listed in the order the table stores them.
- Sizes and counts are whole numbers. Fingerprints are lowercase hexadecimal.

## Progress

While it works, an engine reports progress on standard error, one JSON line per event, so the interface can show the steps as they happen:

```
{"event":"step","step":"fingerprint","state":"start","total":60837631}
{"event":"step","step":"fingerprint","state":"progress","done":16777216,"total":60837631}
{"event":"step","step":"fingerprint","state":"done","sha256":"c8adf750…"}
```

Progress is not part of the result and is never compared.
