-- HZY Platform SQL Migration v2.20: subject role assignment scopes.
-- Adds per-assignment scope constraints. These rows are exported passively in
-- policy bundles and are intended for the Policy Bundle v2 / authorization
-- evaluate path, where permission and scope must be checked within the same
-- grant context.
--
-- Run after v2.19 because this migration references the v2.19
-- uk_tenant_subject_roles_id_tenant key.

CREATE TABLE IF NOT EXISTS `tenant_subject_role_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `assignment_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NULL,
  `resource_code` VARCHAR(128) NULL,
  `action` VARCHAR(32) NULL,
  `scope_dimension` VARCHAR(64) NOT NULL,
  `scope_predicate` VARCHAR(64) NOT NULL,
  `scope_value` VARCHAR(255) NULL,
  `scope_group` VARCHAR(64) NOT NULL DEFAULT 'default',
  `scope_mode` VARCHAR(32) NOT NULL DEFAULT 'intersect'
    COMMENT 'inherit / intersect / replace',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subject_role_scope_assignment` (`tenant_code`, `assignment_id`, `status`),
  KEY `idx_subject_role_scope_assignment_ref` (`assignment_id`, `tenant_code`),
  KEY `idx_subject_role_scope_resource` (`app_code`, `resource_code`, `action`),
  KEY `idx_subject_role_scope_dimension` (`tenant_code`, `scope_dimension`, `scope_predicate`, `scope_value`),
  CONSTRAINT `fk_subject_role_scope_assignment`
    FOREIGN KEY (`assignment_id`, `tenant_code`) REFERENCES `tenant_subject_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='授权关系级数据范围约束；后续 Policy Bundle v2/evaluate 使用';
