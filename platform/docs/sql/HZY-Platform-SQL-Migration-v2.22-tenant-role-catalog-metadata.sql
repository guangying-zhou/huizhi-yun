-- HZY Platform SQL Migration v2.22: tenant role catalog metadata.
-- Adds tenant-owned governance metadata for the role catalog. This table does
-- not change role permissions or the system-role sync source of truth.

CREATE TABLE IF NOT EXISTS `tenant_role_catalog_metadata` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `category` VARCHAR(64) NOT NULL COMMENT 'main_position / management_duty / approval_duty / professional_duty / high_risk_privilege / custom_role',
  `governance_note` VARCHAR(1000) NULL COMMENT '目录治理备注',
  `split_suggestion` VARCHAR(1000) NULL COMMENT '角色拆分或收敛建议',
  `updated_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_role_catalog_metadata` (`tenant_code`, `role_id`),
  KEY `idx_tenant_role_catalog_category` (`tenant_code`, `category`),
  KEY `idx_tenant_role_catalog_updated_by` (`tenant_code`, `updated_by_uid`),
  CONSTRAINT `fk_tenant_role_catalog_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='租户岗位职责目录治理元数据；不改变角色权限事实';
