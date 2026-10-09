-- CANDIDATE ONLY: reviewed parameters required; never run by an application.
-- @apf_tenant, @apf_deployment = Enterprise source deployment.
-- Existing rows (including revoked) are NEVER updated or revived.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants
(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, CONCAT('console:',p.resource),p.action,
 JSON_OBJECT('source','apf17a:enterprise-hr-source','tenantCode',@apf_tenant,
 'deploymentCode',@apf_deployment,'audience','console',
 'semanticScope',CONCAT('console:',p.resource,':',p.action)),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials c ON c.id=sc.current_credential_id AND c.service_client_id=sc.id AND c.status='active'
CROSS JOIN (SELECT 'hr-source-sync' resource,'view' action
 UNION ALL SELECT 'hr-source-sync','admin'
 UNION ALL SELECT 'hr-source-sync','execute') p
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND @apf_tenant REGEXP '^[A-Za-z0-9_-]{1,64}$'
 AND @apf_deployment REGEXP '^[A-Za-z0-9_-]{1,100}$'
 AND NOT EXISTS(SELECT 1 FROM service_client_grants g WHERE g.service_client_id=sc.id
 AND BINARY g.resource_code=BINARY CONCAT('console:',p.resource) AND BINARY g.action=BINARY p.action);
COMMIT;
