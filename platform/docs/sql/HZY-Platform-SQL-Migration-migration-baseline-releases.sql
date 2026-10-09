-- Reviewed, idempotent migration. Run only against the approved Platform schema.
SET @baseline_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_app_releases' AND COLUMN_NAME='release_kind')=0,
  'ALTER TABLE platform_app_releases ADD COLUMN release_kind VARCHAR(16) NOT NULL DEFAULT ''git''', 'SELECT 1');
PREPARE baseline_stmt FROM @baseline_ddl;
EXECUTE baseline_stmt;
DEALLOCATE PREPARE baseline_stmt;
SET @baseline_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_app_releases' AND COLUMN_NAME='baseline_source_json')=0,
  'ALTER TABLE platform_app_releases ADD COLUMN baseline_source_json JSON NULL', 'SELECT 1');
PREPARE baseline_stmt FROM @baseline_ddl;
EXECUTE baseline_stmt;
DEALLOCATE PREPARE baseline_stmt;
SET @baseline_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='platform_app_releases' AND CONSTRAINT_NAME='chk_app_release_baseline')=0,
  'ALTER TABLE platform_app_releases ADD CONSTRAINT chk_app_release_baseline CHECK ((release_kind=''git'' AND status<>''baseline'' AND baseline_source_json IS NULL) OR (release_kind=''baseline'' AND status=''baseline'' AND source_tag='''' AND source_commit_sha IS NULL AND source_registration_id IS NULL AND released_at IS NULL AND baseline_source_json IS NOT NULL AND JSON_CONTAINS_PATH(baseline_source_json,''all'',''$.tenant'',''$.environment'',''$.bundleId'',''$.bundleHash'',''$.manifestId'',''$.manifestHash'')=1))', 'SELECT 1');
PREPARE baseline_stmt FROM @baseline_ddl;
EXECUTE baseline_stmt;
DEALLOCATE PREPARE baseline_stmt;
CREATE TABLE IF NOT EXISTS platform_migration_baseline_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_code VARCHAR(64) NOT NULL,
  environment VARCHAR(16) NOT NULL,
  source_bundle_id BIGINT UNSIGNED NOT NULL,
  review_hash CHAR(64) NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  registrations_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_baseline_review (tenant_code,environment,source_bundle_id,review_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
