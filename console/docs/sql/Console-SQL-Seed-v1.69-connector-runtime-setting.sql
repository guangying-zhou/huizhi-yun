-- Console SQL Seed v1.69: Enterprise Connector Runtime setting and Phase 1 caller grant.
-- Date: 2026-07-14
-- Safe to run repeatedly. Does not contain credential material.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `setting_catalogs` (
  `setting_key`,`setting_name`,`value_type`,`scope_type`,`category`,
  `default_value_json`,`validator_json`,`is_required`,`editable_in_ui`,
  `description`,`status`,`created_at`,`updated_at`
) VALUES (
  'connector.runtimeApiUrl',
  'Enterprise Connector Runtime 地址',
  'url',
  'tenant',
  'integration',
  JSON_QUOTE(''),
  JSON_OBJECT('pattern', '^$|^https?://.+'),
  0,
  1,
  '客户侧企业连接运行时基础地址，不包含具体 capability path',
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
) ON DUPLICATE KEY UPDATE
  `setting_name`=VALUES(`setting_name`),
  `value_type`=VALUES(`value_type`),
  `scope_type`=VALUES(`scope_type`),
  `category`=VALUES(`category`),
  `default_value_json`=VALUES(`default_value_json`),
  `validator_json`=VALUES(`validator_json`),
  `editable_in_ui`=1,
  `description`=VALUES(`description`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

INSERT INTO `setting_catalogs` (
  `setting_key`,`setting_name`,`value_type`,`scope_type`,`category`,
  `default_value_json`,`validator_json`,`is_required`,`editable_in_ui`,
  `description`,`status`,`created_at`,`updated_at`
) VALUES (
  'connector.notificationsEnabled',
  '使用 Enterprise Connector Runtime 发送外部通知',
  'boolean',
  'tenant',
  'integration',
  CAST('false' AS JSON),
  NULL,
  0,
  0,
  '只能通过 Connector Runtime 管理页完成健康与兼容检查后切换',
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
  'connector-runtime:notifications',
  'send',
  JSON_OBJECT('source','seed:v1.69','providers',JSON_ARRAY('wecom'),'integrationCodes',JSON_ARRAY('wecom.default')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
INNER JOIN `service_client_grants` AS `legacy_notification_grant`
  ON `legacy_notification_grant`.`service_client_id`=`service_clients`.`id`
 AND `legacy_notification_grant`.`resource_code`='notification-runtime'
 AND `legacy_notification_grant`.`action`='send'
 AND `legacy_notification_grant`.`status`='active'
WHERE `service_clients`.`status`='active'
ON DUPLICATE KEY UPDATE
  `scope_json`=VALUES(`scope_json`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();
