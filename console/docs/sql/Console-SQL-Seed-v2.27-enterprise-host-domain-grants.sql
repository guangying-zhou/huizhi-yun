-- C000001 only. Apply after review and encrypted grant-table backup.
-- Five domain capabilities for the C000001 Host's configured data-runtime audience. Never revive revoked rows.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT('data-runtime:',d.domain,':enterprise-host'),'execute',
 JSON_OBJECT('source','seed:v2.27','purpose','enterprise-host-domain',
  'tenantCode','C000001','deploymentCode','C000001-test-enterprise',
  'audience','data-runtime','semanticScope',CONCAT(d.domain,':enterprise-host:execute')),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
CROSS JOIN (SELECT 'aims' AS domain UNION ALL SELECT 'assets' UNION ALL SELECT 'codocs' UNION ALL SELECT 'altoc' UNION ALL SELECT 'console') d
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id
   AND existing.resource_code=CONCAT('data-runtime:',d.domain,':enterprise-host')
   AND existing.action='execute'
 );
COMMIT;
