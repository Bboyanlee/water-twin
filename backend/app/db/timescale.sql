-- Applied automatically by init_db() when WT_DATABASE_URL points to PostgreSQL with TimescaleDB.
-- measurement.ts is epoch milliseconds (BIGINT).
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE OR REPLACE FUNCTION wt_now_ms() RETURNS BIGINT LANGUAGE SQL STABLE AS
$$ SELECT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT $$;

SELECT create_hypertable('measurement', 'ts', chunk_time_interval => 604800000,  -- 7 days
                         if_not_exists => TRUE, migrate_data => TRUE);
SELECT set_integer_now_func('measurement', 'wt_now_ms', replace_if_exists => TRUE);

ALTER TABLE measurement SET (timescaledb.compress, timescaledb.compress_segmentby = 'tag_id');
SELECT add_compression_policy('measurement', BIGINT '1209600000', if_not_exists => TRUE);   -- compress after 14 days

-- 15-minute continuous aggregate for dashboards and long-range queries
CREATE MATERIALIZED VIEW IF NOT EXISTS measurement_15m
WITH (timescaledb.continuous) AS
SELECT tag_id, time_bucket(BIGINT '900000', ts) AS bucket,
       avg(value) AS avg, min(value) AS min, max(value) AS max, count(value) AS n
FROM measurement GROUP BY tag_id, bucket WITH NO DATA;

SELECT add_continuous_aggregate_policy('measurement_15m',
       start_offset => BIGINT '172800000', end_offset => BIGINT '900000',
       schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- keep raw 1-minute data for 180 days; aggregates are kept
SELECT add_retention_policy('measurement', BIGINT '15552000000', if_not_exists => TRUE);
