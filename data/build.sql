-- Validates every benchmark run and merges them into the JSON file the
-- dashboard loads. Run from the repo root: duckdb -bail < data/build.sql
-- -bail matters: without it DuckDB keeps executing after a failed check and
-- the COPY would still overwrite the JSON file.

CREATE VIEW runs AS
SELECT * FROM read_csv('data/runs/**/*.csv', union_by_name = true, filename = true,
    -- Explicit types stop e.g. a digit-only commit hash being read as a number,
    -- and pin the numeric columns so a malformed value in a contributed run
    -- file fails the read instead of sniffing as VARCHAR and silently
    -- widening the merged column (union_by_name) to VARCHAR.
    types = {'kernel': 'VARCHAR', 'backend': 'VARCHAR', 'device': 'VARCHAR',
             'precision': 'VARCHAR', 'host': 'VARCHAR', 'commit': 'VARCHAR',
             'timestamp': 'TIMESTAMPTZ', 'n': 'BIGINT', 'threads': 'BIGINT',
             'gops': 'DOUBLE', 'mean_rel_error_f64': 'DOUBLE',
             'median_ms': 'DOUBLE', 'min_ms': 'DOUBLE', 'stddev_ms': 'DOUBLE',
             'block_size': 'BIGINT', 'repetitions': 'BIGINT'});

-- union_by_name fills a column missing from one file with NULL instead of
-- failing, so required values are checked explicitly. block_size is exempt:
-- roadmap item 4 leaves it empty for kernels that don't use blocks.
CREATE TEMP TABLE _validation_failed AS
SELECT error('run files missing required values: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE kernel IS NULL OR backend IS NULL OR device IS NULL OR precision IS NULL
   OR n IS NULL OR threads IS NULL OR gops IS NULL OR mean_rel_error_f64 IS NULL
   OR median_ms IS NULL OR min_ms IS NULL OR stddev_ms IS NULL OR repetitions IS NULL
   OR host IS NULL OR commit IS NULL OR "timestamp" IS NULL
HAVING count(*) > 0;

-- JSON has no NaN or Infinity: DuckDB writes them bare and JSON.parse rejects
-- the whole file. They can't be rejected here instead, since the harness
-- records an infinite mean_rel_error_f64 on purpose (a kernel that produced
-- NaN), so every DOUBLE column writes them as null. isPlottable drops a row
-- whose plotted column is null.
COPY (
  SELECT * EXCLUDE (filename) REPLACE (
      CASE WHEN isfinite(gops) THEN gops END AS gops,
      CASE WHEN isfinite(mean_rel_error_f64) THEN mean_rel_error_f64 END AS mean_rel_error_f64,
      CASE WHEN isfinite(median_ms) THEN median_ms END AS median_ms,
      CASE WHEN isfinite(min_ms) THEN min_ms END AS min_ms,
      CASE WHEN isfinite(stddev_ms) THEN stddev_ms END AS stddev_ms)
  FROM runs
  ORDER BY host, "timestamp", precision, kernel, n, threads, block_size, repetitions
) TO 'web/public/results.json' (FORMAT json, ARRAY true);
