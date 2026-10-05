-- HZY Platform SQL Migration v2.24: repair Policy Bundle v2 schema.
-- Use this after deploying Policy Bundle v2 code to an existing database.
-- It is intentionally idempotent and covers databases that missed v2.23 or
-- older policy_bundles metadata columns.

CREATE TABLE IF NOT EXISTS `tenant_policy_revisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `policy_hash` VARCHAR(96) NULL,
  `policy_updated_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_policy_revisions_tenant` (`tenant_code`),
  CONSTRAINT `fk_tenant_policy_revisions_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='租户策略包单调版本状态；policy_hash 相同则重复生成不递增';

DELIMITER //

DROP PROCEDURE IF EXISTS `hzy_platform_v2_24_policy_bundle_v2_repair`//

CREATE PROCEDURE `hzy_platform_v2_24_policy_bundle_v2_repair`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'environment'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `tenant_code`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'policy_revision'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `bundle_hash`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'policy_hash'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `policy_hash` VARCHAR(96) NULL AFTER `policy_revision`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'signed_at'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `signed_at` DATETIME NULL AFTER `signed_by_kid`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'schema_version'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `schema_version` VARCHAR(32) NULL AFTER `signed_at`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'issued_at'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `issued_at` DATETIME NULL AFTER `schema_version`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'expires_at'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `expires_at` DATETIME NULL AFTER `issued_at`;
  END IF;

  UPDATE `policy_bundles`
  SET `schema_version` = COALESCE(NULLIF(`schema_version`, ''), 'policy-bundle.v1'),
      `issued_at` = COALESCE(`issued_at`, `signed_at`, `created_at`, UTC_TIMESTAMP())
  WHERE `schema_version` IS NULL
     OR `schema_version` = ''
     OR `issued_at` IS NULL;

  ALTER TABLE `policy_bundles`
    MODIFY COLUMN `schema_version` VARCHAR(32) NOT NULL,
    MODIFY COLUMN `issued_at` DATETIME NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND INDEX_NAME = 'idx_policy_bundles_policy_revision'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD KEY `idx_policy_bundles_policy_revision` (`tenant_code`, `environment`, `policy_revision`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND INDEX_NAME = 'idx_policy_bundles_signed_kid'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD KEY `idx_policy_bundles_signed_kid` (`signed_by_kid`, `issued_at`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND INDEX_NAME = 'idx_policy_bundles_expires_at'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD KEY `idx_policy_bundles_expires_at` (`expires_at`);
  END IF;
END//

CALL `hzy_platform_v2_24_policy_bundle_v2_repair`()//

DROP PROCEDURE IF EXISTS `hzy_platform_v2_24_policy_bundle_v2_repair`//

DELIMITER ;
