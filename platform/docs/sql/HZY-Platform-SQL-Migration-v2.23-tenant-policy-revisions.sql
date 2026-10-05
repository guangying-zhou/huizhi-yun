-- HZY Platform SQL Migration v2.23: tenant policy bundle revisions.
-- Introduces a tenant-level monotonic policy revision state for generated
-- policy bundles. Existing historical bundles keep their original payload;
-- new bundles snapshot the DB-backed revision and policy fact hash.

START TRANSACTION;

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

ALTER TABLE `policy_bundles`
  ADD COLUMN IF NOT EXISTS `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `bundle_hash`,
  ADD COLUMN IF NOT EXISTS `policy_hash` VARCHAR(96) NULL AFTER `policy_revision`,
  ADD KEY `idx_policy_bundles_policy_revision` (`tenant_code`, `environment`, `policy_revision`);

COMMIT;
