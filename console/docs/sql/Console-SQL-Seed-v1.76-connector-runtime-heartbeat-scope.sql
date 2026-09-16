-- Console SQL Seed v1.76: audience-bound Connector Runtime heartbeat grant.
-- Date: 2026-07-15. Safe to run repeatedly; contains no credentials.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT
  `sc`.`id`,
  'console:connector-runtime',
  'heartbeat',
  COALESCE(
    `legacy`.`scope_json`,
    JSON_OBJECT('source','seed:v1.76','purpose','typed-enterprise-connector-heartbeat')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` AS `sc`
LEFT JOIN `service_client_grants` AS `legacy`
  ON `legacy`.`service_client_id`=`sc`.`id`
 AND `legacy`.`resource_code`='connector_runtime'
 AND `legacy`.`action`='heartbeat'
WHERE `sc`.`app_code`='connector-runtime'
  AND `sc`.`client_code` LIKE 'connector-runtime.%'
  AND `sc`.`status`='active'
ON DUPLICATE KEY UPDATE
  `scope_json`=VALUES(`scope_json`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

UPDATE `service_client_grants` AS `grant_row`
INNER JOIN `service_clients` AS `sc` ON `sc`.`id`=`grant_row`.`service_client_id`
SET `grant_row`.`status`='revoked',`grant_row`.`updated_at`=UTC_TIMESTAMP()
WHERE `sc`.`app_code`='connector-runtime'
  AND `sc`.`client_code` LIKE 'connector-runtime.%'
  AND `grant_row`.`resource_code`='connector_runtime'
  AND `grant_row`.`action`='heartbeat'
  AND `grant_row`.`status`='active';
