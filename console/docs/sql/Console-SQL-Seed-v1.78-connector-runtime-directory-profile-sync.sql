-- Console SQL Seed v1.78: exact grants for DingTalk directory profile sync.
-- Date: 2026-07-15. Safe to run repeatedly; contains no credentials.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Profile batches are delivered at least once. Keep the callback idempotent even
-- on Console databases that predate the directory lifecycle reliability schema.
CREATE TABLE IF NOT EXISTS `service_command_receipt` (
  `receipt_id` CHAR(36) PRIMARY KEY,
  `operation_id` CHAR(36) NOT NULL,
  `operation_code` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tenant_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_deployment_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `deployment_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_app` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_app` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `required_capability` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `command_schema_version` VARCHAR(30) NOT NULL,
  `command_sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `service_client_id` VARCHAR(100) NULL,
  `target_biz_type` VARCHAR(100) NULL,
  `target_biz_code` VARCHAR(191) NULL,
  `response_http_status` SMALLINT UNSIGNED NULL,
  `response_summary_sha256` CHAR(64) NULL,
  `result_json` JSON NULL,
  `received_at` DATETIME(3) NOT NULL,
  `last_received_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE KEY `uk_console_scr_identity` (
    `tenant_code`,`source_deployment_code`,`deployment_code`,
    `source_app`,`target_app`,`operation_code`,`idempotency_key`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Console starts only the typed Connector Runtime DingTalk directory profile job.
INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT `id`,'connector-runtime:directory','sync',JSON_OBJECT(
  'source','seed:v1.78','provider','dingtalk','integrationCode','dingtalk.default','writeScope','directory-name-only'
),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients`
WHERE `client_code`='console.runtime' AND `app_code`='console' AND `status`='active'
ON DUPLICATE KEY UPDATE `scope_json`=VALUES(`scope_json`),`status`='active',`updated_at`=UTC_TIMESTAMP();

-- The enrolled Connector Runtime may call back only the typed Console profile projection endpoint.
INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT `sc`.`id`,'console:directory-profiles','sync',JSON_MERGE_PATCH(
  COALESCE(`existing_grant`.`scope_json`,JSON_OBJECT()),
  JSON_OBJECT(
    'source','seed:v1.78',
    'purpose','typed-enterprise-connector',
    'tenantCode',`runtime_instance`.`tenant_code`,
    'deploymentCode',`runtime_instance`.`deployment_code`,
    'provider','dingtalk',
    'integrationCode','dingtalk.default',
    'matchKey','email',
    'writeFields',JSON_ARRAY('real_name','display_name')
  )
),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients` AS `sc`
INNER JOIN `connector_runtime_instances` AS `runtime_instance`
  ON `runtime_instance`.`connector_id`=`sc`.`client_code`
LEFT JOIN `service_client_grants` AS `existing_grant`
  ON `existing_grant`.`service_client_id`=`sc`.`id`
 AND `existing_grant`.`resource_code`='console:directory-profiles'
 AND `existing_grant`.`action`='sync'
WHERE `sc`.`app_code`='connector-runtime'
  AND `sc`.`client_code` LIKE 'connector-runtime.%'
  AND `sc`.`status`='active'
ON DUPLICATE KEY UPDATE `scope_json`=VALUES(`scope_json`),`status`='active',`updated_at`=UTC_TIMESTAMP();
