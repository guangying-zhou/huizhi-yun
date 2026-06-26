-- HZY Platform SQL Migration v2.21: tenant role conflict rules.
-- Adds table-driven segregation-of-duties rules for tenant role assignment.
-- Runtime can still fall back to built-in code rules when this migration has
-- not yet been applied.

CREATE TABLE IF NOT EXISTS `tenant_role_conflict_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `rule_code` VARCHAR(128) NOT NULL,
  `rule_name` VARCHAR(255) NOT NULL,
  `conflict_type` VARCHAR(32) NOT NULL DEFAULT 'segregation_of_duties',
  `enforcement` VARCHAR(32) NOT NULL DEFAULT 'warning'
    COMMENT 'warning / enforce',
  `left_role_code` VARCHAR(128) NULL,
  `right_role_code` VARCHAR(128) NULL,
  `left_app_code` VARCHAR(64) NULL,
  `left_resource_code` VARCHAR(128) NULL,
  `left_action` VARCHAR(32) NULL,
  `right_app_code` VARCHAR(64) NULL,
  `right_resource_code` VARCHAR(128) NULL,
  `right_action` VARCHAR(32) NULL,
  `description` VARCHAR(500) NULL,
  `condition_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_role_conflict_rule` (`tenant_code`, `rule_code`),
  KEY `idx_tenant_role_conflict_status` (`tenant_code`, `status`),
  KEY `idx_tenant_role_conflict_left_role` (`tenant_code`, `left_role_code`),
  KEY `idx_tenant_role_conflict_right_role` (`tenant_code`, `right_role_code`),
  KEY `idx_tenant_role_conflict_left_permission` (`left_app_code`, `left_resource_code`, `left_action`),
  KEY `idx_tenant_role_conflict_right_permission` (`right_app_code`, `right_resource_code`, `right_action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='租户角色职责冲突规则；warning 允许授予但提示，enforce 阻断授予';
