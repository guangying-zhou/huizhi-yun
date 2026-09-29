-- Read-only verification for the exact Enterprise Host notification grant.
-- ACTIVE is necessary; a real audience=notifications token probe is still required.
SELECT 'enterprise.runtime' AS expected_client,
  CASE
    WHEN c.id IS NULL THEN 'CLIENT_MISSING'
    WHEN c.status <> 'active' OR c.current_credential_id IS NULL THEN 'CLIENT_NOT_ACTIVE'
    WHEN g.id IS NULL THEN 'GRANT_MISSING'
    WHEN g.status <> 'active' THEN 'GRANT_NOT_ACTIVE'
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.tenantCode')), '') <> 'C000001'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.deploymentCode')), '') <> 'C000001-test-enterprise'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.audience')), '') <> 'notifications'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.semanticScope')), '') <> 'notifications:publish'
      THEN 'BINDING_MISMATCH'
    ELSE 'ACTIVE'
  END AS verification_status
FROM (SELECT 1) expected
LEFT JOIN service_clients c
  ON c.client_code = 'enterprise.runtime' AND c.app_code = 'enterprise'
LEFT JOIN service_client_grants g
  ON g.service_client_id = c.id
  AND g.resource_code = 'notifications'
  AND g.action = 'publish';
