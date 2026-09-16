-- Console SQL Seed v1.18: feedback reporter toggle.
-- Date: 2026-06-14
-- Purpose:
--   Add a tenant-scoped system parameter that controls whether business apps
--   render the feedback floating button (IssueReporter). Resolved by Foundation
--   via `GET /api/runtime/feedback-reporter` using the existing
--   `system_settings:view` service grant.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `setting_catalogs` (
  `setting_key`,
  `setting_name`,
  `value_type`,
  `scope_type`,
  `category`,
  `default_value_json`,
  `validator_json`,
  `is_required`,
  `editable_in_ui`,
  `description`,
  `status`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'feedback.reporter.enabled',
    '启用应用/页面反馈',
    'boolean',
    'tenant',
    'ui',
    CAST('true' AS JSON),
    NULL,
    0,
    1,
    '启用后各应用在页面右下角展示反馈浮动按钮，用于采集缺陷/建议/咨询并提交至 WebDev Issue 收件箱',
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  )
ON DUPLICATE KEY UPDATE
  `setting_name` = VALUES(`setting_name`),
  `value_type` = VALUES(`value_type`),
  `scope_type` = VALUES(`scope_type`),
  `category` = VALUES(`category`),
  `default_value_json` = VALUES(`default_value_json`),
  `validator_json` = VALUES(`validator_json`),
  `is_required` = VALUES(`is_required`),
  `editable_in_ui` = VALUES(`editable_in_ui`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `setting_values` (
  `setting_key`,
  `scope_key`,
  `value_json`,
  `source`,
  `updated_by`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'feedback.reporter.enabled',
    '__tenant__',
    CAST('true' AS JSON),
    'seed',
    'seed:v1.18',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  )
ON DUPLICATE KEY UPDATE
  `updated_at` = `updated_at`;
