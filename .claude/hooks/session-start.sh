#!/bin/bash
# Installs what `just check`, `just test`, `just data` and the lefthook
# pre-commit hooks need in a Claude Code on the web session (Linux x86_64).
# Local machines follow the README's Prerequisites instead.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# A SessionStart hook's stdout becomes session context; keep install logs out of it.
exec 1>&2

cd "$CLAUDE_PROJECT_DIR"

JUST_VERSION=1.58.0
DUCKDB_VERSION=1.5.5 # keep equal to .github/workflows/ci.yml
LEFTHOOK_VERSION=2.1.15

BIN="$HOME/.local/bin"
mkdir -p "$BIN"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [[ "$("$BIN/just" --version 2>/dev/null)" != "just $JUST_VERSION" ]]; then
  curl -fsSL "https://github.com/casey/just/releases/download/$JUST_VERSION/just-$JUST_VERSION-x86_64-unknown-linux-musl.tar.gz" |
    tar -xz -C "$BIN" just
fi

if [[ "$("$BIN/duckdb" --version 2>/dev/null)" != "v$DUCKDB_VERSION "* ]]; then
  curl -fsSL -o "$TMP/duckdb.zip" "https://github.com/duckdb/duckdb/releases/download/v$DUCKDB_VERSION/duckdb_cli-linux-amd64.zip"
  unzip -oq "$TMP/duckdb.zip" -d "$BIN"
fi

if [[ "$("$BIN/lefthook" version 2>/dev/null)" != "$LEFTHOOK_VERSION" ]]; then
  curl -fsSL "https://github.com/evilmartians/lefthook/releases/download/v$LEFTHOOK_VERSION/lefthook_${LEFTHOOK_VERSION}_Linux_x86_64.gz" |
    gunzip >"$BIN/lefthook"
  chmod +x "$BIN/lefthook"
fi

# The nightly toolchain and components rust-toolchain.toml pins, if the image lacks them.
rustup toolchain install --no-update --no-self-update
cargo fetch --manifest-path benchmark/Cargo.toml

(cd web && bun install --frozen-lockfile)

"$BIN/lefthook" install
