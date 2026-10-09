CREATE TABLE IF NOT EXISTS aims_contribution_snapshot_versions (
  scope_key VARCHAR(64) NOT NULL PRIMARY KEY COMMENT 'project/cycle/source 原始作用域的 SHA-256',
  cycle_code VARCHAR(64) NOT NULL,
  project_code VARCHAR(64) NOT NULL,
  source_app VARCHAR(64) NOT NULL,
  source_biz_type VARCHAR(64) NOT NULL,
  revision_no BIGINT UNSIGNED NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_aims_contribution_scope_revision (cycle_code, project_code, source_app, source_biz_type, revision_no),
  UNIQUE KEY uk_aims_contribution_scope_operation (operation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
