-- Apply to the Codocs tenant-runtime database before enabling administrator quick publish.
CREATE TABLE IF NOT EXISTS company_asset_quick_publish_operations (
  operation_id VARCHAR(64) NOT NULL PRIMARY KEY,
  actor_uid VARCHAR(64) NOT NULL,
  command_sha256 CHAR(64) NOT NULL,
  plan_json JSON NOT NULL,
  result_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_quick_publish_actor_created (actor_uid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
