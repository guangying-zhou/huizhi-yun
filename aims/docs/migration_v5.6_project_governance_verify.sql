-- v5.6 项目治理迁移后只读校验
--
-- 必须按以下顺序执行：
--   1. migration_v5.6_project_governance_preflight.sql
--   2. migration_v5.6_project_governance.sql
--   3. 本文件
--
-- 本文件不创建业务表。若主迁移未执行或中途失败，会先给出明确错误，
-- 避免后续查询以 Error 1146（table doesn't exist）结束。

SELECT
  21 AS expected_governance_tables,
  COUNT(*) AS existing_governance_tables,
  21 - COUNT(*) AS missing_governance_tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND table_name IN (
    'weekly_reporting_settings',
    'weekly_reporting_pilot_projects',
    'project_lifecycle_events',
    'project_manager_delegations',
    'weekly_reporting_periods',
    'weekly_report_obligations',
    'project_weekly_report_versions',
    'project_weekly_report_correction_requests',
    'project_weekly_report_reviews',
    'weekly_report_corrective_action_links',
    'time_entry_review_events',
    'qa_checklist_versions',
    'deliverable_submissions',
    'deliverable_quality_reviews',
    'deliverable_waivers',
    'company_weekly_summaries',
    'company_weekly_summary_versions',
    'company_weekly_summary_items',
    'company_weekly_summary_recipient_selections',
    'company_weekly_summary_recipient_snapshots',
    'project_management_fact_snapshots'
  );

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_verify_v5_6_governance_ready`$$
CREATE PROCEDURE `aims_verify_v5_6_governance_ready`()
BEGIN
  DECLARE existing_table_count INT DEFAULT 0;
  DECLARE existing_column_count INT DEFAULT 0;
  DECLARE existing_index_count INT DEFAULT 0;
  DECLARE existing_fk_count INT DEFAULT 0;

  SELECT COUNT(*)
  INTO existing_table_count
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND table_name IN (
      'weekly_reporting_settings',
      'weekly_reporting_pilot_projects',
      'project_lifecycle_events',
      'project_manager_delegations',
      'weekly_reporting_periods',
      'weekly_report_obligations',
      'project_weekly_report_versions',
      'project_weekly_report_correction_requests',
      'project_weekly_report_reviews',
      'weekly_report_corrective_action_links',
      'time_entry_review_events',
      'qa_checklist_versions',
      'deliverable_submissions',
      'deliverable_quality_reviews',
      'deliverable_waivers',
      'company_weekly_summaries',
      'company_weekly_summary_versions',
      'company_weekly_summary_items',
      'company_weekly_summary_recipient_selections',
      'company_weekly_summary_recipient_snapshots',
      'project_management_fact_snapshots'
    );

  SELECT COUNT(*)
  INTO existing_column_count
  FROM (
    SELECT 'project_manager_delegations' AS table_name, 'role_holder_revision' AS column_name
    UNION ALL SELECT 'project_manager_delegations', 'revoked_role_holder_revision'
    UNION ALL SELECT 'project_weekly_reports', 'obligation_id'
    UNION ALL SELECT 'project_weekly_reports', 'current_version_no'
    UNION ALL SELECT 'project_weekly_reports', 'current_submitted_version_id'
    UNION ALL SELECT 'project_weekly_reports', 'current_reviewed_version_id'
    UNION ALL SELECT 'project_weekly_reports', 'current_frozen_version_id'
    UNION ALL SELECT 'project_weekly_reports', 'pending_correction_of_version_id'
    UNION ALL SELECT 'project_weekly_reports', 'pending_correction_reason'
    UNION ALL SELECT 'project_weekly_reports', 'pending_correction_request_id'
    UNION ALL SELECT 'time_entries', 'review_status'
    UNION ALL SELECT 'time_entries', 'review_route'
    UNION ALL SELECT 'time_entries', 'row_version'
    UNION ALL SELECT 'time_entries', 'reviewer_uid_snapshot'
    UNION ALL SELECT 'time_entries', 'locked_report_version_id'
    UNION ALL SELECT 'time_entries', 'submitted_at'
    UNION ALL SELECT 'time_entries', 'reviewed_by'
    UNION ALL SELECT 'time_entries', 'reviewed_at'
    UNION ALL SELECT 'time_entries', 'return_reason'
    UNION ALL SELECT 'time_entries', 'approved_summary_version_id'
    UNION ALL SELECT 'time_entries', 'corrects_entry_id'
    UNION ALL SELECT 'deliverables', 'current_submission_id'
    UNION ALL SELECT 'deliverables', 'quality_status'
    UNION ALL SELECT 'approval_records', 'request_no'
    UNION ALL SELECT 'approval_records', 'request_version'
    UNION ALL SELECT 'approval_records', 'snapshot_json'
    UNION ALL SELECT 'approval_records', 'snapshot_sha256'
    UNION ALL SELECT 'approval_records', 'idempotency_key'
    UNION ALL SELECT 'approval_records', 'locked_at'
    UNION ALL SELECT 'milestones', 'completion_lock_request_id'
  ) expected_column
  INNER JOIN information_schema.COLUMNS column_info
    ON column_info.TABLE_SCHEMA = DATABASE()
   AND column_info.TABLE_NAME = expected_column.table_name
   AND column_info.COLUMN_NAME = expected_column.column_name;

  SELECT COUNT(*)
  INTO existing_index_count
  FROM (
    SELECT 'project_weekly_reports' AS table_name, 'uk_weekly_report_obligation' AS index_name
    UNION ALL SELECT 'time_entries', 'idx_time_review_status'
    UNION ALL SELECT 'time_entries', 'idx_time_corrects_entry'
    UNION ALL SELECT 'deliverables', 'idx_deliverable_quality_status'
    UNION ALL SELECT 'approval_records', 'uk_approval_request_no'
    UNION ALL SELECT 'approval_records', 'uk_approval_idempotency_key'
    UNION ALL SELECT 'milestones', 'idx_milestone_completion_lock'
  ) expected_index
  INNER JOIN (
    SELECT DISTINCT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
    FROM information_schema.STATISTICS
  ) index_info
    ON index_info.TABLE_SCHEMA = DATABASE()
   AND index_info.TABLE_NAME = expected_index.table_name
   AND index_info.INDEX_NAME = expected_index.index_name;

  SELECT COUNT(*)
  INTO existing_fk_count
  FROM (
    SELECT 'project_weekly_reports' AS table_name, 'fk_weekly_report_obligation' AS constraint_name
    UNION ALL SELECT 'project_weekly_reports', 'fk_weekly_report_submitted_version'
    UNION ALL SELECT 'project_weekly_reports', 'fk_weekly_report_reviewed_version'
    UNION ALL SELECT 'project_weekly_reports', 'fk_weekly_report_frozen_version'
    UNION ALL SELECT 'project_weekly_reports', 'fk_weekly_report_pending_correction_version'
    UNION ALL SELECT 'project_weekly_reports', 'fk_weekly_report_pending_correction_request'
    UNION ALL SELECT 'time_entries', 'fk_time_corrects_entry'
    UNION ALL SELECT 'time_entries', 'fk_time_approved_summary_version'
    UNION ALL SELECT 'time_entries', 'fk_time_locked_report_version'
    UNION ALL SELECT 'deliverables', 'fk_deliverable_current_submission'
    UNION ALL SELECT 'milestones', 'fk_milestone_completion_lock'
  ) expected_fk
  INNER JOIN information_schema.TABLE_CONSTRAINTS constraint_info
    ON constraint_info.CONSTRAINT_SCHEMA = DATABASE()
   AND constraint_info.TABLE_NAME = expected_fk.table_name
   AND constraint_info.CONSTRAINT_NAME = expected_fk.constraint_name
   AND constraint_info.CONSTRAINT_TYPE = 'FOREIGN KEY';

  IF existing_table_count <> 21
     OR existing_column_count <> 30
     OR existing_index_count <> 7
     OR existing_fk_count <> 11 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Aims v5.6 migration is incomplete (tables/columns/indexes/FKs); rerun corrected migration_v5.6_project_governance.sql';
  END IF;
END$$

CALL `aims_verify_v5_6_governance_ready`()$$
DROP PROCEDURE IF EXISTS `aims_verify_v5_6_governance_ready`$$

DELIMITER ;

SELECT
  table_name,
  table_rows
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND table_name IN (
    'weekly_reporting_settings',
    'weekly_reporting_pilot_projects',
    'project_lifecycle_events',
    'project_manager_delegations',
    'weekly_reporting_periods',
    'weekly_report_obligations',
    'project_weekly_report_versions',
    'project_weekly_report_correction_requests',
    'project_weekly_report_reviews',
    'weekly_report_corrective_action_links',
    'time_entry_review_events',
    'qa_checklist_versions',
    'deliverable_submissions',
    'deliverable_quality_reviews',
    'deliverable_waivers',
    'company_weekly_summaries',
    'company_weekly_summary_versions',
    'company_weekly_summary_items',
    'company_weekly_summary_recipient_selections',
    'company_weekly_summary_recipient_snapshots',
    'project_management_fact_snapshots'
  )
ORDER BY table_name;

SELECT
  COUNT(*) AS projects_without_lifecycle_baseline
FROM `aims_projects` project
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_lifecycle_events` event
  WHERE event.`project_id` = project.`id`
);

