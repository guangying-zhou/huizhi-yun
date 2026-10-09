-- C000001 only. Apply after the reviewed code and an encrypted grant backup.
-- Insert missing rows only; a revoked row is never revived.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'data-runtime:aims:admin-projects',a.action,
 JSON_OBJECT('source','seed:enterprise-aims-admin-projects','purpose','enterprise-aims-admin-projects',
  'tenantCode','C000001','deploymentCode','C000001-test-enterprise',
  'audience','data-runtime','semanticScope',CONCAT('aims:admin-projects:',a.action)),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
CROSS JOIN (SELECT 'view' AS action UNION ALL SELECT 'edit') a
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id AND existing.resource_code='data-runtime:aims:admin-projects'
   AND existing.action=a.action
 );
COMMIT;
