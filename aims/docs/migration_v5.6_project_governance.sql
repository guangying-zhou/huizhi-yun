-- v5.6 项目治理首期（责任、周期、周报/工时/QA/汇总/里程碑骨架）
--
-- 发布原则：
--   1. 先 expand，再由 runtime 启用 pilot；不得在请求处理中执行 DDL。
--   2. leader_uid 的 NOT NULL 属于 repair 后的 contract 步骤，本迁移不猜测负责人。
--   3. 所有历史/版本/审阅表只追加，不提供物理删除业务接口。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_add_governance_column`$$
CREATE PROCEDURE `aims_add_governance_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_column_definition TEXT
)
BEGIN
  SET @column_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS column_info
    WHERE column_info.TABLE_SCHEMA = DATABASE()
      AND column_info.TABLE_NAME = p_table_name
      AND column_info.COLUMN_NAME = p_column_name
  );

  IF @column_exists = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `aims_add_governance_index`$$
CREATE PROCEDURE `aims_add_governance_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_index_definition TEXT
)
BEGIN
  SET @index_exists := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS index_info
    WHERE index_info.TABLE_SCHEMA = DATABASE()
      AND index_info.TABLE_NAME = p_table_name
      AND index_info.INDEX_NAME = p_index_name
  );

  IF @index_exists = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `aims_add_governance_fk`$$
CREATE PROCEDURE `aims_add_governance_fk`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_constraint_definition TEXT
)
BEGIN
  SET @constraint_exists := (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS constraint_info
    WHERE constraint_info.CONSTRAINT_SCHEMA = DATABASE()
      AND constraint_info.TABLE_NAME = p_table_name
      AND constraint_info.CONSTRAINT_NAME = p_constraint_name
  );

  IF @constraint_exists = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `', p_constraint_name, '` ', p_constraint_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CREATE TABLE IF NOT EXISTS `weekly_reporting_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(32) NOT NULL DEFAULT 'default',
  `timezone` VARCHAR(64) NOT NULL,
  `deadline_weekday` TINYINT UNSIGNED NOT NULL COMMENT 'ISO weekday: 1=Monday, 7=Sunday',
  `deadline_time` TIME NOT NULL,
  `summary_target_weekday` TINYINT UNSIGNED NOT NULL,
  `summary_target_time` TIME NOT NULL,
  `reminder_offsets_json` JSON NOT NULL,
  `rag_config_json` JSON NOT NULL,
  `rollout_mode` ENUM('disabled','pilot','company') NOT NULL DEFAULT 'disabled',
  `config_version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_reporting_settings_key` (`config_key`),
  CONSTRAINT `chk_weekly_deadline_weekday` CHECK (`deadline_weekday` BETWEEN 1 AND 7),
  CONSTRAINT `chk_weekly_summary_weekday` CHECK (`summary_target_weekday` BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司项目周报版本化配置';

CREATE TABLE IF NOT EXISTS `weekly_reporting_pilot_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_pilot_project_from` (`project_id`, `effective_from`),
  KEY `idx_weekly_pilot_effective` (`effective_from`, `effective_to`),
  CONSTRAINT `fk_weekly_pilot_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_weekly_pilot_range` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报试点项目有效期';

CREATE TABLE IF NOT EXISTS `project_lifecycle_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(32) DEFAULT NULL,
  `to_status` VARCHAR(32) NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `actor_uid` VARCHAR(64) NOT NULL,
  `source` VARCHAR(64) NOT NULL DEFAULT 'aims.runtime',
  `request_id` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_project_lifecycle_effective` (`project_id`, `effective_at`, `id`),
  KEY `idx_project_lifecycle_status` (`to_status`, `effective_at`),
  CONSTRAINT `fk_project_lifecycle_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目生命周期追加式事件';

INSERT INTO `project_lifecycle_events` (
  `project_id`, `from_status`, `to_status`, `effective_at`, `actor_uid`, `source`
)
SELECT
  project.`id`,
  NULL,
  project.`lifecycle_status`,
  project.`created_at`,
  project.`created_by`,
  'migration.v5.6.baseline'
FROM `aims_projects` project
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_lifecycle_events` event
  WHERE event.`project_id` = project.`id`
);