SELECT
  COUNT(*) AS projects_without_manager
FROM `aims_projects`
WHERE `leader_uid` IS NULL OR TRIM(`leader_uid`) = '';

SELECT
  setting.`rollout_mode`,
  setting.`timezone`,
  setting.`config_version`,
  setting.`updated_by`,
  setting.`updated_at`
FROM `weekly_reporting_settings` setting
WHERE setting.`config_key` = 'default';

SELECT
  delegation.`project_id`,
  first_delegation.`id` AS first_id,
  second_delegation.`id` AS overlapping_id
FROM `project_manager_delegations` first_delegation
INNER JOIN `project_manager_delegations` second_delegation
  ON second_delegation.`project_id` = first_delegation.`project_id`
 AND second_delegation.`id` > first_delegation.`id`
 AND second_delegation.`revoked_at` IS NULL
 AND first_delegation.`revoked_at` IS NULL
 AND second_delegation.`starts_at` < first_delegation.`ends_at`
 AND second_delegation.`ends_at` > first_delegation.`starts_at`
INNER JOIN `project_manager_delegations` delegation
  ON delegation.`id` = first_delegation.`id`;

-- Workbench 可能默认只展示最后一个 Result Grid。无重叠代理时上一个结果集为空，
-- 因此最后固定输出一行汇总，便于判断迁移是否成功。
SELECT
  metrics.`governance_table_count`,
  metrics.`milestone_completion_lock_column_count`,
  metrics.`projects_without_lifecycle_baseline`,
  metrics.`projects_without_manager`,
  metrics.`overlapping_active_delegations`,
  metrics.`default_setting_count`,
  CASE
    WHEN metrics.`governance_table_count` = 21
     AND metrics.`milestone_completion_lock_column_count` = 1
     AND metrics.`projects_without_lifecycle_baseline` = 0
     AND metrics.`projects_without_manager` = 0
     AND metrics.`overlapping_active_delegations` = 0
    THEN 'PASS'
    ELSE 'FAIL'
  END AS `migration_status`,
  CASE
    WHEN metrics.`default_setting_count` = 1
    THEN 'CONFIGURED'
    ELSE 'NOT_CONFIGURED'
  END AS `weekly_reporting_configuration`
