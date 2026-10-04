# Windows Contributor Quick Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `just bench` passes Windows paths (`.\configs\x.toml`) through intact; x86 contributors can skip the `packed` f16 cells that took half of the first Windows sweep; and CI builds and tests on Windows on every PR.

**Architecture:** Three independent fixes that need no Rust changes:
- a `windows-latest` CI job;
- `set positional-arguments` with `"$@"` in the `bench` recipe;
- two TOML presets.

Recording Windows hardware (CPU, OS, GPU, tiers, caches) is the separate hwinfo PR, which lands after this one and relies on this PR's CI job.

**Tech Stack:** `just`, GitHub Actions `windows-latest`, TOML presets, Markdown docs.

**Spec:** None for this PR. It comes from the 2026-10-04 analysis of `data/db/dselement/ideapad5pro.sqlite`, summarized in Background below. The follow-up is specified in `docs/superpowers/specs/2026-10-04-hwinfo-modules-design.md`.

## Background

`data/db/dselement/ideapad5pro.sqlite` (one run, 2026-10-03, Lenovo IdeaPad Pro 5, AMD Ryzen 5 7535HS: Zen 3+, 6 cores / 12 threads, AVX2 + FMA3 + F16C, no AVX-512, Windows 11) shows:

1. **`cpu = 'unknown'`, `os = 'windows'`, no `core_tiers` or `caches` rows.** Windows hardware capture was never implemented. That is the hwinfo PR, not this one.
2. **The sweep took ~2× the M1 Pro's time.** Reconstructed from medians (each cell ≈ 6 × median: one warm-up plus five timed runs), the IdeaPad run cost ~16 h against the M1 Pro's ~7 h. `packed` and `rayon-packed` at f16 alone cost 8.4 h; every other kernel is within ~1.4× of the M1 Pro. The micro-kernel's `StdFloat::mul_add` (`benchmark/src/element.rs:90`) lowers to `llvm.fma.v8f16`; on x86 without AVX-512 FP16, LLVM splits it into 8 scalar `vcvtph2ps` → `vfmadd213ss` → `vcvtps2ph` sequences (checked with clang `-march=znver3`). `packed` f16 reaches 0.6 GOPS against 28 GOPS at f32 on the same laptop. The user decided: **leave the kernel unchanged; give x86 contributors presets that skip those cells.**
3. **`just bench --config .\configs\smoke.toml` failed on Windows** with `cannot read config '.configssmoke.toml'`. The backslashes were lost before the binary ran. The `bench` recipe pastes `{{args}}` unquoted into the line `just` runs with `sh` (Git Bash on Windows), and `sh` reads `\c` as an escaped `c`. The same command reproduces it on macOS. It isn't line endings or encoding: CRLF and UTF-8-with-BOM presets load fine.

## Global Constraints

- Branch `feat/windows-host`, from `main`.
- No schema change and no `KernelInfo` change. `data/schema.sql` stays byte-identical, and no kernel's label, backend, precisions, workers or declared params change.
- Never edit a host database. Throwaway runs go to `--output <scratch dir>/x.sqlite`.
- Lefthook runs fmt, clippy, tests, Biome, typecheck and validate on commit. Never bypass it.
- Run `just lint` (auto-fixes rustfmt and Biome) before every commit, and `just check && just test` before pushing.

## File Map

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | new `rust-windows` job: clippy and tests on `windows-latest` |
| `CLAUDE.md`, `README.md` | "CI is Linux" / "CI runs on Linux" become "CI runs Linux and Windows" |
| `justfile` | `bench` passes its arguments through `"$@"` (`set positional-arguments`), not re-parsed by `sh` |
| `configs/x86.toml`, `configs/x86-f16.toml` | new presets: the full sweep on x86 without `packed`/`rayon-packed` f16 |
| `benchmark/src/cli.rs` | the help text's preset list |
| `README.md` | the presets table |
| `web/src/docs/kernels/serial.md` | the `packed` section's "Watch for" note on x86 f16 |

---

### Task 1: Windows CI job

Lands first: it shows whether the existing tests pass on Windows before any Windows code is added.

**Files:**
- Modify: `.github/workflows/ci.yml` (new job between `rust` and `web`)

**Interfaces:**
- Consumes: nothing.
- Produces: the `Rust Nightly on Windows (Clippy, Test)` check, which the hwinfo PR relies on to run its Windows-only code and assertions.

- [x] **Step 1: Create the branch**

```bash
git switch -c feat/windows-host main
```

- [x] **Step 2: Add the job**

In `.github/workflows/ci.yml`, insert this job after the `rust` job's last step and before `  web:`. It skips formatting, which is platform-independent, and the database steps, which use bash-only syntax and run on Linux already.

