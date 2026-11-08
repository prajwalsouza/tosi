# Hosted Rust demo

Create a Render Docker Web Service from the Tosi deployment branch. Use the
free instance for the supplied samples and set the health check path to
`/healthz`. The Docker build downloads and verifies the two ITU sample
archives. The hosted engine selector offers Rust and shows TypeScript and
Python as unavailable. The Tests page has a saved local comparison and a
separate view for hosted Rust timings. Node still serves the UI.

Set these values in the service environment:

- `TOSI_STATIONS_GZIP_BASE64` is the base64-encoded gzip of the cleaned
  `state/reference/stations.json`. Provision this only in the authorized
  service's environment. The app writes it to its runtime directory.

Render sets `PORT`. The public demo runs the two supplied archives and reuses
sample runs. It accepts up to 20 run or benchmark requests per minute per
instance and a new benchmark at most once every five minutes. The free instance
can sleep, and its local run and report history is temporary.
