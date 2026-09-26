-- Read-only verification of the exact C000001 Enterprise service grant.
-- Both rows must be ACTIVE. Probe real issuance for both Runtime audiences
-- after an approved apply.
SELECT 'enterprise.runtime' AS expected_client, expected.audience,
  CASE
    WHEN c.id IS NULL THEN 'CLIENT_MISSING'
    WHEN c.status <> 'active' OR c.current_credential_id IS NULL THEN 'CLIENT_NOT_ACTIVE'
    WHEN g.id IS NULL THEN 'GRANT_MISSING'
    WHEN g.status <> 'active' THEN 'GRANT_NOT_ACTIVE'
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.tenantCode')), '') <> 'C000001'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.deploymentCode')), '') <> 'C000001-test-enterprise'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.audience')), '') <> expected.audience
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.semanticScope')), '') <> 'console:directory-user:view'
      THEN 'BINDING_MISMATCH'
    ELSE 'ACTIVE'
  END AS verification_status
FROM (
  SELECT 'console:directory-user' AS resource_code, 'data-runtime' AS audience
  UNION ALL
  SELECT 'tenant-runtime:console:directory-user', 'tenant-runtime'
) expected
LEFT JOIN service_clients c
  ON c.client_code = 'enterprise.runtime' AND c.app_code = 'enterprise'
LEFT JOIN service_client_grants g
  ON g.service_client_id = c.id
  AND g.resource_code = expected.resource_code
  AND g.action = 'view';
