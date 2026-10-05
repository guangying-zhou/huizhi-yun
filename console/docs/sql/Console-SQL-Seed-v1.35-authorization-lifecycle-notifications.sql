-- Console SQL Seed v1.35: authorization lifecycle failure notification recipients.
-- Date: 2026-07-09
-- Purpose:
--   Configure active Console Directory user UIDs that receive People lifecycle
--   authorization failure notifications when the originating request has no
--   verified human operator UID. An empty list keeps failures in operation logs.

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
VALUES (
  'notification.authorizationLifecycleRecipients',
  '授权生命周期失败通知收件人',
  'json',
  'tenant',
  'notification',
  JSON_ARRAY(),
  JSON_OBJECT(),
  0,
  1,
  'People 任职或离职的 Platform 授权同步失败且缺少操作人时，接收站内告警的 active Directory 用户 UID 列表。',
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

-- Optional tenant value example (replace the sample UIDs before applying):
-- INSERT INTO `setting_values` (
--   `setting_key`, `scope_key`, `value_json`, `source`, `updated_by`, `created_at`, `updated_at`
-- ) VALUES (
--   'notification.authorizationLifecycleRecipients', '__tenant__',
--   JSON_ARRAY('security-admin-uid'), 'custom', 'bootstrap', UTC_TIMESTAMP(), UTC_TIMESTAMP()
-- ) ON DUPLICATE KEY UPDATE
--   `value_json` = VALUES(`value_json`),
--   `source` = 'custom',
--   `updated_by` = VALUES(`updated_by`),
--   `updated_at` = UTC_TIMESTAMP();
