-- Console SQL Migration v1.74: Connector Runtime heartbeat, metering and revocation.
-- Date: 2026-07-14
-- Apply before publishing Connector Runtime 0.4.0. Safe to run repeatedly on MySQL 8+.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MySQL 8.0 does not accept ADD COLUMN IF NOT EXISTS. Build each DDL from
-- information_schema so this migration remains repeatable across supported 8.x releases.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='connector_runtime_instances' AND COLUMN_NAME='last_heartbeat_at')=0,
  'ALTER TABLE `connector_runtime_instances` ADD COLUMN `last_heartbeat_at` DATETIME(3) NULL AFTER `last_seen_at`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='connector_runtime_instances' AND COLUMN_NAME='runtime_started_at')=0,
  'ALTER TABLE `connector_runtime_instances` ADD COLUMN `runtime_started_at` DATETIME(3) NULL AFTER `last_heartbeat_at`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='connector_runtime_instances' AND COLUMN_NAME='metrics_json')=0,
  'ALTER TABLE `connector_runtime_instances` ADD COLUMN `metrics_json` JSON NULL AFTER `runtime_started_at`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='connector_runtime_instances' AND COLUMN_NAME='revoked_at')=0,
  'ALTER TABLE `connector_runtime_instances` ADD COLUMN `revoked_at` DATETIME(3) NULL AFTER `metrics_json`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `service_client_grants` (
  `service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`
)
SELECT
  sc.`id`,
  'connector_runtime',
  'heartbeat',
  JSON_OBJECT(
    'source','connector-runtime-operations-v1.74',
    'purpose','device-heartbeat',
    'tenantCode',cri.`tenant_code`,
    'deploymentCode',cri.`deployment_code`
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `connector_runtime_instances` cri
INNER JOIN `service_clients` sc
  ON sc.`client_code`=LEFT(cri.`connector_id`,100)
 AND sc.`app_code`='connector-runtime'
ON DUPLICATE KEY UPDATE
  `scope_json`=VALUES(`scope_json`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (
  `service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`
)
SELECT
  sc.`id`,
  'connector-runtime:diagnostics',
  'view',
  JSON_OBJECT('source','connector-runtime-operations-v1.74'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`client_code`='console.runtime'
ON DUPLICATE KEY UPDATE
  `scope_json`=VALUES(`scope_json`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

SELECT `connector_id`,`status`,`last_heartbeat_at`,`agent_version`
FROM `connector_runtime_instances`
ORDER BY `updated_at` DESC;