CREATE TABLE IF NOT EXISTS `project_manager_delegations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `delegate_uid` VARCHAR(64) NOT NULL,
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `appointed_by` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL COMMENT 'Console 单例角色持有人快照修订号',
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `revoked_by` VARCHAR(64) DEFAULT NULL,
  `revoked_role_holder_revision` BIGINT UNSIGNED DEFAULT NULL COMMENT '撤销时 Console 单例角色持有人修订号',
  `revoke_reason` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_manager_delegation_effective` (`project_id`, `starts_at`, `ends_at`, `revoked_at`),
  KEY `idx_manager_delegation_delegate` (`delegate_uid`, `starts_at`, `ends_at`),
  CONSTRAINT `fk_manager_delegation_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_manager_delegation_range` CHECK (`ends_at` > `starts_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理项目经理不可变任期';

CALL `aims_add_governance_column`(
  'project_manager_delegations',
  'role_holder_revision',
  '`role_holder_revision` BIGINT UNSIGNED NOT NULL COMMENT ''Console 单例角色持有人快照修订号'' AFTER `appointed_by`'
);
CALL `aims_add_governance_column`(
  'project_manager_delegations',
  'revoked_role_holder_revision',
  '`revoked_role_holder_revision` BIGINT UNSIGNED DEFAULT NULL COMMENT ''撤销时 Console 单例角色持有人修订号'' AFTER `revoked_by`'
);

CREATE TABLE IF NOT EXISTS `weekly_reporting_periods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_key` VARCHAR(16) NOT NULL,
  `week_start` DATETIME(6) NOT NULL,
  `week_end` DATETIME(6) NOT NULL,
  `deadline_at` DATETIME(6) NOT NULL,
  `summary_target_at` DATETIME(6) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL,
  `config_version` BIGINT UNSIGNED NOT NULL,
  `settings_snapshot_json` JSON NOT NULL,
  `status` ENUM('open','deadline_frozen','publishing','published','closed') NOT NULL DEFAULT 'open',
  `obligations_frozen_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_period_key` (`period_key`),
  KEY `idx_weekly_period_status` (`status`, `deadline_at`),
  CONSTRAINT `chk_weekly_period_range` CHECK (`week_end` > `week_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司项目周报自然周周期';

CREATE TABLE IF NOT EXISTS `weekly_report_obligations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `responsible_uid_snapshot` VARCHAR(64) NOT NULL,
  `responsibility_type` ENUM('project_manager','acting_project_manager') NOT NULL,
  `project_status_snapshot` VARCHAR(32) NOT NULL,
  `due_status` ENUM('pending','draft','submitted','reviewed','returned','late','missing','frozen') NOT NULL DEFAULT 'pending',
  `first_submitted_at` DATETIME(6) DEFAULT NULL,
  `late_flag` TINYINT(1) NOT NULL DEFAULT 0,
  `frozen_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_obligation_period_project` (`period_id`, `project_id`),
  KEY `idx_weekly_obligation_responsible` (`responsible_uid_snapshot`, `due_status`),
  KEY `idx_weekly_obligation_project` (`project_id`, `period_id`),
  CONSTRAINT `fk_weekly_obligation_period` FOREIGN KEY (`period_id`) REFERENCES `weekly_reporting_periods` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_obligation_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每周期项目周报责任快照';

CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'obligation_id',
  '`obligation_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''新周报责任义务'' AFTER `project_id`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'current_version_no',
  '`current_version_no` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `status`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'current_submitted_version_id',
  '`current_submitted_version_id` BIGINT UNSIGNED DEFAULT NULL AFTER `current_version_no`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'current_reviewed_version_id',
  '`current_reviewed_version_id` BIGINT UNSIGNED DEFAULT NULL AFTER `current_submitted_version_id`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'current_frozen_version_id',
  '`current_frozen_version_id` BIGINT UNSIGNED DEFAULT NULL AFTER `current_reviewed_version_id`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'pending_correction_of_version_id',
  '`pending_correction_of_version_id` BIGINT UNSIGNED DEFAULT NULL AFTER `current_frozen_version_id`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'pending_correction_reason',
  '`pending_correction_reason` VARCHAR(1000) DEFAULT NULL AFTER `pending_correction_of_version_id`'
);
CALL `aims_add_governance_column`(
  'project_weekly_reports',
  'pending_correction_request_id',
  '`pending_correction_request_id` BIGINT UNSIGNED DEFAULT NULL AFTER `pending_correction_reason`'
);
ALTER TABLE `project_weekly_reports`
  MODIFY COLUMN `status` ENUM('draft','submitted','returned','reviewed','frozen','correction_draft')
  NOT NULL DEFAULT 'draft' COMMENT '周报状态';
