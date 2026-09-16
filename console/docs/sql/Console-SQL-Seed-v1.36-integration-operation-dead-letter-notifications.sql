-- Console SQL Seed v1.36: integration-operation dead-letter notifications.
-- Date: 2026-07-10
-- Purpose:
--   1. Allow active Aims and Altoc runtime service clients to publish only
--      through the notifications audience/scope contract.
--   2. Configure fallback active Directory recipients when a dead-lettered
--      operation has no active original operator.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `setting_catalogs` (
  `setting_key`, `setting_name`, `value_type`, `scope_type`, `category`,
  `default_value_json`, `validator_json`, `is_required`, `editable_in_ui`,
  `description`, `status`, `created_at`, `updated_at`
)
VALUES (
  'notification.integrationOperationRecipients',
  '跨应用死信任务通知收件人',
  'json',
  'tenant',
  'notification',
  JSON_ARRAY(),
  JSON_OBJECT(),
  0,
  1,
  'Aims 或 Altoc 跨应用任务进入死信且缺少 active 原操作人时，接收站内告警的 active Directory 用户 UID 列表。',
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

INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`,
  'notifications',
  'publish',
  JSON_OBJECT(
    'source', 'seed:v1.36',
    'purpose', 'integration-operation-dead-letter-notification',
    'endpoint', '/api/v1/console/notifications/integration-operation-dead-letter'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('aims', 'altoc')
    OR sc.`client_code` IN ('aims', 'aims.runtime', 'altoc', 'altoc.runtime')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

-- Optional tenant value example (replace sample UIDs before applying):
-- INSERT INTO `setting_values` (
--   `setting_key`, `scope_key`, `value_json`, `source`, `updated_by`, `created_at`, `updated_at`
-- ) VALUES (
--   'notification.integrationOperationRecipients', '__tenant__',
--   JSON_ARRAY('operations-admin-uid'), 'custom', 'bootstrap', UTC_TIMESTAMP(), UTC_TIMESTAMP()
-- ) ON DUPLICATE KEY UPDATE
--   `value_json` = VALUES(`value_json`),
--   `source` = 'custom',
--   `updated_by` = VALUES(`updated_by`),
--   `updated_at` = UTC_TIMESTAMP();

SELECT
  sc.`client_code`,
  sc.`app_code`,
  MAX(scg.`resource_code` = 'notifications' AND scg.`action` = 'publish' AND scg.`status` = 'active') AS `has_notifications_publish`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` IN ('aims', 'altoc')
   OR sc.`client_code` IN ('aims', 'aims.runtime', 'altoc', 'altoc.runtime')
GROUP BY sc.`client_code`, sc.`app_code`
ORDER BY sc.`client_code`;
