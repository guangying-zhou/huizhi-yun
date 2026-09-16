-- Console SQL Seed v1.19: feedback notify WeCom recipients.
-- Date: 2026-06-14
-- Purpose:
--   Add a tenant-scoped system parameter listing the WeCom user ids that should
--   receive a notification when feedback (IssueReporter) is submitted. Multiple
--   ids are comma separated. Resolved by Foundation when proxying feedback to the
--   WebDev intake, then pushed via the shared `sendNotification()` WeCom channel.

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
    'feedback.notify.wecomUsers',
    '反馈通知企业微信号',
    'string',
    'tenant',
    'ui',
    JSON_QUOTE(''),
    NULL,
    0,
    1,
    '收到反馈后向这些企业微信号推送通知，支持多个，用逗号分隔；留空则不通知。需 Console 已配置 wecom.default 集成',
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
    'feedback.notify.wecomUsers',
    '__tenant__',
    JSON_QUOTE(''),
    'seed',
    'seed:v1.19',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  )
ON DUPLICATE KEY UPDATE
  `updated_at` = `updated_at`;
