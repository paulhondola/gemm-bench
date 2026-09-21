---
name: bench-sweep
description: Run a named benchmark sweep preset (cache-locality, parallel-scaling, multi-precision, mps, smoke) via `just bench`. Use when the user asks to run a benchmark sweep or one of these comparisons.
argument-hint: <preset> [extra just-bench flags]
disable-model-invocation: true
---

Run the preset named in `$ARGUMENTS` from the repo root. Any extra flags after the preset name are appended and override the preset's.

| Preset | Command |
| :--- | :--- |
| `smoke` | `just bench --sizes 256,512 --kernel ikj,rayon-ikj --no-progress` |
| `cache-locality` | `just bench --sizes 128,256,512,1024 --kernel naive,ikj,tiled` |
| `parallel-scaling` | `just bench --sizes 512,1024,2048 --threads 1,2,4,8,10 --kernel rayon-ikj,static-ikj --repetitions 5` |
| `multi-precision` | `just bench --sizes 512,1024 --kernel ikj,rayon-ikj --precision f16,f32,f64,i32,i64` |
| `mps` | `just bench --sizes 256,512,1024,2048 --kernel mps --precision f16,f32` (macOS Apple Silicon only) |

Rules:

- **Output goes to committed data.** By default a run writes `data/runs/<host>/<timestamp>.csv`. Say so before running, and if the user wants a throwaway run, add `--output /tmp/<preset>.csv`.
- **Threads:** `parallel-scaling` lists thread counts up to 10. Tell the user to adjust `--threads` to the machine's core count (`sysctl -n hw.ncpu`). `static-*` kernels error if `--threads` exceeds the smallest `--sizes`.
- Never widen a preset to the default full sweep (`naive-ijk` at N=4096 takes minutes) unless the user asks.
- If the preset name is missing or unknown, list the presets above and stop.
- After the run, report the output path the CLI prints and the top few rows by `gops`. To compare against an earlier run, point the user at `/bench-compare`.