FROM (
  SELECT
    (
      SELECT COUNT(*)
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND table_name IN (
          'weekly_reporting_settings',
          'weekly_reporting_pilot_projects',
          'project_lifecycle_events',
          'project_manager_delegations',
          'weekly_reporting_periods',
          'weekly_report_obligations',
          'project_weekly_report_versions',
          'project_weekly_report_correction_requests',
          'project_weekly_report_reviews',
          'weekly_report_corrective_action_links',
          'time_entry_review_events',
          'qa_checklist_versions',
          'deliverable_submissions',
          'deliverable_quality_reviews',
          'deliverable_waivers',
          'company_weekly_summaries',
          'company_weekly_summary_versions',
          'company_weekly_summary_items',
          'company_weekly_summary_recipient_selections',
          'company_weekly_summary_recipient_snapshots',
          'project_management_fact_snapshots'
        )
    ) AS `governance_table_count`,
    (
      SELECT COUNT(*)
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'milestones'
        AND COLUMN_NAME = 'completion_lock_request_id'
    ) AS `milestone_completion_lock_column_count`,
    (
      SELECT COUNT(*)
      FROM `aims_projects` project
      WHERE NOT EXISTS (
        SELECT 1
        FROM `project_lifecycle_events` event
        WHERE event.`project_id` = project.`id`
      )
    ) AS `projects_without_lifecycle_baseline`,
    (
      SELECT COUNT(*)
      FROM `aims_projects`
      WHERE `leader_uid` IS NULL OR TRIM(`leader_uid`) = ''
    ) AS `projects_without_manager`,
    (
      SELECT COUNT(*)
      FROM `project_manager_delegations` first_delegation
      INNER JOIN `project_manager_delegations` second_delegation
        ON second_delegation.`project_id` = first_delegation.`project_id`
       AND second_delegation.`id` > first_delegation.`id`
       AND second_delegation.`revoked_at` IS NULL
       AND first_delegation.`revoked_at` IS NULL
       AND second_delegation.`starts_at` < first_delegation.`ends_at`
       AND second_delegation.`ends_at` > first_delegation.`starts_at`
    ) AS `overlapping_active_delegations`,
    (
      SELECT COUNT(*)
      FROM `weekly_reporting_settings`
      WHERE `config_key` = 'default'
    ) AS `default_setting_count`
) metrics;
