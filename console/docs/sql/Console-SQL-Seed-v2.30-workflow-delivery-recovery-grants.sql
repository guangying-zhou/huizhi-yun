-- CANDIDATE ONLY: huizhiyun-fa must approve identity and capability before use.
-- A disabled workflow.maintenance client with no credential must first be
-- registered by the approved control-plane process. This seed does not
-- activate it or create a credential. workflow.runtime never gets recovery.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':workflow:delivery-recovery'),'execute',
 JSON_OBJECT('source','seed:v2.30','purpose','workflow-controlled-delivery-recovery',
  'tenantCode','C000001','deploymentCode','C000001-test-workflow-local',
  'audience',a.audience,'semanticScope','workflow:delivery-recovery:execute'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
WHERE sc.client_code='workflow.maintenance' AND sc.app_code='workflow'
 AND sc.status='disabled' AND sc.current_credential_id IS NULL
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id
   AND existing.resource_code=CONCAT(a.audience,':workflow:delivery-recovery')
   AND existing.action='execute'
 );
COMMIT;
