-- Console SQL Seed v1.39: repeatable, secret-free Finance detail grant.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_clients` (`client_code`,`client_name`,`client_type`,`app_code`,`description`,`status`,`created_at`,`updated_at`)
VALUES ('console.runtime','Console Runtime','runtime','console','Console local service-token issuer identity','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `status`='active',`updated_at`=UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (`service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`)
SELECT `id`,'finance:notification-details','authorize',JSON_OBJECT('source','seed:v1.39','purpose','console-local-service-token-issuer'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients` WHERE `client_code`='console.runtime'
ON DUPLICATE KEY UPDATE `scope_json`=VALUES(`scope_json`),`status`='active',`updated_at`=UTC_TIMESTAMP();

-- Credential and Vault material remain owned by Console issuer bootstrap.
