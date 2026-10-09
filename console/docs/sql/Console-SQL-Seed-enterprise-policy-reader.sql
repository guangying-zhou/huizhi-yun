-- Prepared installer only: run in the explicitly approved tenant Console DB.
-- Exact read capability serves data-runtime AND tenant-runtime audiences.
-- Do not revive disabled grants; never grant Enterprise policy write.
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT c.id,expected.resource_code,'read',
  JSON_OBJECT('source','enterprise-policy-reader','audience',expected.audience,'semanticScope','console:policy-bundle:read'),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients c JOIN (
  SELECT 'console:policy-bundle' resource_code,'console' audience
  UNION ALL SELECT 'data-runtime:console:policy-bundle','data-runtime'
  UNION ALL SELECT 'tenant-runtime:console:policy-bundle','tenant-runtime'
) expected
WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise' AND c.status='active'
  AND c.current_credential_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM service_client_grants g
    WHERE g.service_client_id=c.id AND g.resource_code=expected.resource_code AND g.action='read');
