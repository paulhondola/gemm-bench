default:
    @just --list

bench *args='':
    cargo run --release --manifest-path benchmark/Cargo.toml -- {{args}}

# Validates data/runs/**/*.csv and merges it into the Parquet file the dashboard queries.
data:
    duckdb -bail < data/build.sql

dev: data
    cd web && bun dev

build: build-bench build-web

build-bench:
    cargo build --release --manifest-path benchmark/Cargo.toml

build-web: data
    cd web && bun install && bun run build

test:
    # No test-web: `bun test` fails with no test files in web/.
    cargo test --manifest-path benchmark/Cargo.toml

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
