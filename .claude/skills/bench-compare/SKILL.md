---
name: bench-compare
description: Compare two benchmark run CSVs (before/after a kernel change, or two machines) and report per-kernel gops deltas against the measurement noise. Use when the user wants to spot regressions or improvements between runs.
argument-hint: <before.csv> <after.csv>
---

Compare `$ARGUMENTS` (two paths, usually under `data/runs/<host>/`). If only one is given, ask for the other. Use the DuckDB CLI, which the repo already requires.

Rows match on `(kernel, device, precision, n, threads)`. `median_ms` and `stddev_ms` are per-config, so noise is `stddev_ms / median_ms`.

```sh
duckdb -markdown -c "
WITH a AS (SELECT * FROM read_csv('BEFORE')), b AS (SELECT * FROM read_csv('AFTER'))
SELECT a.kernel, a.device, a.precision, a.n, a.threads,
       round(a.gops, 2) AS before, round(b.gops, 2) AS after,
       round(100 * (b.gops - a.gops) / a.gops, 1) AS delta_pct,
       round(100 * greatest(a.stddev_ms / a.median_ms, b.stddev_ms / b.median_ms), 1) AS noise_pct
FROM a JOIN b USING (kernel, device, precision, n, threads)
ORDER BY abs(delta_pct) DESC"
```

Then report:

- **Regressions/improvements:** rows where `abs(delta_pct) > 2 * noise_pct` (anything inside that is within noise; say so rather than calling it a change). Group by kernel.
- **Unmatched rows:** configs present in only one file (`FULL OUTER JOIN` or `EXCEPT` on the key), since a changed sweep shape is not a regression.
- **Caveats:** different `device` or `host` values mean the comparison is cross-machine, not a code change. Note the `commit` column of each file when it isn't `unknown`.

Read-only: never write to `data/runs/`.
