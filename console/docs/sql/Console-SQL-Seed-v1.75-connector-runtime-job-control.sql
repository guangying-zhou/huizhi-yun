-- Console SQL Seed v1.75: exact Console caller grant for Connector Runtime job cancellation.
-- Date: 2026-07-14. Safe to run repeatedly; contains no credentials.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT `id`,'connector-runtime:jobs','cancel',JSON_OBJECT('source','seed:v1.75','jobTypes',JSON_ARRAY('dingtalk.people-sync')),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients` WHERE `client_code`='console.runtime' AND `app_code`='console' AND `status`='active'
ON DUPLICATE KEY UPDATE `scope_json`=VALUES(`scope_json`),`status`='active',`updated_at`=UTC_TIMESTAMP();
