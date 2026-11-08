# Interface

Written once in TypeScript and plain JavaScript, served as a web app by `server.ts`. Reads engine answers and stage outputs only, so it works with any engine.

- `server.ts`: starts engines as separate processes and serves `public/`.
- `public/`: the page. A floating, collapsible sidebar; Settings at the bottom, with an Engines page showing each engine's status and which one is in use.

Coming: the Story, the report, and views (outline, table, map). Every view will export.
