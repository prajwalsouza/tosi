# syntax=docker/dockerfile:1
FROM rust:1.91-bookworm AS rust-build
WORKDIR /app/engines/rust
COPY engines/rust/Cargo.toml engines/rust/Cargo.lock ./
COPY engines/rust/src ./src
RUN cargo build --locked --release

FROM node:24-bookworm-slim
WORKDIR /app
COPY engines/ts/package.json engines/ts/package-lock.json ./engines/ts/
# The web UI still uses mdb-reader for filing details.
RUN npm ci --omit=dev --prefix engines/ts && npm cache clean --force
COPY package.json ./
COPY engines/engines.json engines/chain.json ./engines/
COPY spec ./spec
COPY ui ./ui
# Rust resolves its reference files relative to the compile-time manifest directory.
COPY --from=rust-build /app/engines/rust/target/release/tosi ./engines/rust/target/release/tosi
RUN mkdir -m 0755 /app/samples
ADD --checksum=sha256:c8adf75044bca9d6a2be4213d051805f1b0a88d716fb184bcb1cd812216da721 https://www.itu.int/sns/ific10/ific3074.zip /app/samples/ific3074.zip
ADD --checksum=sha256:ba9d0605a4a5494162e17650c290401d84deaef29030cbdbb61e4b00c834c4c2 https://www.itu.int/en/ITU-R/terrestrial/brific/BRIFIC/MDB/brific3076.zip /app/samples/brific3076.zip
RUN chmod 0755 /app/samples && chmod 0444 /app/samples/*.zip && chown node:node /app
USER node
RUN test -r /app/samples/ific3074.zip && test -r /app/samples/brific3076.zip
ENV TOSI_HOSTED=1 TOSI_RUNS=/app/runs TOSI_MAX_DATABASE_BYTES=335544320
CMD ["node", "--max-old-space-size=144", "ui/server.ts"]