CALL `aims_add_governance_index`(
  'project_weekly_reports',
  'uk_weekly_report_obligation',
  'UNIQUE KEY `uk_weekly_report_obligation` (`obligation_id`)'
);

CREATE TABLE IF NOT EXISTS `project_weekly_report_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `kind` ENUM('legacy_import','submission','correction') NOT NULL DEFAULT 'submission',
  `correction_of_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `correction_reason` VARCHAR(1000) DEFAULT NULL,
  `manager_content_json` JSON NOT NULL,
  `fact_snapshot_json` JSON NOT NULL,
  `fact_snapshot_sha256` CHAR(64) NOT NULL,
  `system_rag` ENUM('green','yellow','red') NOT NULL,
  `selected_rag` ENUM('green','yellow','red') NOT NULL,
  `rag_override_reason` VARCHAR(1000) DEFAULT NULL,
  `rag_rule_version` VARCHAR(32) NOT NULL,
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_report_version` (`report_id`, `version_no`),
  KEY `idx_weekly_report_version_submitted` (`submitted_at`),
  CONSTRAINT `fk_weekly_report_version_report` FOREIGN KEY (`report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_report_version_correction` FOREIGN KEY (`correction_of_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报不可变提交版本';

CREATE TABLE IF NOT EXISTS `project_weekly_report_correction_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL,
  `correction_of_version_id` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `opened_by` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('open','consumed','cancelled') NOT NULL DEFAULT 'open',
  `submitted_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `consumed_at` DATETIME(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_weekly_correction_report` (`report_id`, `status`, `created_at`),
  CONSTRAINT `fk_weekly_correction_request_report` FOREIGN KEY (`report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_correction_request_base` FOREIGN KEY (`correction_of_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_correction_request_submission` FOREIGN KEY (`submitted_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报更正发起审计';

CREATE TABLE IF NOT EXISTS `project_weekly_report_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_version_id` BIGINT UNSIGNED NOT NULL,
  `action` ENUM('approve','return','approve_with_corrective_action') NOT NULL,
  `comment` TEXT DEFAULT NULL,
  `reviewer_uid` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_review_terminal` (`report_version_id`),
  KEY `idx_weekly_review_version` (`report_version_id`, `created_at`),
  KEY `idx_weekly_review_reviewer` (`reviewer_uid`, `created_at`),
  CONSTRAINT `fk_weekly_review_version` FOREIGN KEY (`report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报追加式审阅';

CREATE TABLE IF NOT EXISTS `weekly_report_corrective_action_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_review_corrective_item` (`review_id`, `work_item_id`),
  CONSTRAINT `fk_weekly_corrective_review` FOREIGN KEY (`review_id`) REFERENCES `project_weekly_report_reviews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_weekly_corrective_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周报审阅整改工作项关联';

CALL `aims_add_governance_column`(
  'time_entries',
  'review_status',
  '`review_status` ENUM(''draft'',''submitted'',''approved'',''returned'') NOT NULL DEFAULT ''draft'' AFTER `description`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'review_route',
  '`review_route` ENUM(''project_manager'',''company_summary'') DEFAULT NULL AFTER `review_status`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'row_version',
  '`row_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `review_route`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'reviewer_uid_snapshot',
  '`reviewer_uid_snapshot` VARCHAR(64) DEFAULT NULL AFTER `review_route`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'locked_report_version_id',
  '`locked_report_version_id` BIGINT UNSIGNED DEFAULT NULL AFTER `reviewer_uid_snapshot`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'submitted_at',
  '`submitted_at` DATETIME(6) DEFAULT NULL AFTER `row_version`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'reviewed_by',
  '`reviewed_by` VARCHAR(64) DEFAULT NULL AFTER `submitted_at`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'reviewed_at',
  '`reviewed_at` DATETIME(6) DEFAULT NULL AFTER `reviewed_by`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'return_reason',
  '`return_reason` VARCHAR(1000) DEFAULT NULL AFTER `reviewed_at`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'approved_summary_version_id',
  '`approved_summary_version_id` BIGINT UNSIGNED DEFAULT NULL AFTER `return_reason`'
);
CALL `aims_add_governance_column`(
  'time_entries',
  'corrects_entry_id',
  '`corrects_entry_id` BIGINT UNSIGNED DEFAULT NULL AFTER `approved_summary_version_id`'
);
CALL `aims_add_governance_index`(
  'time_entries',
  'idx_time_review_status',
  'KEY `idx_time_review_status` (`review_status`, `entry_date`)'
);
CALL `aims_add_governance_index`(
  'time_entries',
  'idx_time_corrects_entry',
  'KEY `idx_time_corrects_entry` (`corrects_entry_id`)'
);

