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

## The guidebook

- **The rulebook is the source; the guidebook is its editor.** It never keeps its own copy of the rules.
- **An outliner:** kinds of filing, then the tables the rules know, then each table's description and columns. Tables in the latest file that the rulebook does not know are listed separately and can be added with a tick.
- **Every change goes through the server's rulebook endpoint,** which writes the file, bumps the version and appends to `changes.jsonl`. History is shown as the last line of the outline.
- **A reason box** above the outline is attached to each change made while it is filled in.
