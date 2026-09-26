-- Candidate: one exact grant for the C000001 local Aims scheduler. Back up
-- service_client_grants first. Existing prefixed rows and revoked rows stay as is.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'aims:integration_operation','execute',
  JSON_OBJECT('source','seed:round3-a2-aims-scheduler','audience','data-runtime',
    'semanticScope','aims:integration_operation:execute','tenantCode','C000001',
    'deploymentCode','C000001-test-aims'),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active'
  AND NOT EXISTS (SELECT 1 FROM service_client_grants g WHERE g.service_client_id=sc.id
    AND g.resource_code='aims:integration_operation' AND g.action='execute');
SELECT ROW_COUNT() AS inserted_rows;
COMMIT;