CREATE TABLE IF NOT EXISTS `time_entry_review_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `time_entry_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(32) NOT NULL,
  `to_status` VARCHAR(32) NOT NULL,
  `actor_uid` VARCHAR(64) NOT NULL,
  `reason` VARCHAR(1000) DEFAULT NULL,
  `report_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `summary_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_time_review_entry` (`time_entry_id`, `created_at`),
  KEY `idx_time_review_actor` (`actor_uid`, `created_at`),
  CONSTRAINT `fk_time_review_entry` FOREIGN KEY (`time_entry_id`) REFERENCES `time_entries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_time_review_report_version` FOREIGN KEY (`report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工时审核追加式事件';

CREATE TABLE IF NOT EXISTS `qa_checklist_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checklist_code` VARCHAR(64) NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `items_json` JSON NOT NULL,
  `items_sha256` CHAR(64) NOT NULL,
  `status` ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  `published_by` VARCHAR(64) DEFAULT NULL,
  `published_at` DATETIME(6) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qa_checklist_version` (`checklist_code`, `version_no`),
  KEY `idx_qa_checklist_status` (`status`, `published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='QA 检查清单不可变版本';

CREATE TABLE IF NOT EXISTS `deliverable_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deliverable_id` BIGINT UNSIGNED NOT NULL,
  `submission_no` VARCHAR(100) NOT NULL,
  `document_uuid` CHAR(36) DEFAULT NULL,
  `document_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `document_version_num` INT UNSIGNED DEFAULT NULL,
  `content_sha256` CHAR(64) DEFAULT NULL,
  `evidence_snapshot_json` JSON NOT NULL,
  `checklist_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `review_route` ENUM('qa','pm_completeness_then_director_quality') NOT NULL DEFAULT 'qa',
  `review_grant_id` BIGINT UNSIGNED DEFAULT NULL,
  `review_granted_at` DATETIME(6) DEFAULT NULL,
  `status` ENUM('preparing_review','awaiting_review','passed','returned','waived') NOT NULL DEFAULT 'preparing_review',
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deliverable_submission_no` (`submission_no`),
  UNIQUE KEY `uk_deliverable_submission_version` (`deliverable_id`, `document_version_id`),
  KEY `idx_deliverable_submission` (`deliverable_id`, `created_at`),
  KEY `idx_deliverable_submission_status` (`status`, `review_route`),
  CONSTRAINT `fk_deliverable_submission_deliverable` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_deliverable_submission_checklist` FOREIGN KEY (`checklist_version_id`) REFERENCES `qa_checklist_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付物不可变提交';

CREATE TABLE IF NOT EXISTS `deliverable_quality_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `submission_id` BIGINT UNSIGNED NOT NULL,
  `stage` ENUM('pm_completeness','qa_quality','director_quality') NOT NULL,
  `action` ENUM('pass','return') NOT NULL,
  `checklist_result_json` JSON NOT NULL,
  `result_sha256` CHAR(64) NOT NULL,
  `reviewer_uid` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED DEFAULT NULL,
  `comment` TEXT DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_quality_submission` (`submission_id`, `created_at`),
  CONSTRAINT `fk_deliverable_quality_submission` FOREIGN KEY (`submission_id`) REFERENCES `deliverable_submissions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付物追加式质量评审';

CREATE TABLE IF NOT EXISTS `deliverable_waivers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deliverable_id` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `approved_by` VARCHAR(64) NOT NULL,
  `role_holder_revision` BIGINT UNSIGNED NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `revoked_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_waiver_effective` (`deliverable_id`, `effective_at`, `revoked_at`),
  CONSTRAINT `fk_deliverable_waiver_deliverable` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目总监交付物豁免';

CALL `aims_add_governance_column`(
  'deliverables',
  'current_submission_id',
  '`current_submission_id` BIGINT UNSIGNED DEFAULT NULL AFTER `status`'
);
CALL `aims_add_governance_column`(
  'deliverables',
  'quality_status',
  '`quality_status` ENUM(''not_required'',''pending'',''preparing_review'',''awaiting_review'',''passed'',''returned'',''waived'') NOT NULL DEFAULT ''pending'' AFTER `current_submission_id`'
);
CALL `aims_add_governance_index`(
  'deliverables',
  'idx_deliverable_quality_status',
  'KEY `idx_deliverable_quality_status` (`quality_status`, `project_id`)'
);

