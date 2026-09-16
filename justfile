default:
    @just --list

bench *args='':
    cargo run --release --manifest-path benchmark/Cargo.toml -- {{args}}

# Merges every data/*.csv into the Parquet file the dashboard queries.
data:
    duckdb -c "COPY (SELECT * FROM read_csv('data/*.csv', union_by_name=true)) TO 'web/public/results.parquet' (FORMAT parquet, COMPRESSION zstd)"

dev: data
    cd web && bun dev

build: data
    cargo build --release --manifest-path benchmark/Cargo.toml
    cd web && bun install && bun run build

test:
    cargo test --manifest-path benchmark/Cargo.toml

lint:
    cargo fmt --manifest-path benchmark/Cargo.toml
    cd web && bun run lint:fix

check:
    cargo clippy --manifest-path benchmark/Cargo.toml --all-targets -- -D warnings
    cd web && bun run typecheck
