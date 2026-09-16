-- Console SQL Seed v1.21: data runtime management settings.
-- Date: 2026-06-15
-- Purpose:
--   Configure tenant/data runtime endpoint and package channel for the Console
--   runtime management page.

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
    'dataRuntime.runtimeApiUrl',
    'Data Runtime 地址',
    'url',
    'tenant',
    'runtime',
    JSON_QUOTE(''),
    JSON_OBJECT('pattern', '^$|^https?://.+'),
    0,
    1,
    '客户侧 tenant-runtime / hzy-data-runtime 基础地址',
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  ),
  (
    'dataRuntime.packageBaseUrl',
    'Data Runtime 下载地址',
    'url',
    'tenant',
    'runtime',
    JSON_QUOTE('https://downloads.huizhi.yun/packages/hzy-data-runtime'),
    JSON_OBJECT('pattern', '^https?://.+'),
    1,
    1,
    'hzy-data-runtime 发布物下载根地址',
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  ),
  (
    'dataRuntime.audience',
    'Data Runtime Token Audience',
    'string',
    'tenant',
    'runtime',
    JSON_QUOTE('data-runtime'),
    JSON_OBJECT('allowedValues', JSON_ARRAY('tenant-runtime', 'data-runtime')),
    1,
    1,
    'Console 调用 data-runtime 管理接口时使用的 service token audience；新 tenant-runtime 部署可改为 tenant-runtime',
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
