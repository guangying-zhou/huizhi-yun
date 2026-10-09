CREATE TABLE IF NOT EXISTS people_contribution_scope_versions (
  cycle_code VARCHAR(64) NOT NULL,
  project_code VARCHAR(64) NOT NULL,
  source_app VARCHAR(64) NOT NULL,
  source_biz_type VARCHAR(64) NOT NULL,
  applied_revision BIGINT UNSIGNED NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (cycle_code, project_code, source_app, source_biz_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
