# Hosted Rust demo

Create a Render Docker Web Service from the Tosi deployment branch. Use the
free instance for the supplied samples and set the health check path to
`/healthz`. The Docker build downloads and verifies the two ITU sample
archives. The hosted engine selector offers Rust. Node still serves the UI.

Set these values in the service environment:

- `TOSI_DEMO_PASSWORD` is the browser login password. The username is `tosi`.
- `TOSI_STATIONS_GZIP_BASE64` is the base64-encoded gzip of the cleaned
  `state/reference/stations.json`. Provision this only in the authorized
  service's environment. The app writes it to its runtime directory.

Render sets `PORT`. The container starts in hosted mode, caps uploads at
64 MiB and the expanded database at 320 MiB, and blocks requests to open
server-local file paths. Share the password separately from the service URL.
The free instance can sleep, and its local run and report history is temporary.
