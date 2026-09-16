-- Console SQL Migration v1.77: bind DingTalk OAuth transactions to an
-- independent identity integration and authorize Connector Runtime to read it.
-- Date: 2026-07-15. Safe to run repeatedly on MySQL 8+; contains no credentials.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MySQL 8.0 does not accept ADD COLUMN IF NOT EXISTS.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE()
     AND TABLE_NAME='auth_external_login_transactions'
     AND COLUMN_NAME='integration_code')=0,
  'ALTER TABLE `auth_external_login_transactions` ADD COLUMN `integration_code` VARCHAR(128) NULL AFTER `provider_code`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Console is the only caller of the typed DingTalk identity exchange. The
-- integration allowlist is explicit even though the runtime endpoint is fixed.
UPDATE `service_client_grants` AS `grant_row`
INNER JOIN `service_clients` AS `client_row`
  ON `client_row`.`id`=`grant_row`.`service_client_id`
SET `grant_row`.`scope_json`=JSON_SET(
      COALESCE(`grant_row`.`scope_json`, JSON_OBJECT()),
      '$.source', 'migration:v1.77',
      '$.providers', JSON_ARRAY('dingtalk'),
      '$.integrationCodes', JSON_ARRAY('dingtalk.default','dingtalk.identity')
    ),
    `grant_row`.`status`='active',
    `grant_row`.`updated_at`=UTC_TIMESTAMP()
WHERE `client_row`.`client_code`='console.runtime'
  AND `client_row`.`app_code`='console'
  AND `grant_row`.`resource_code`='connector-runtime:identity:dingtalk'
  AND `grant_row`.`action`='exchange';

-- Each enrolled Connector Runtime needs read/resolve access to the dedicated
-- identity integration; People and notifications remain on dingtalk.default.
UPDATE `service_client_grants` AS `grant_row`
INNER JOIN `service_clients` AS `client_row`
  ON `client_row`.`id`=`grant_row`.`service_client_id`
SET `grant_row`.`scope_json`=JSON_SET(
      COALESCE(`grant_row`.`scope_json`, JSON_OBJECT()),
      '$.source', 'migration:v1.77',
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

SELECT `COLUMN_NAME`,`COLUMN_TYPE`,`IS_NULLABLE`
FROM `information_schema`.`COLUMNS`
WHERE `TABLE_SCHEMA`=DATABASE()
  AND `TABLE_NAME`='auth_external_login_transactions'
  AND `COLUMN_NAME`='integration_code';
