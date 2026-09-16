-- v2.1: 钉钉正式部门外部身份与稳定 dept_code 分离。
-- 可重复执行；本迁移只建表，不自动猜测或改写现有双部门树。

CREATE TABLE IF NOT EXISTS `directory_department_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider_code` VARCHAR(64) NOT NULL,
  `external_department_id` VARCHAR(255) NOT NULL,
  `dept_code` VARCHAR(64) NOT NULL,
  `mapping_origin` VARCHAR(32) NOT NULL DEFAULT 'source_created',
  `source_payload_hash` CHAR(64) NULL,
  `manager_external_subject` VARCHAR(255) NULL,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_snapshot_revision` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `active_dept_code` VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `dept_code` ELSE NULL END
  ) STORED,
  `created_by_uid` VARCHAR(64) NULL,
  `updated_by_uid` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_department_identity_external` (`provider_code`, `external_department_id`),
  UNIQUE KEY `uk_directory_department_identity_active_dept` (`provider_code`, `active_dept_code`),
  KEY `idx_directory_department_identity_dept` (`dept_code`, `provider_code`, `status`),
  CONSTRAINT `fk_directory_department_identity_dept`
    FOREIGN KEY (`dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE RESTRICT,
  CONSTRAINT `ck_directory_department_identity_status`
    CHECK (`status` IN ('active', 'inactive')),
  CONSTRAINT `ck_directory_department_identity_origin`
    CHECK (`mapping_origin` IN ('migration_confirmed', 'source_created', 'admin_bound', 'path_matched'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MySQL 8.0 does not accept ADD COLUMN IF NOT EXISTS. Keep this migration
-- repeatable for tenants that created the table from an earlier draft.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE()
     AND TABLE_NAME='directory_department_identities'
     AND COLUMN_NAME='manager_external_subject')=0,
  'ALTER TABLE `directory_department_identities` ADD COLUMN `manager_external_subject` VARCHAR(255) NULL AFTER `source_payload_hash`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Earlier drafts did not include the deterministic path_matched bootstrap origin.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA=DATABASE()
     AND TABLE_NAME='directory_department_identities'
     AND CONSTRAINT_NAME='ck_directory_department_identity_origin')>0,
  'ALTER TABLE `directory_department_identities` DROP CHECK `ck_directory_department_identity_origin`, ADD CONSTRAINT `ck_directory_department_identity_origin` CHECK (`mapping_origin` IN (''migration_confirmed'',''source_created'',''admin_bound'',''path_matched''))',
  'ALTER TABLE `directory_department_identities` ADD CONSTRAINT `ck_directory_department_identity_origin` CHECK (`mapping_origin` IN (''migration_confirmed'',''source_created'',''admin_bound'',''path_matched''))'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `directory_department_aliases` (
  `alias_dept_code` VARCHAR(64) NOT NULL,
  `canonical_dept_code` VARCHAR(64) NOT NULL,
  `provider_code` VARCHAR(64) NOT NULL DEFAULT 'dingtalk',
  `reason_code` VARCHAR(64) NOT NULL DEFAULT 'duplicate_tree_migration',
  `migration_run_id` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by_uid` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`alias_dept_code`),
  KEY `idx_directory_department_alias_canonical` (`canonical_dept_code`, `status`),
  CONSTRAINT `fk_directory_department_alias_source`
    FOREIGN KEY (`alias_dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE RESTRICT,
  CONSTRAINT `fk_directory_department_alias_target`
    FOREIGN KEY (`canonical_dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE RESTRICT,
  CONSTRAINT `ck_directory_department_alias_status`
    CHECK (`status` IN ('active', 'inactive')),
  CONSTRAINT `ck_directory_department_alias_distinct`
    CHECK (`alias_dept_code` <> `canonical_dept_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `directory_hr_source_policies` (
  `provider_code` VARCHAR(64) NOT NULL,
  `max_missing_department_count` INT UNSIGNED NOT NULL DEFAULT 3,
  `max_missing_department_ratio` DECIMAL(9,6) NOT NULL DEFAULT 0.100000,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `updated_by_uid` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`provider_code`),
  CONSTRAINT `ck_directory_hr_source_policy_ratio`
    CHECK (`max_missing_department_ratio` >= 0 AND `max_missing_department_ratio` <= 1),
  CONSTRAINT `ck_directory_hr_source_policy_status`
    CHECK (`status` IN ('active', 'inactive'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `directory_hr_source_policies`
  (`provider_code`,`max_missing_department_count`,`max_missing_department_ratio`,`status`)
VALUES ('dingtalk',3,0.100000,'active')
ON DUPLICATE KEY UPDATE `provider_code`=VALUES(`provider_code`);

CREATE TABLE IF NOT EXISTS `directory_department_snapshot_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider_code` VARCHAR(64) NOT NULL,
  `job_id` VARCHAR(128) NOT NULL,
  `snapshot_revision` VARCHAR(128) NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `root_external_department_id` VARCHAR(255) NOT NULL,
  `reported_department_count` INT UNSIGNED NOT NULL,
  `seen_department_count` INT UNSIGNED NOT NULL,
  `active_identity_count` INT UNSIGNED NOT NULL,
  `missing_department_count` INT UNSIGNED NOT NULL,
  `missing_department_ratio` DECIMAL(9,6) NOT NULL DEFAULT 0,
  `policy_max_missing_count` INT UNSIGNED NOT NULL,
  `policy_max_missing_ratio` DECIMAL(9,6) NOT NULL,
  `risk_level` VARCHAR(32) NOT NULL DEFAULT 'none',
  `root_missing` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL,
  `connector_id` VARCHAR(128) NULL,
  `confirmed_by_uid` VARCHAR(64) NULL,
  `confirmed_at` DATETIME NULL,
  `applied_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_department_snapshot_revision` (`provider_code`,`snapshot_revision`),
  KEY `idx_directory_department_snapshot_job` (`provider_code`,`job_id`),
  KEY `idx_directory_department_snapshot_status` (`provider_code`,`status`,`created_at`),
  CONSTRAINT `ck_directory_department_snapshot_risk`
    CHECK (`risk_level` IN ('none', 'normal', 'high')),
  CONSTRAINT `ck_directory_department_snapshot_status`
    CHECK (`status` IN ('no_changes', 'awaiting_confirmation', 'partially_applied', 'applied', 'superseded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `directory_department_snapshot_differences` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_run_id` BIGINT UNSIGNED NOT NULL,
  `external_department_id` VARCHAR(255) NOT NULL,
  `dept_code` VARCHAR(64) NOT NULL,
  `dept_name_snapshot` VARCHAR(255) NOT NULL,
  `parent_dept_code_snapshot` VARCHAR(64) NULL,
  `level_no_snapshot` INT NOT NULL,
  `active_primary_user_count_snapshot` INT UNSIGNED NOT NULL DEFAULT 0,
  `active_child_department_count_snapshot` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `applied_by_uid` VARCHAR(64) NULL,
  `applied_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_department_snapshot_difference` (`snapshot_run_id`,`dept_code`),
  KEY `idx_directory_department_snapshot_difference_status` (`snapshot_run_id`,`status`,`level_no_snapshot`),
  KEY `idx_directory_department_snapshot_difference_dept` (`dept_code`,`status`),
  CONSTRAINT `fk_directory_department_snapshot_difference_run`
    FOREIGN KEY (`snapshot_run_id`) REFERENCES `directory_department_snapshot_runs` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_directory_department_snapshot_difference_dept`
    FOREIGN KEY (`dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE RESTRICT,
  CONSTRAINT `ck_directory_department_snapshot_difference_status`
    CHECK (`status` IN ('pending', 'applied', 'superseded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
