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

# Tag of a GitHub repo's latest release, read from the redirect of its
# releases/latest/download URL (the GitHub API is not reachable from here).
latest_tag() {
  curl -fsS -o /dev/null -w '%{redirect_url}' "https://github.com/$1/releases/latest/download/x" | cut -d/ -f8
}

BIN="$HOME/.local/bin"
mkdir -p "$BIN"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

tag=$(latest_tag casey/just)
if [[ "$("$BIN/just" --version 2>/dev/null)" != "just $tag" ]]; then
  curl -fsSL "https://github.com/casey/just/releases/download/$tag/just-$tag-x86_64-unknown-linux-musl.tar.gz" |
    tar -xz -C "$BIN" just
fi

tag=$(latest_tag duckdb/duckdb)
if [[ "$("$BIN/duckdb" --version 2>/dev/null)" != "$tag "* ]]; then
  curl -fsSL -o "$TMP/duckdb.zip" "https://github.com/duckdb/duckdb/releases/download/$tag/duckdb_cli-linux-amd64.zip"
  unzip -oq "$TMP/duckdb.zip" -d "$BIN"
fi

tag=$(latest_tag evilmartians/lefthook)
if [[ "v$("$BIN/lefthook" version 2>/dev/null)" != "$tag" ]]; then
  curl -fsSL "https://github.com/evilmartians/lefthook/releases/download/$tag/lefthook_${tag#v}_Linux_x86_64.gz" |
    gunzip >"$BIN/lefthook"
  chmod +x "$BIN/lefthook"
fi

# The channel rust-toolchain.toml selects; installs it or updates it to the latest nightly.
rustup update nightly
cargo fetch --manifest-path benchmark/Cargo.toml

(cd web && bun install --frozen-lockfile)

"$BIN/lefthook" install
