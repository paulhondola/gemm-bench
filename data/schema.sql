-- Schema v1 of a gemm-bench host database. The Rust tool applies it to a new
-- file; `gemm-bench validate` compares a DB's stored DDL with it byte for
-- byte; the dashboard's tests build fixture DBs from it. Every feature used
-- must exist in sql.js's SQLite (3.49.1).
PRAGMA application_id = 0x47454d4d;  -- 'GEMM': marks the file as a gemm-bench DB
PRAGMA user_version = 1;             -- schema version; 0 = empty file

-- One row per `gemm-bench` invocation: provenance, build, and the machine as it was then.
CREATE TABLE runs (
  run_id                INTEGER PRIMARY KEY,
  started_at            TEXT    NOT NULL UNIQUE CHECK (started_at GLOB
                          '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'),
  commit_id             TEXT    NOT NULL CHECK (commit_id <> ''),
  rustc_version         TEXT    NOT NULL CHECK (rustc_version <> ''),
  repetitions           INTEGER NOT NULL CHECK (repetitions > 0),
  os                    TEXT    NOT NULL CHECK (os <> ''),
  arch                  TEXT    NOT NULL CHECK (arch GLOB '[a-z]*' AND arch NOT GLOB '*[^a-z0-9_]*'),
  target_features       TEXT    NOT NULL CHECK (target_features NOT GLOB '*[^a-z0-9._ ]*'),
  cpu                   TEXT    NOT NULL CHECK (cpu <> ''),
  available_parallelism INTEGER NOT NULL CHECK (available_parallelism > 0),
  gpu                   TEXT    CHECK (gpu <> ''),
  gpu_cores             INTEGER CHECK (gpu_cores > 0),
  CHECK (gpu IS NOT NULL OR gpu_cores IS NULL)
) STRICT;

-- One row per kind of core, fastest first (Apple's perflevel0 = tier 0).
CREATE TABLE core_tiers (
  run_id       INTEGER NOT NULL REFERENCES runs ON DELETE CASCADE,
  tier         INTEGER NOT NULL CHECK (tier >= 0),
  name         TEXT    CHECK (name <> ''),
  cores        INTEGER NOT NULL CHECK (cores > 0),
  logical_cpus INTEGER NOT NULL CHECK (logical_cpus >= cores),
  PRIMARY KEY (run_id, tier)
) STRICT, WITHOUT ROWID;

-- One row per distinct cache configuration. tier NULL = shared across tiers.
-- shared_by: logical CPUs per instance
CREATE TABLE caches (
  run_id     INTEGER NOT NULL REFERENCES runs ON DELETE CASCADE,
  tier       INTEGER,
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
  kind       TEXT    NOT NULL CHECK (kind IN ('data', 'instruction', 'unified')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  line_bytes INTEGER CHECK (line_bytes > 0),
  shared_by  INTEGER NOT NULL CHECK (shared_by > 0),
  instances  INTEGER NOT NULL CHECK (instances > 0),
  FOREIGN KEY (run_id, tier) REFERENCES core_tiers ON DELETE CASCADE
) STRICT;
CREATE UNIQUE INDEX caches_unique ON caches (run_id, coalesce(tier, -1), level, kind, size_bytes, shared_by);

-- mean_rel_error_f64: NULL = NaN, +Inf = kernel produced NaN
CREATE TABLE measurements (
  measurement_id     INTEGER PRIMARY KEY,
  run_id             INTEGER NOT NULL REFERENCES runs ON DELETE CASCADE,
  kernel             TEXT    NOT NULL CHECK (kernel GLOB '[a-z]*' AND kernel NOT GLOB '*[^a-z0-9-]*'),
  backend            TEXT    NOT NULL CHECK (backend IN ('cpu', 'matrix', 'metal')),
  precision          TEXT    NOT NULL CHECK (precision IN ('f16', 'f32', 'f64', 'i32', 'i64')),
  n                  INTEGER NOT NULL CHECK (n > 0),
  threads            INTEGER NOT NULL CHECK (threads > 0),
  gops               REAL    NOT NULL CHECK (gops > 0),
  mean_rel_error_f64 REAL    CHECK (mean_rel_error_f64 >= 0),
  median_ms          REAL    NOT NULL CHECK (median_ms >= 0),
  min_ms             REAL    NOT NULL CHECK (min_ms >= 0 AND min_ms <= median_ms),
  stddev_ms          REAL    NOT NULL CHECK (stddev_ms >= 0),
  gpu_ms             REAL    CHECK (gpu_ms >= 0),
  setup_ms           REAL    NOT NULL CHECK (setup_ms >= 0),
  CHECK ((backend = 'metal') = (gpu_ms IS NOT NULL))
) STRICT;

CREATE TABLE params (
  measurement_id INTEGER NOT NULL REFERENCES measurements ON DELETE CASCADE,
  name           TEXT    NOT NULL CHECK (name GLOB '[a-z]*' AND name NOT GLOB '*[^a-z_]*'),
  value          INTEGER NOT NULL CHECK (value > 0),
  source         TEXT    NOT NULL CHECK (source IN ('swept', 'derived', 'fixed')),
  PRIMARY KEY (measurement_id, name)
) STRICT, WITHOUT ROWID;
