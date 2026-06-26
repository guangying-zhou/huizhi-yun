-- Console SQL Seed v1.8: runtime system settings.
-- Date: 2026-04-30
-- Purpose:
--   Move non-secret runtime endpoints such as Workflow API URL into Console
--   system-settings so business apps can resolve them through license bootstrap.

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
    'workflow.apiUrl',
    'Workflow API 地址',
    'url',
    'tenant',
    'runtime',
    JSON_QUOTE('http://localhost:3020'),
    JSON_OBJECT('pattern', '^https?://.+'),
    1,
    1,
    '审批流服务基础地址，不包含 /api/v1',
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
    'workflow.apiUrl',
    '__tenant__',
    JSON_QUOTE('http://localhost:3020'),
    'seed',
    'seed:v1.8',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  )
ON DUPLICATE KEY UPDATE
  `updated_at` = `updated_at`;

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
  `id`,
  'system_settings',
  'view',
  JSON_OBJECT('settingKeys', JSON_ARRAY('workflow.apiUrl')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` = 'aims' OR `client_code` IN ('aims', 'aims.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
