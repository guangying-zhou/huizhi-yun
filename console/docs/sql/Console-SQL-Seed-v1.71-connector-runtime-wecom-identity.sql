-- Console SQL Seed v1.71: Connector Runtime WeCom identity activation and exact caller grant.
-- Date: 2026-07-14
-- Safe to run repeatedly. Does not contain credential material.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `setting_catalogs` (
  `setting_key`,`setting_name`,`value_type`,`scope_type`,`category`,
  `default_value_json`,`validator_json`,`is_required`,`editable_in_ui`,
  `description`,`status`,`created_at`,`updated_at`
) VALUES (
  'connector.identityEnabled',
  '使用 Enterprise Connector Runtime 交换企业登录身份',
  'boolean',
  'tenant',
  'integration',
  CAST('false' AS JSON),
  NULL,
  0,
  0,
  '只能在管理端验证企业微信身份 capability 后启用',
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
) ON DUPLICATE KEY UPDATE
  `setting_name`=VALUES(`setting_name`),
  `value_type`='boolean',
  `scope_type`='tenant',
  `category`='integration',
  `default_value_json`=CAST('false' AS JSON),
  `editable_in_ui`=0,
  `description`=VALUES(`description`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (
  `service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`
)
SELECT
  `service_clients`.`id`,
  'connector-runtime:identity',
  'exchange',
  JSON_OBJECT('source','seed:v1.71','providers',JSON_ARRAY('wecom'),'integrationCodes',JSON_ARRAY('wecom.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `service_clients`.`client_code`='console.runtime'
  AND `service_clients`.`app_code`='console'
  AND `service_clients`.`status`='active'
ON DUPLICATE KEY UPDATE
  `scope_json`=VALUES(`scope_json`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();
