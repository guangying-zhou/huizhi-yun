CREATE TABLE IF NOT EXISTS rum_settings (
  tenant_code TEXT NOT NULL,
  app_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sample_rate REAL NOT NULL DEFAULT 0.05,
  error_sample_rate REAL NOT NULL DEFAULT 1,
  slow_threshold_ms INTEGER NOT NULL DEFAULT 2500,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_code, app_code)
);

CREATE TABLE IF NOT EXISTS rum_summary_buckets (
  bucket_start TEXT NOT NULL,
  bucket_granularity TEXT NOT NULL,
  tenant_code TEXT NOT NULL,
  app_code TEXT NOT NULL,
  event_type TEXT NOT NULL,
  route TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  slow_count INTEGER NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  max_value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    bucket_start,
    bucket_granularity,
    tenant_code,
    app_code,
    event_type,
    route,
    metric_name
  )
);

CREATE INDEX IF NOT EXISTS idx_rum_summary_tenant_time
  ON rum_summary_buckets (tenant_code, bucket_start);

CREATE INDEX IF NOT EXISTS idx_rum_summary_tenant_app_time
  ON rum_summary_buckets (tenant_code, app_code, bucket_start);

CREATE TABLE IF NOT EXISTS rum_ingest_counters (
  day TEXT NOT NULL,
  tenant_code TEXT NOT NULL,
  app_code TEXT NOT NULL,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  dropped_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, tenant_code, app_code)
);
