---
name: bench-compare
description: Compare two benchmark runs (before/after a kernel change, or two machines) and report per-kernel gops deltas against the measurement noise. Use when the user wants to spot regressions or improvements between runs.
argument-hint: <before.sqlite> [<after.sqlite>]
---

Compare two runs with the `sqlite3` CLI. `$ARGUMENTS` is one host database (compare its two latest runs) or two (compare each one's latest run). Read-only: never write to `data/db/`.

Cells match on `(kernel, precision, n, threads, swept params)`. `median_ms` and `stddev_ms` are per-cell, so noise is `stddev_ms / median_ms`.

```sh
sqlite3 -markdown BEFORE "
ATTACH 'AFTER' AS b;   -- for one database, use AFTER = BEFORE and pick the runs below
WITH cell AS (
  SELECT r.started_at, m.kernel, m.precision, m.n, m.threads, m.gops, m.median_ms, m.stddev_ms,
    (SELECT group_concat(name || '=' || value, ',' ORDER BY name) FROM params p
      WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS knobs
  FROM measurements m JOIN runs r USING (run_id)
  WHERE r.started_at = (SELECT max(started_at) FROM runs)),
after AS (
  SELECT r.started_at, m.kernel, m.precision, m.n, m.threads, m.gops, m.median_ms, m.stddev_ms,
    (SELECT group_concat(name || '=' || value, ',' ORDER BY name) FROM b.params p
      WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS knobs
  FROM b.measurements m JOIN b.runs r USING (run_id)
  WHERE r.started_at = (SELECT max(started_at) FROM b.runs))
SELECT a.kernel, a.precision, a.n, a.threads, a.knobs,
       round(a.gops, 2) AS before, round(z.gops, 2) AS after,
       round(100 * (z.gops - a.gops) / a.gops, 1) AS delta_pct,
       round(100 * max(a.stddev_ms / a.median_ms, z.stddev_ms / z.median_ms), 1) AS noise_pct
FROM cell a JOIN after z USING (kernel, precision, n, threads)
WHERE a.knobs IS z.knobs
ORDER BY abs(delta_pct) DESC"
```

For two runs of **one** database, replace the two `max(started_at)` subqueries with the two `started_at` values you're comparing (`SELECT started_at FROM runs ORDER BY started_at DESC LIMIT 2`).

Then report:

- **Regressions/improvements:** rows where `abs(delta_pct) > 2 * noise_pct` (anything inside that is within noise; say so rather than calling it a change). Group by kernel.
- **Unmatched cells:** cells present in only one run, since a changed sweep shape is not a regression.
- **Caveats:** compare `runs.cpu`, `gpu`, `target_features` and `rustc_version` of the two runs. A difference means the comparison is cross-machine or cross-build, not a code change. Note each run's `commit_id` when it isn't `unknown`.
