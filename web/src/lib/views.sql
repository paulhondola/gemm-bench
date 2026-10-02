-- Reader-side views, created as TEMP on every host DB the dashboard opens,
-- so they can change without touching any committed DB (schema.sql holds
-- only tables). bun test runs them through sql.js, the engine browsers use.

-- One row per measurement: its run's context, the device it ran on (the
-- run's GPU for Metal, else its CPU), every param as a JSON object, and the
-- swept params alone, which identify the cell.
CREATE TEMP VIEW measurement_rows AS
SELECT m.*,
  CASE m.backend WHEN 'metal' THEN r.gpu ELSE r.cpu END AS device,
  r.gpu_cores, r.started_at, r.commit_id, r.repetitions,
  (SELECT json_group_object(name, value ORDER BY name) FROM params p
    WHERE p.measurement_id = m.measurement_id) AS params,
  (SELECT json_group_object(name, value ORDER BY name) FROM params p
    WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS swept_params
FROM measurements m JOIN runs r USING (run_id);

-- The newest measurement of each cell: the latest run wins.
CREATE TEMP VIEW latest AS
SELECT * FROM (
  SELECT *, row_number() OVER (
    PARTITION BY kernel, precision, n, threads, swept_params
    ORDER BY started_at DESC, measurement_id DESC) AS recency
  FROM measurement_rows)
WHERE recency = 1;
