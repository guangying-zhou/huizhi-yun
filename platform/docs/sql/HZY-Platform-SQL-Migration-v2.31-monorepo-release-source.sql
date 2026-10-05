-- HZY Platform SQL Migration v2.31: monorepo release source configuration.
--
-- Adds per-application manifest path and tag namespace while retaining NULL
-- prefix compatibility for existing standalone repositories. Release rows link
-- to the accepted registration that snapshots repo URL, commit and file path.

SET @column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_applications' AND COLUMN_NAME = 'manifest_path'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `platform_applications` ADD COLUMN `manifest_path` VARCHAR(500) NOT NULL DEFAULT ''app.manifest.json'' COMMENT ''Repository-relative manifest path; monorepo uses <app_code>/app.manifest.json'' AFTER `repo_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_applications' AND COLUMN_NAME = 'release_tag_prefix'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `platform_applications` ADD COLUMN `release_tag_prefix` VARCHAR(128) NULL COMMENT ''Optional Git tag namespace such as aims/; NULL keeps legacy standalone-repo behavior'' AFTER `manifest_path`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_app_releases' AND COLUMN_NAME = 'source_registration_id'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `platform_app_releases` ADD COLUMN `source_registration_id` BIGINT UNSIGNED NULL COMMENT ''Accepted manifest registration source snapshot'' AFTER `source_commit_sha`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_app_releases' AND INDEX_NAME = 'idx_platform_app_releases_registration'
);
SET @sql := IF(
  @index_exists = 0,
  'ALTER TABLE `platform_app_releases` ADD KEY `idx_platform_app_releases_registration` (`source_registration_id`, `app_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @constraint_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_app_releases' AND CONSTRAINT_NAME = 'fk_platform_app_releases_registration'
);
SET @sql := IF(
  @constraint_exists = 0,
  'ALTER TABLE `platform_app_releases` ADD CONSTRAINT `fk_platform_app_releases_registration` FOREIGN KEY (`source_registration_id`, `app_code`) REFERENCES `platform_app_manifest_registrations` (`id`, `app_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keep existing applications in standalone compatibility mode. During GitLab
-- cutover, update each migrated app atomically, for example:
-- UPDATE platform_applications
-- SET repo_url = 'https://gitlab.example/group/huizhi-yun.git',
--     manifest_path = CONCAT(app_code, '/app.manifest.json'),
--     release_tag_prefix = CONCAT(app_code, '/')
-- WHERE app_code IN ('aims', 'altoc', 'assets', 'codocs', 'console', 'finance',
--                    'people', 'align', 'insights', 'platform', 'workflow',
--                    'collab', 'webdev');