CREATE TABLE IF NOT EXISTS `company_weekly_summaries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('draft','publishing','published','cancelled','correction_draft') NOT NULL DEFAULT 'draft',
  `current_revision_no` INT UNSIGNED NOT NULL DEFAULT 0,
  `current_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `codocs_document_uuid` CHAR(36) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_weekly_summary_period` (`period_id`),
  CONSTRAINT `fk_company_summary_period` FOREIGN KEY (`period_id`) REFERENCES `weekly_reporting_periods` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司项目周报汇总逻辑主记录';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_id` BIGINT UNSIGNED NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `correction_of_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `correction_reason` VARCHAR(1000) DEFAULT NULL,
  `structured_snapshot_json` JSON NOT NULL,
  `structured_sha256` CHAR(64) NOT NULL,
  `markdown_content` LONGTEXT NOT NULL,
  `markdown_sha256` CHAR(64) NOT NULL,
  `publish_status` ENUM('prepared','pending','published','failed','cancelled') NOT NULL DEFAULT 'prepared',
  `codocs_document_uuid` CHAR(36) DEFAULT NULL,
  `codocs_document_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `codocs_version_num` INT UNSIGNED DEFAULT NULL,
  `published_by` VARCHAR(64) DEFAULT NULL,
  `published_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_revision` (`summary_id`, `revision_no`),
  CONSTRAINT `fk_company_summary_version_summary` FOREIGN KEY (`summary_id`) REFERENCES `company_weekly_summaries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_version_correction` FOREIGN KEY (`correction_of_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司周报汇总不可变版本';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_version_id` BIGINT UNSIGNED NOT NULL,
  `obligation_id` BIGINT UNSIGNED NOT NULL,
  `report_version_id` BIGINT UNSIGNED DEFAULT NULL,
  `inclusion_status` ENUM('included','missing','late_unincluded') NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_item_obligation` (`summary_version_id`, `obligation_id`),
  CONSTRAINT `fk_company_summary_item_version` FOREIGN KEY (`summary_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_item_obligation` FOREIGN KEY (`obligation_id`) REFERENCES `weekly_report_obligations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_item_report_version` FOREIGN KEY (`report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司汇总纳入项目和版本快照';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_recipient_selections` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_id` BIGINT UNSIGNED NOT NULL,
  `subject_type` ENUM('user','department') NOT NULL,
  `subject_code` VARCHAR(128) NOT NULL,
  `subject_name_snapshot` VARCHAR(255) NOT NULL,
  `selected_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_recipient_selection` (`summary_id`, `subject_type`, `subject_code`),
  CONSTRAINT `fk_company_summary_recipient_selection` FOREIGN KEY (`summary_id`) REFERENCES `company_weekly_summaries` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司汇总抄送原始选择';

CREATE TABLE IF NOT EXISTS `company_weekly_summary_recipient_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_version_id` BIGINT UNSIGNED NOT NULL,
  `selection_id` BIGINT UNSIGNED NOT NULL,
  `resolved_uid` VARCHAR(64) NOT NULL,
  `display_name_snapshot` VARCHAR(255) NOT NULL,
  `department_code_snapshot` VARCHAR(128) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_summary_recipient_uid` (`summary_version_id`, `resolved_uid`),
  KEY `idx_company_summary_recipient_selection` (`selection_id`),
  CONSTRAINT `fk_company_summary_recipient_snapshot_version` FOREIGN KEY (`summary_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_company_summary_recipient_snapshot_selection` FOREIGN KEY (`selection_id`) REFERENCES `company_weekly_summary_recipient_selections` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司汇总发布时实际抄送人快照';

CREATE TABLE IF NOT EXISTS `project_management_fact_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `revision` BIGINT UNSIGNED NOT NULL,
  `fact_code` VARCHAR(100) NOT NULL,
  `period_key` VARCHAR(16) NOT NULL,
  `subject_uid` VARCHAR(64) DEFAULT NULL,
  `project_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_code` VARCHAR(50) DEFAULT NULL,
  `value_json` JSON NOT NULL,
  `source_refs_json` JSON NOT NULL,
  `source_sha256` CHAR(64) NOT NULL,
  `correction_of_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_management_fact_revision` (`revision`),
  KEY `idx_project_management_fact_period` (`period_key`, `fact_code`),
  KEY `idx_project_management_fact_subject` (`subject_uid`, `period_key`),
  CONSTRAINT `fk_project_management_fact_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_project_management_fact_correction` FOREIGN KEY (`correction_of_id`) REFERENCES `project_management_fact_snapshots` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供 People 消费的版本化项目管理事实';

CALL `aims_add_governance_column`(
  'approval_records',
  'request_no',
  '`request_no` VARCHAR(100) DEFAULT NULL AFTER `id`'
);
CALL `aims_add_governance_column`(
  'approval_records',
  'request_version',
  '`request_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `request_no`'
);
CALL `aims_add_governance_column`(
  'approval_records',
  'snapshot_json',
  '`snapshot_json` JSON DEFAULT NULL AFTER `request_comment`'
);
CALL `aims_add_governance_column`(
  'approval_records',
  'snapshot_sha256',
  '`snapshot_sha256` CHAR(64) DEFAULT NULL AFTER `snapshot_json`'
);
CALL `aims_add_governance_column`(
  'approval_records',
  'idempotency_key',
  '`idempotency_key` VARCHAR(180) DEFAULT NULL AFTER `snapshot_sha256`'
);
CALL `aims_add_governance_column`(
  'approval_records',
  'locked_at',
  '`locked_at` DATETIME(6) DEFAULT NULL AFTER `idempotency_key`'
);
CALL `aims_add_governance_column`(
  'milestones',
  'completion_lock_request_id',
  '`completion_lock_request_id` BIGINT UNSIGNED DEFAULT NULL AFTER `status`'
);
CALL `aims_add_governance_index`(
  'approval_records',
  'uk_approval_request_no',
  'UNIQUE KEY `uk_approval_request_no` (`request_no`)'
);
CALL `aims_add_governance_index`(
  'approval_records',
  'uk_approval_idempotency_key',
  'UNIQUE KEY `uk_approval_idempotency_key` (`idempotency_key`)'
);
CALL `aims_add_governance_index`(
  'milestones',
  'idx_milestone_completion_lock',
  'KEY `idx_milestone_completion_lock` (`completion_lock_request_id`)'
);

CALL `aims_add_governance_fk`(
  'project_weekly_reports',
  'fk_weekly_report_obligation',
  'FOREIGN KEY (`obligation_id`) REFERENCES `weekly_report_obligations` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'project_weekly_reports',
  'fk_weekly_report_submitted_version',
  'FOREIGN KEY (`current_submitted_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'project_weekly_reports',
  'fk_weekly_report_reviewed_version',
  'FOREIGN KEY (`current_reviewed_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'project_weekly_reports',
  'fk_weekly_report_frozen_version',
  'FOREIGN KEY (`current_frozen_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'project_weekly_reports',
  'fk_weekly_report_pending_correction_version',
  'FOREIGN KEY (`pending_correction_of_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'project_weekly_reports',
  'fk_weekly_report_pending_correction_request',
  'FOREIGN KEY (`pending_correction_request_id`) REFERENCES `project_weekly_report_correction_requests` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'time_entries',
  'fk_time_corrects_entry',
  'FOREIGN KEY (`corrects_entry_id`) REFERENCES `time_entries` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'time_entries',
  'fk_time_approved_summary_version',
  'FOREIGN KEY (`approved_summary_version_id`) REFERENCES `company_weekly_summary_versions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'time_entries',
  'fk_time_locked_report_version',
  'FOREIGN KEY (`locked_report_version_id`) REFERENCES `project_weekly_report_versions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'deliverables',
  'fk_deliverable_current_submission',
  'FOREIGN KEY (`current_submission_id`) REFERENCES `deliverable_submissions` (`id`) ON DELETE RESTRICT'
);
CALL `aims_add_governance_fk`(
  'milestones',
  'fk_milestone_completion_lock',
  'FOREIGN KEY (`completion_lock_request_id`) REFERENCES `approval_records` (`id`) ON DELETE RESTRICT'
);

DROP PROCEDURE IF EXISTS `aims_add_governance_column`;
DROP PROCEDURE IF EXISTS `aims_add_governance_index`;
DROP PROCEDURE IF EXISTS `aims_add_governance_fk`;

-- 迁移前置诊断：结果必须由业务逐项指定，禁止自动回填。
SELECT
  `id`,
  `project_code`,
  `name`,
  `lifecycle_status`,
  `created_by`
FROM `aims_projects`
WHERE `leader_uid` IS NULL OR TRIM(`leader_uid`) = ''
ORDER BY `id`;
