-- C000001 local test only. Encrypt a service_client_grants backup before apply.
-- Foundation prefixes the exact Runtime request with data-runtime; Runtime
-- strips that audience prefix when checking aims:project-documents:read.
-- The existing data-runtime:aims/read row is unchanged. No tenant-runtime call.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'data-runtime:aims:project-documents','read',
 JSON_OBJECT('source','seed:round3-project-document-read','purpose','enterprise-project-document-read',
  'tenantCode','C000001','deploymentCode','C000001-test-aims',
  'audience','data-runtime','semanticScope','aims:project-documents:read'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id AND existing.resource_code='data-runtime:aims:project-documents'
   AND existing.action='read'
 );
COMMIT;
