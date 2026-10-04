set positional-arguments

default:
    @just --list

# "$@" passes each argument as typed: {{args}} would let sh strip Windows
# backslashes (.\configs\x.toml) and split paths at spaces.
bench *args:
    cargo run --release --manifest-path benchmark/Cargo.toml -- "$@"

# Names this machine for `just bench`, once: <github-login>/<machine>, e.g. octocat/m1pro.
init id:
    printf '%s\n' '{{id}}' > .host

# Checks every committed host database the way CI does.
validate:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    dbs=(data/db/*/*.sqlite)
    if (( ${#dbs[@]} )); then
        cargo run --quiet --manifest-path benchmark/Cargo.toml -- validate "${dbs[@]}"
    else
        echo "no host databases in data/db"
    fi

dev:
    cd web && bun dev

build: build-bench build-web

build-bench:
    cargo build --release --manifest-path benchmark/Cargo.toml

build-web:
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