```yaml
  rust-windows:
    name: Rust Nightly on Windows (Clippy, Test)
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust nightly toolchain
        uses: dtolnay/rust-toolchain@nightly
        with:
          components: clippy

      - name: Rust Cache
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: benchmark

      - name: Run Clippy
        run: cargo clippy --manifest-path benchmark/Cargo.toml --all-targets --all-features -- -D warnings

      - name: Run Tests
        run: cargo test --manifest-path benchmark/Cargo.toml
```

- [x] **Step 3: Update `CLAUDE.md` and `README.md`**

- In `CLAUDE.md`'s Metal gotcha, replace `compiled only locally (CI is Linux)` with `compiled only locally (CI runs Linux and Windows)`.
- In `README.md`, replace `CI runs on Linux, so the macOS-only Metal kernels` with `CI runs on Linux and Windows, so the macOS-only Metal kernels`.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md README.md
git commit -m "Run clippy and tests on Windows in CI

A contributor now benchmarks on Windows, and Linux CI never compiles the
Windows-only code paths."
```

- [x] **Step 5: Push and open a draft PR so CI runs**

CI only runs on pull requests to `main` and pushes to `main`.

```bash
git push -u origin feat/windows-host
```

```bash
gh pr create --draft --base main --title "Windows host support" --body "Draft: plan docs/superpowers/plans/2026-10-04-windows-host-support.md"
```

Expected: `Rust Nightly on Windows (Clippy, Test)` passes. **If it fails, stop and report the failing test and its output.** Those are existing Windows bugs. Fix them before the hwinfo PR, because its Windows code needs this job passing.

---

### Task 2: `just bench` keeps Windows paths intact

`{{args}}` is substituted into the recipe line before `sh` parses it, so `sh` strips backslashes and splits paths at spaces. With `set positional-arguments`, `just` hands the arguments to `sh` as `$1…$n`, and `"$@"` passes them through untouched. The `=''` default has to go too: with positional arguments, it would reach the binary as one empty-string argument.

**Files:**
- Modify: `justfile` (a setting at the top; the `bench` recipe)

**Interfaces:**
- Consumes: nothing.
- Produces: `just bench <args>` runs `gemm-bench <args>` with each argument byte-for-byte as typed. Every other recipe behaves as before.

- [x] **Step 1: Reproduce**

Run: `just bench --config '.\configs\quick.toml'`
Expected: FAIL with `cannot read config '.configsquick.toml'`. The backslashes are gone.

- [x] **Step 2: Fix the recipe**

Add as the justfile's first line, followed by a blank line:

```just
set positional-arguments
```

and replace

```just
bench *args='':
    cargo run --release --manifest-path benchmark/Cargo.toml -- {{args}}
```

with

```just
# "$@" passes each argument as typed: {{args}} would let sh strip Windows
# backslashes (.\configs\x.toml) and split paths at spaces.
bench *args:
    cargo run --release --manifest-path benchmark/Cargo.toml -- "$@"
```

- [x] **Step 3: Verify**

Run each and compare with the expected output:

| Command | Expected |
|---|---|
| `just bench --config '.\configs\quick.toml'` | `cannot read config '.\\configs\\quick.toml'`: the backslashes reach the binary (on macOS/Linux they aren't separators, so the file isn't found; on Windows it loads) |
| `just bench --config 'configs/no such.toml'` | `cannot read config 'configs/no such.toml'`: one argument, space intact |
| `just bench` | the usage text, as before (the binary runs with no arguments, not with `''`) |
| `just bench --config configs/quick.toml --output <scratch dir>/q.sqlite --no-progress` | ends with `Wrote … measurements to …` |

- [x] **Step 4: Commit and push**

```bash
git add justfile
git commit -m "Pass just bench arguments through intact

