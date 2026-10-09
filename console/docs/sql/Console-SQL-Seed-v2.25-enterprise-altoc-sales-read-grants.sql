-- C000001 test Enterprise only; apply is an environment write performed by
-- the authorized operator after merge, never automatically by code delivery.
-- Back up affected grant rows securely before apply; insert missing only.
-- Existing revoked/custom grants are preserved and must fail verify.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT('data-runtime:altoc:',r.resource),'view',
 JSON_OBJECT('source','seed:enterprise-altoc-g2-read','purpose','enterprise-altoc-g2-read',
  'tenantCode','C000001','deploymentCode','C000001-test-enterprise',
  'audience','data-runtime','semanticScope',CONCAT('altoc:',r.resource,':view')),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
CROSS JOIN (SELECT 'lead' AS resource UNION ALL SELECT 'opportunity' UNION ALL SELECT 'quotation') r
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id AND existing.resource_code=CONCAT('data-runtime:altoc:',r.resource)
   AND existing.action='view'
 );
COMMIT;
