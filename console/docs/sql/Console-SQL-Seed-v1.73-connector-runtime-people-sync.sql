-- Console SQL Seed v1.73: exact Console caller grants for Connector Runtime People sync.
-- Date: 2026-07-14. Safe to run repeatedly; contains no credentials.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT `id`,'connector-runtime:people','sync',JSON_OBJECT('source','seed:v1.73','provider','dingtalk','integrationCode','dingtalk.default'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients` WHERE `client_code`='console.runtime' AND `app_code`='console' AND `status`='active'
ON DUPLICATE KEY UPDATE `scope_json`=VALUES(`scope_json`),`status`='active',`updated_at`=UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT `id`,'connector-runtime:jobs','view',JSON_OBJECT('source','seed:v1.73','jobTypes',JSON_ARRAY('dingtalk.people-sync')),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients` WHERE `client_code`='console.runtime' AND `app_code`='console' AND `status`='active'
ON DUPLICATE KEY UPDATE `scope_json`=VALUES(`scope_json`),`status`='active',`updated_at`=UTC_TIMESTAMP();