{{args}} was pasted into the recipe line before sh parsed it, so on
Windows .\\configs\\smoke.toml reached gemm-bench as .configssmoke.toml.
positional-arguments and \"\$@\" hand over each argument as typed."
git push
```

Then ask the contributor to run `just bench --config .\configs\smoke.toml` on the IdeaPad. Expected: it loads.

---

### Task 3: x86 presets that skip `packed` f16

A preset is one cross product of its keys, so "everything except `packed`/`rayon-packed` at f16" takes two presets.

**Files:**
- Create: `configs/x86.toml`, `configs/x86-f16.toml`
- Modify: `benchmark/src/cli.rs` (the `AFTER_HELP` preset list)
- Modify: `README.md` (presets section)
- Modify: `web/src/docs/kernels/serial.md` (`packed` "Watch for")

**Interfaces:**
- Consumes: `ConfigFile::load` through the existing `every_preset_parses` test.
- Produces: `configs/x86.toml`, `configs/x86-f16.toml`.

- [x] **Step 1: Create the presets**

`configs/x86.toml`:

```toml
# The full sweep on x86, minus f16; run x86-f16.toml for that half. Without
# AVX-512 FP16, packed and rayon-packed f16 split every fused multiply-add into
# scalar ones and took half of a full sweep's time on a Ryzen 5 7535HS.
precision = ["f32", "f64", "i32", "i64"]
```

`configs/x86-f16.toml`:

```toml
# The f16 half of the x86 sweep (see x86.toml): every CPU kernel but packed and
# rayon-packed. A fixed list, so a kernel added later must be added here.
precision = ["f16"]
kernel = ["naive-ijk", "ikj", "tiled", "rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"]
```

- [x] **Step 2: Run the preset test**

Run: `cargo test --manifest-path benchmark/Cargo.toml every_preset_parses`
Expected: PASS. It loads every `configs/*.toml` and resolves its kernel and precision names.

- [x] **Step 3: List the presets in the CLI help**

In `benchmark/src/cli.rs`'s `AFTER_HELP`, replace

```text
Presets in configs/: default, quick, precisions, knobs.";
```

with

```text
Presets in configs/: default, quick, precisions, knobs, x86, x86-f16.";
```

- [x] **Step 4: Document them in the README**

In `README.md`'s presets table, add after the `knobs.toml` row:

```markdown
| `x86.toml` | precisions `f32,f64,i32,i64` | Full sweep on x86, with `x86-f16.toml` |
| `x86-f16.toml` | `f16`, every CPU kernel but `packed` and `rayon-packed` | The f16 half of the x86 sweep |
```

and add this paragraph directly below the table:

```markdown
On x86 CPUs without AVX-512 FP16, `packed` and `rayon-packed` run `f16` dozens of times slower than `f32`, which took half of a full sweep's time on a Ryzen 5 7535HS. Sweep those hosts with `just bench --config configs/x86.toml`, then `just bench --config configs/x86-f16.toml`.
```

- [x] **Step 5: Note it in the kernel docs**

In `web/src/docs/kernels/serial.md`, in the `packed` section's `- **Watch for:**` bullet, append this sentence to the end of the bullet:

```markdown
 On x86 CPUs without AVX-512 FP16, `f16` collapses: LLVM splits each 8-lane fused multiply-add into 8 scalar `f32` ones with conversions, so a Ryzen 5 7535HS ran `packed` `f16` at 0.6 GOPS against 28 GOPS in `f32`. The `x86.toml` and `x86-f16.toml` presets sweep everything else.
```

- [x] **Step 6: Run everything**

Run: `just check && just test`
Expected: PASS (Rust tests plus `bun test`, which renders the kernel docs).

- [x] **Step 7: Commit and push**

```bash
git add configs/x86.toml configs/x86-f16.toml benchmark/src/cli.rs README.md web/src/docs/kernels/serial.md
git commit -m "Add x86 presets that skip packed f16

Without AVX-512 FP16, packed and rayon-packed f16 took 8.4 of a full
sweep's ~16 hours on a Ryzen 5 7535HS. The kernel stays unchanged: two
presets cover every other cell."
git push
```

Then mark the PR ready for review: `gh pr ready`.

---

## After Merge

- The contributor can run `just bench --config .\configs\smoke.toml` on the IdeaPad.
- **Hold off on rerunning into `data/db/dselement/ideapad5pro.sqlite` until the hwinfo PR merges**, so the rerun records the CPU, OS build, GPU, tiers and caches. Then sweep with `just bench --config configs/x86.toml` followed by `just bench --config configs/x86-f16.toml`.

## Follow-ups (not in this plan)

- **Windows hardware capture:** `docs/superpowers/specs/2026-10-04-hwinfo-modules-design.md`.
- **`peaks.csv` rows for the Ryzen 5 7535HS** (1 core: f32 145.6 and f64 72.8 GFLOPS) wait for the rerun, because `device` must match a recorded `runs.cpu`. They also need `engineLabel` in `web/src/lib/hardware.ts` fixed first, since it calls every peaked CPU's cores "P-cores".
- **`packed` on x86 runs at ~19% of the f32 peak, and `ikj` beats it.** `Element::Vector` is 128-bit (half an AVX2 register), and 24 accumulators exceed x86's 16 vector registers.
- **Presets saved as UTF-16** (Windows PowerShell 5.1's `>` and `Out-File`) fail with `stream did not contain valid UTF-8`. Nobody has hit it yet. If someone does, `ConfigFile::load` can decode UTF-16 behind its BOM with `String::from_utf16`.
