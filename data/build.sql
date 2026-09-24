-- Validates every benchmark run and merges them into the Parquet file the
-- dashboard queries. Run from the repo root: duckdb -bail < data/build.sql
-- -bail matters: without it DuckDB keeps executing after a failed check and
-- the COPY would still overwrite the Parquet file.

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

COPY (
  -- The BLAS kernel was `accelerate` before `accelerate-bnns` joined it;
  -- publish old runs under the new name so they share one series.
  SELECT CASE kernel WHEN 'accelerate' THEN 'accelerate-blas' ELSE kernel END AS kernel,
         backend, device, precision, n, threads,
         gops,
         -- Runs before accuracy measurement landed wrote a 0.0 placeholder,
         -- which would read as "exact"; publish it as unknown instead.
         -- ponytail: keyed on the date, so an old binary run later still
         -- writes 0.0; key on commit if contributors lag behind.
         CASE WHEN "timestamp" < TIMESTAMPTZ '2026-09-24 00:00:00+00' THEN NULL
              ELSE mean_rel_error_f64 END AS mean_rel_error_f64,
         median_ms, min_ms, stddev_ms,
         block_size, repetitions, host, commit, "timestamp"
  FROM runs
  ORDER BY host, "timestamp", precision, kernel, n, threads, block_size, repetitions
) TO 'web/public/results.parquet' (FORMAT parquet, COMPRESSION zstd);
