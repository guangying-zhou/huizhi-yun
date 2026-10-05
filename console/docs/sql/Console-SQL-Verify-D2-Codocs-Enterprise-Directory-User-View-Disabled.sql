-- Expect DISABLED for both exact D2 grants after approved cutover.
SELECT expected.audience,
  CASE WHEN g.id IS NULL THEN 'GRANT_MISSING'
    WHEN g.status = 'inactive' THEN 'INACTIVE'
    ELSE 'GRANT_STILL_ACTIVE' END AS verification_status
FROM (SELECT 'console:directory-user' resource_code, 'data-runtime' audience
      UNION ALL SELECT 'tenant-runtime:console:directory-user', 'tenant-runtime') expected
JOIN service_clients c ON c.client_code = 'enterprise.runtime' AND c.app_code = 'enterprise'
LEFT JOIN service_client_grants g ON g.service_client_id = c.id
  AND g.resource_code = expected.resource_code AND g.action = 'view'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.source')) = 'seed:d2-codocs-enterprise-directory-user-view'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.tenantCode')) = 'C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.deploymentCode')) = 'C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json, '$.audience')) = expected.audience;
