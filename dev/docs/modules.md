# Module rules

The shape every part of Tosi follows. These rules grow as each part is built.

## Engines

- **One entry point per engine**, started the same way the server starts it, as listed in [`engines/engines.json`](../../engines/engines.json).
- **The same commands in every engine.** The first command is `info`. Stage commands come later, each defined in `spec/` before any engine implements it.
- **JSON on standard output, nothing else.** Every command prints one JSON document that matches its schema in `spec/schemas/`. Logs and progress go to standard error.
- **Exit codes:** `0` success, `1` the command ran and failed (with a JSON error on standard error), `2` the command was not understood.
- **The spec version is read, not typed.** Each engine reads `spec/VERSION` and reports it, so an engine built against an older spec is visible.
- **No engine imports another.** Engines share only the spec and the files stages write.
- **Few dependencies.** Each dependency is named in the decisions log with its reason.

- A stage reads the previous stage's files in the run folder (`--in <folder>`) and writes its own JSON there. Downlink reads `database.mdb` and writes `downlink.json`.

## The server

- Starts engines as separate processes, using `engines/engines.json` only.
- Never contains stage logic. It passes inputs to an engine and serves what the engine wrote.

## The interface

- **Plain files, no build.** `ui/public/` holds `index.html`, `design-tokens.css`, `theme-tokens.css`, `style.css`, `app.js` and `icons.js`, served as they are.
- **Two token files, never mixed.** `design-tokens.css` holds what every theme shares: type, spacing, radii, sizes, motion. `theme-tokens.css` holds what a theme decides: colours, surfaces, shadows, borders, skeleton colours. `style.css` uses tokens only, never a raw colour.
- **Themes:** Matte Black (default), Pitch Black, Clean Minimalist, Blackboard, Neumorphism, Textbook Light, Textbook Dark. A theme may also set fonts: `--font` for text and `--font-display` for headings, names and key figures (Textbook uses Literata and Nunito; the rest use Poppins). Each is a `[data-theme]` block in `theme-tokens.css` plus one entry in `THEMES` in `app.js`. The theme is applied in `<head>` before the page draws, so there is no flash.
- **Hover and selection are shown by colour only.** Text and icon colour change; selected items also take the accent on their icon. No background highlights.
- **Text beside an icon is trimmed** (`.label`, `.t`: `text-box: trim-both cap alphabetic`) so Poppins' tall built-in spacing doesn't push it off-centre.
- **A floating sidebar on the left,** collapsible to icons (button or the `[` key), remembered between visits. Main sections sit at the top; Settings sits at the bottom.
- **Routes are hashes:** `#/` is home, `#/settings/<page>` is a settings page. A new settings page is one entry in the `SETTINGS` list in `app.js`.
- **The engine in use** is chosen on Settings → Engines, remembered between visits, and shown at the foot of the sidebar with its status dot.
- **Icons are Font Awesome Free,** kept as SVG files in `ui/public/icons/` and turned into `icons.js`. No text buttons where an icon says it; every icon has a label for screen readers.
- **Poppins** is loaded from Google Fonts; the system font is the fallback when offline.
- **The sidebar has no border.** Its own background (`--panel`) sets it apart from the page. Every sidebar row shares one 20px icon column, so icons line up open and centre when collapsed. The collapse chevrons are light and small.
- **Loading is always a skeleton.** Anything that waits shows shimmering placeholders shaped like what will arrive (`.sk`, `.sk.line`, `.sk.dot`, `.sk.title`), never "Loading…" or "Asking…" text. Longer work also gets a shimmer across the area it affects.
- **The Tosi mark** (`ui/public/icons/tosi.svg`): a satellite on its arc above the horizon. It is also the tab icon.
- **Every page starts level with the sidebar's first row.** `main` begins at the same height as the sidebar's top row, and a page's first heading is one row tall (`--row`) with trimmed text, so the Tosi mark, its name, the collapse chevron and the page heading share one centre line, open or collapsed.
- **Collapsing the sidebar only hides the sidebar's own labels** (`body.shut #side .label`). Page labels never depend on the sidebar's state.

## The guidebook and the algorithm

- **Two sources in the spec.** `spec/guidebook/guidebook.json` is the constitution: principles (P), concerns (C), methods (M), data rules (D), known limits (L), the concern ladder, and the steps of the algorithm with the entries each applies and the tables each needs. `spec/rulebook/intake.json` is what intake reads. Both are the rules modules follow; neither holds conversation, names or quotes.
- **Guidebook page:** the constitution as an outliner. Each entry opens to its rule, why, effect and basis, and links to the steps that apply it and the ladder rungs it decides.
- **Algorithm page:** the steps in order for each kind of filing. Each step shows the entries it applies and the tables it needs. Under "Relevant tables", each table says which steps need it; tables later steps need but intake does not read yet are listed first among the rest.
- **No bare switches.** Starting or stopping reading a table is a deliberate action that requires a reason, kept with the change. Marker tables are always read.
- **Every change goes through the server's rulebook endpoint,** which writes the file, bumps the version and appends to `changes.jsonl`.
- **Outliners have no vertical guide lines.** Nesting shows by indentation and chevrons.

## The MCP server

- **A client of the local server, nothing more.** It holds no state and computes nothing; every tool calls the same API the interface uses.
- **Read tools are marked read-only.** Tools that start work return a run id; `tosi_wait_run` follows it.
- **No tool changes a rule or a result.** Changes are proposals with a reason, decided by a person.

## The library

- **Every processed file gets a record** in `library/` (this machine only, never committed): the file and its fingerprint, the engine and its time, the rulebook version and fingerprint that decided it, and what was found. Dropped files are kept once per fingerprint in `library/files/`, so they can be processed again.
- **The Library page** lists the records with filters at the top (kind of filing, outcome, search). A record opens to say, in plain words, what was found. Accepted files offer "See it in the Flow" and "Process again" as clear buttons; files that were turned away offer neither.
- **The Flow shows the process only.** There are no file tabs in it; files are found in the Library.
