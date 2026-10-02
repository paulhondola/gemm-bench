default:
    @just --list

bench *args='':
    cargo run --release --manifest-path benchmark/Cargo.toml -- {{args}}

# Names this machine for `just bench`, once: <github-login>/<machine>, e.g. octocat/m1pro.
init id:
    printf '%s\n' '{{id}}' > .host

# Validates data/runs/**/*.csv and data/peaks.csv and writes the JSON files the dashboard loads: results.json from the runs, peaks.json from the peaks.
data:
    duckdb -bail < data/build.sql

dev: data
    cd web && bun dev

build: build-bench build-web

build-bench:
    cargo build --release --manifest-path benchmark/Cargo.toml

build-web: data
    cd web && bun install && bun run build

test: test-bench test-web

test-bench:
    cargo test --manifest-path benchmark/Cargo.toml

test-web:
    cd web && bun test

lint: lint-bench lint-web

lint-bench:
    cargo fmt --manifest-path benchmark/Cargo.toml

lint-web:
    cd web && bun run lint:fix

check: check-bench check-web

check-bench:
    cargo clippy --manifest-path benchmark/Cargo.toml --all-targets -- -D warnings

check-web:
    cd web && bun run typecheck
