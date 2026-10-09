-- CANDIDATE ONLY. No environment apply authorized.
-- Bind @apf_tenant and @apf_deployment to the reviewed Enterprise deployment.
-- Both Runtime audiences are required for scheduled-worker delivery.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants
(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':',d.domain,':scheduler'),'execute',
 JSON_OBJECT('source','seed:apf18','audience',a.audience,'semanticScope',CONCAT(d.domain,':scheduler:execute'),
 'tenantCode',@apf_tenant,'deploymentCode',@apf_deployment),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials cc ON cc.id=sc.current_credential_id AND cc.service_client_id=sc.id AND cc.status='active'
CROSS JOIN (SELECT 'data-runtime' audience UNION ALL SELECT 'tenant-runtime') a
CROSS JOIN (SELECT 'altoc' domain UNION ALL SELECT 'finance' UNION ALL SELECT 'people') d
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND @apf_tenant REGEXP '^[A-Za-z0-9_-]{1,64}$' AND @apf_deployment REGEXP '^[A-Za-z0-9_-]{1,100}$'
 AND NOT EXISTS (SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id
 AND BINARY old.resource_code=BINARY CONCAT(a.audience,':',d.domain,':scheduler') AND old.action='execute');
COMMIT;
