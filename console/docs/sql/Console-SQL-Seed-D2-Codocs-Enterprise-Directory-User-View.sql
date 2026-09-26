-- D2 Codocs Host transfer targets and transfer submit use the current user's
-- Console department/project membership projection through the Runtime
-- audience configured for the Enterprise Host (data-runtime or tenant-runtime).
-- Prepare only. Apply to C000001 after explicit approval and a grant-table backup.
-- Disabled or differently bound existing grants are deliberately not repaired.
START TRANSACTION;
INSERT INTO service_client_grants
  (service_client_id, resource_code, action, scope_json, status, created_at, updated_at)
SELECT c.id, expected.resource_code, 'view',
  JSON_OBJECT(
    'source', 'seed:d2-codocs-enterprise-directory-user-view',
    'tenantCode', 'C000001',
    'deploymentCode', 'C000001-test-enterprise',
    'audience', expected.audience,
    'semanticScope', 'console:directory-user:view',
    'purpose', 'codocs-current-user-document-transfer-targets'
  ),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients c
JOIN (
  SELECT 'console:directory-user' AS resource_code, 'data-runtime' AS audience
  UNION ALL
  SELECT 'tenant-runtime:console:directory-user', 'tenant-runtime'
) expected
WHERE c.client_code = 'enterprise.runtime'
  AND c.app_code = 'enterprise'
  AND c.status = 'active'
  AND c.current_credential_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM service_client_grants g
    WHERE g.service_client_id = c.id
      AND g.resource_code = expected.resource_code
      AND g.action = 'view'
  );
COMMIT;
