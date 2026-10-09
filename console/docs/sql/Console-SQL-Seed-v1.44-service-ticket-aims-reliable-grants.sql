-- Generated only; do not auto-run.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT id,'aims:service-ticket:work-item','create',JSON_OBJECT('source','seed:v1.44','endpoint','/api/v1/service/service-tickets/{ticketCode}/work-item/receive'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients WHERE status='active' AND (app_code='altoc' OR client_code IN ('altoc','altoc.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
INSERT INTO service_client_grants (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT id,'altoc:service-ticket:delivery-result','sync',JSON_OBJECT('source','seed:v1.44','endpoint','/api/v1/service/service-tickets/{ticketCode}/delivery-result:sync'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients WHERE status='active' AND (app_code='aims' OR client_code IN ('aims','aims.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
COMMIT;

