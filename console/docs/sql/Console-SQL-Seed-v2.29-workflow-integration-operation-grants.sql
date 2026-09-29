-- CANDIDATE ONLY: review before any environment write.
-- C000001 local Workflow scheduler, two supported Runtime audiences.
-- Do not revive an existing revoked or mismatched physical grant.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':workflow:integration_operation'),'execute',
 JSON_OBJECT('source','seed:v2.29','purpose','workflow-scheduled-outbox-drain',
  'tenantCode','C000001','deploymentCode','C000001-test-workflow-local',
  'audience',a.audience,'semanticScope','workflow:integration_operation:execute'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
WHERE sc.client_code='workflow.runtime' AND sc.app_code='workflow' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id
   AND existing.resource_code=CONCAT(a.audience,':workflow:integration_operation')
   AND existing.action='execute'
 );
COMMIT;
