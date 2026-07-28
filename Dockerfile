FROM rust:1.80-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -yqq \
    cmake gcc libpq-dev bzip2

COPY . .

RUN cargo build --release --no-default-features

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libpq-dev && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/chupkarivy /usr/local/bin/chupkarivy

ENTRYPOINT ["/usr/local/bin/chupkarivy"]
