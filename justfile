default:
    @just --list

bench *args='':
    cargo run --release --manifest-path benchmark/Cargo.toml -- {{args}}

dev:
    cd web && bun dev

build:
    cargo run --release --manifest-path benchmark/Cargo.toml
    cd web && bun run build

lint:
    cargo fmt --manifest-path benchmark/Cargo.toml
    cd web && bun run lint

check:
    cargo clippy --manifest-path benchmark/Cargo.toml --all-targets -- -D warnings
    cd web && bun run typecheck
