CREATE TABLE IF NOT EXISTS people_directory_lifecycle_versions (
  employee_uid VARCHAR(64) NOT NULL PRIMARY KEY,
  revision_no BIGINT UNSIGNED NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  lifecycle_type VARCHAR(32) NOT NULL,
  effective_date DATE NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_people_directory_lifecycle_operation (operation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
