-- Console SQL Seed v1.72: Connector Runtime DingTalk identity and integration grants.
-- Date: 2026-07-14
-- Safe to run repeatedly. Does not contain credential material.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `setting_catalogs` (
  `setting_key`,`setting_name`,`value_type`,`scope_type`,`category`,
  `default_value_json`,`validator_json`,`is_required`,`editable_in_ui`,
  `description`,`status`,`created_at`,`updated_at`
) VALUES (
  'connector.dingtalkIdentityEnabled',
  '使用 Enterprise Connector Runtime 交换钉钉登录身份',
  'boolean',
  'tenant',
  'integration',
  CAST('false' AS JSON),
  NULL,
  0,
  0,
  '只能在管理端验证钉钉身份 capability 后启用',
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
  'connector-runtime:identity:dingtalk',
  'exchange',
  JSON_OBJECT('source','seed:v1.72','providers',JSON_ARRAY('dingtalk'),'integrationCodes',JSON_ARRAY('dingtalk.default','dingtalk.identity')),
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

UPDATE `service_client_grants` AS `grant_row`
INNER JOIN `service_clients` AS `client_row`
  ON `client_row`.`id`=`grant_row`.`service_client_id`
SET `grant_row`.`scope_json`=JSON_SET(
      COALESCE(`grant_row`.`scope_json`, JSON_OBJECT()),
      '$.source', 'seed:v1.72',
      '$.integrationCodes', JSON_ARRAY('wecom.default','dingtalk.default','dingtalk.identity')
    ),
    `grant_row`.`status`='active',
    `grant_row`.`updated_at`=UTC_TIMESTAMP()
WHERE `client_row`.`app_code`='connector-runtime'
  AND `client_row`.`status`='active'
  AND (`grant_row`.`resource_code`,`grant_row`.`action`) IN (
    ('integration_config','view'),
    ('credential_vault','resolve')
  );
