-- CANDIDATE ONLY. No execution is authorized by this file.
-- Set @apf_tenant, @apf_deployment and @apf_audience from the reviewed Host
-- deployment. Audience is ONE actual Runtime audience, not both by default.
-- Encrypted backup + plan/review + verify are required before any future apply.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants
 (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, CONCAT(@apf_audience,':',d.domain,':',c.resource),c.action,
 JSON_OBJECT('source','seed:v2.34','purpose','apf-fixed-channel',
  'tenantCode',@apf_tenant,'deploymentCode',@apf_deployment,
  'audience',@apf_audience,'semanticScope',CONCAT(d.domain,':',c.resource,':',c.action)),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
 AND scc.service_client_id=sc.id AND scc.status='active'
CROSS JOIN (SELECT 'altoc' AS domain UNION ALL SELECT 'people' UNION ALL SELECT 'finance') d
CROSS JOIN (SELECT 'enterprise-host' AS resource,'execute' AS action
 UNION ALL SELECT 'scheduler','execute'
 UNION ALL SELECT 'notification-detail','authorize') c
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND @apf_audience IN ('data-runtime','tenant-runtime')
 AND @apf_tenant REGEXP '^[A-Za-z0-9_-]{1,64}$'
 AND @apf_deployment REGEXP '^[A-Za-z0-9_-]{1,100}$'
 AND NOT EXISTS (SELECT 1 FROM service_client_grants old
  WHERE old.service_client_id=sc.id AND BINARY old.resource_code=BINARY CONCAT(@apf_audience,':',d.domain,':',c.resource) AND old.action=c.action);
COMMIT;
