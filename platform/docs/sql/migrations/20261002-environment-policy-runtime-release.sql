-- CANDIDATE ONLY. Schema first, then reviewed backfill; no release/channel changes.
-- Record MySQL version, actual ALTER algorithm/lock duration. Fail immediately on
-- any statement error. No IF NOT EXISTS: unexpected half-install must be reviewed.
CREATE TABLE `tenant_environment_policy_revisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `environment` VARCHAR(32) NOT NULL,
  `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `policy_hash` VARCHAR(96) NULL,
  `policy_updated_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_environment_policy_revision` (`tenant_code`, `environment`),
  CONSTRAINT `fk_tenant_environment_policy_revision_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `tenant_runtime_instances`
  ADD COLUMN `release_update_mode` VARCHAR(16) NOT NULL DEFAULT 'pinned'
    COMMENT 'pinned / tracking / retired; unknown fails closed';
