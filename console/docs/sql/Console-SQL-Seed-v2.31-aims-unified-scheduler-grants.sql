-- CANDIDATE ONLY: C000001 local Aims unified scheduler, not an environment apply.
-- Existing physical rows (including revoked or older unbound rows) are never changed.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':aims:',s.resource_code),'execute',
 JSON_OBJECT('source','seed:v2.31','purpose','aims-unified-scheduler',
  'tenantCode','C000001','deploymentCode','C000001-test-aims',
  'audience',a.audience,'semanticScope',CONCAT('aims:',s.resource_code,':execute')),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
CROSS JOIN (
 SELECT 'integration_operation' AS resource_code
 UNION ALL SELECT 'notifications-due'
 UNION ALL SELECT 'milestone-rollover'
) s
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id
   AND existing.resource_code=CONCAT(a.audience,':aims:',s.resource_code)
   AND existing.action='execute'
 );
COMMIT;
