-- Console SQL Seed v1.22: People rank series settings.
-- Date: 2026-06-17
-- Purpose:
--   Add People application parameters in Console system settings:
--     people.rankSeries.managementCount     管理序列职级数, default 5
--     people.rankSeries.professionalCount   专业序列职级数, default 10
--   Authorize People runtime to read these settings through Console service token.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

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
    'people.rankSeries.managementCount',
    '管理序列职级数',
    'number',
    'tenant',
    'application',
    JSON_EXTRACT('5', '$'),
    JSON_OBJECT('min', 1, 'max', 20),
    1,
    1,
    'People 管理序列 M 的职级数量；职级设置页按 M1..Mn 展示。',
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  ),
  (
    'people.rankSeries.professionalCount',
    '专业序列职级数',
    'number',
    'tenant',
    'application',
    JSON_EXTRACT('10', '$'),
    JSON_OBJECT('min', 1, 'max', 30),
    1,
    1,
    'People 专业序列 P 的职级数量；职级设置页按 P1..Pn 展示。',
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
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  sc.`id`,
  'system_settings',
  'view',
  JSON_OBJECT(
    'source', 'seed:v1.22',
    'purpose', 'people-read-rank-series-settings',
    'settingKeys', JSON_ARRAY(
      'people.rankSeries.managementCount',
      'people.rankSeries.professionalCount'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

SELECT
  c.`setting_key`,
  c.`setting_name`,
  c.`default_value_json`,
  c.`category`,
  c.`status`
FROM `setting_catalogs` c
WHERE c.`setting_key` IN (
  'people.rankSeries.managementCount',
  'people.rankSeries.professionalCount'
)
ORDER BY c.`setting_key`;
