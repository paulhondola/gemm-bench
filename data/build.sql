-- Validates every benchmark run and the hardware peaks, and writes the two
-- JSON files the dashboard loads. Run from the repo root:
-- duckdb -bail < data/build.sql
-- -bail matters: without it DuckDB keeps executing after a failed check and
-- the COPYs would still overwrite the JSON files.

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
             'gpu_ms': 'DOUBLE', 'setup_ms': 'DOUBLE',
             'block_size': 'BIGINT', 'repetitions': 'BIGINT'});

-- union_by_name fills a column missing from one file with NULL instead of
-- failing, so required values are checked explicitly; a run file from before
-- setup_ms existed fails here. block_size is exempt: roadmap item 4 leaves it
-- empty for kernels that don't use blocks. gpu_ms is checked below.
CREATE TEMP TABLE _validation_failed AS
SELECT error('run files missing required values: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE kernel IS NULL OR backend IS NULL OR device IS NULL OR precision IS NULL
   OR n IS NULL OR threads IS NULL OR gops IS NULL OR mean_rel_error_f64 IS NULL
   OR median_ms IS NULL OR min_ms IS NULL OR stddev_ms IS NULL OR setup_ms IS NULL
   OR repetitions IS NULL OR host IS NULL OR commit IS NULL OR "timestamp" IS NULL
HAVING count(*) > 0;

-- gpu_ms is the GPU window inside a Metal round trip, so it is set on exactly
-- the Metal rows: without it the row's timings can't be told apart from a
-- GPU-only measurement, and a CPU row has no GPU window to report.
CREATE TEMP TABLE _gpu_ms_misplaced AS
SELECT error('gpu_ms must be set on exactly the metal rows: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE (backend = 'metal') <> (gpu_ms IS NOT NULL)
HAVING count(*) > 0;

-- Unlike the run files, peaks.csv is hand-curated: every value in it was typed
-- in by someone, so a bad one fails the build rather than becoming null. The
-- peaks checks run before either COPY, so a bad peak writes neither file.
--
-- The file has one fixed shape, so nothing about it is sniffed: a sniffer
-- matches column names case-insensitively (a GFLOPS header would reach the
-- JSON as "GFLOPS"), and a row with a stray comma makes it give up on the
-- whole file without naming the row. The header is checked exactly here, and
-- the strict read below names the line of any row with the wrong field count.
CREATE TEMP TABLE _peaks_header AS
SELECT error('data/peaks.csv must start with the header device,backend,precision,cores,gflops,source')
FROM read_text('data/peaks.csv')
WHERE rtrim(ltrim(split_part(content, chr(10), 1), chr(65279)), chr(13))
      <> 'device,backend,precision,cores,gflops,source'
HAVING count(*) > 0;

CREATE VIEW peaks AS
SELECT * FROM read_csv('data/peaks.csv', auto_detect = false, header = true,
    delim = ',', quote = '"', escape = '"',
    -- cores is read as text: a BIGINT cast rounds, so a typo like 0.5 would
    -- become a real 1-core ceiling. It is checked as a whole number below.
    columns = {'device': 'VARCHAR', 'backend': 'VARCHAR', 'precision': 'VARCHAR',
               'cores': 'VARCHAR', 'gflops': 'DOUBLE', 'source': 'VARCHAR'});

-- Names a peaks row in an error message. coalesce keeps a NULL field from
-- blanking the whole message, since || with NULL yields NULL.
CREATE MACRO peak_name(d, b, p, c) AS
    concat_ws('/', coalesce(d, 'NULL'), coalesce(b, 'NULL'), coalesce(p, 'NULL'),
              coalesce(CAST(c AS VARCHAR), 'NULL'));

-- A ceiling without a cited source can't be checked, so a blank source counts
-- as missing. trim strips only spaces and \s only ASCII whitespace, so the
-- regex also covers a pasted no-break or zero-width space. The dashboard maps
-- families only to cpu and metal peaks, so any other backend would sit unused.
-- isfinite is needed because DuckDB orders NaN above every number, so
-- gflops <= 0 alone would let it through.
CREATE TEMP TABLE _peaks_invalid AS
SELECT error('data/peaks.csv rows need every value, a non-blank source, backend cpu or metal, '
             || 'a whole number of cores >= 1 and a finite gflops > 0: '
             || string_agg(DISTINCT peak_name(device, backend, precision, cores), ', '))
FROM peaks
WHERE device IS NULL OR backend IS NULL OR precision IS NULL OR cores IS NULL
   OR gflops IS NULL OR source IS NULL OR regexp_full_match(source, '[\s\p{Z}\p{C}]*')
   OR backend NOT IN ('cpu', 'metal') OR NOT regexp_full_match(cores, '[1-9][0-9]{0,5}')
   OR NOT isfinite(gflops) OR gflops <= 0
HAVING count(*) > 0;

-- The dashboard picks one row per core count, so two rows for the same
-- ceiling would leave the one it draws up to file order.
CREATE TEMP TABLE _peaks_duplicated AS
SELECT error('data/peaks.csv lists a ceiling more than once: ' || string_agg(name, ', '))
FROM (SELECT peak_name(device, backend, precision, cores) AS name
      FROM peaks
      GROUP BY device, backend, precision, cores
      HAVING count(*) > 1)
HAVING count(*) > 0;

-- A peak is drawn against the runs it shares device, backend and precision
-- with, so a typo in any of them would silently draw no ceiling.
CREATE TEMP TABLE _peaks_unmatched AS
SELECT error('data/peaks.csv rows match no run on device, backend and precision: '
             || string_agg(DISTINCT peak_name(device, backend, precision, cores), ', '))
FROM peaks
ANTI JOIN (SELECT DISTINCT device, backend, precision FROM runs) USING (device, backend, precision)
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
      CASE WHEN isfinite(stddev_ms) THEN stddev_ms END AS stddev_ms,
      CASE WHEN isfinite(gpu_ms) THEN gpu_ms END AS gpu_ms,
      CASE WHEN isfinite(setup_ms) THEN setup_ms END AS setup_ms)
  FROM runs
  ORDER BY host, "timestamp", precision, kernel, n, threads, block_size, repetitions
) TO 'web/public/results.json' (FORMAT json, ARRAY true);

-- The checks above leave gflops finite, so it needs no null mapping.
COPY (
  SELECT device, backend, precision, CAST(cores AS BIGINT) AS cores, gflops, source
  FROM peaks
  ORDER BY device, backend, precision, CAST(cores AS BIGINT)
) TO 'web/public/peaks.json' (FORMAT json, ARRAY true);
