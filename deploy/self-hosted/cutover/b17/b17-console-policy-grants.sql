-- S4 B17 fix 5: audience-bound console:policy-bundle grants for console.runtime (prod hzy_console, C000001).
-- The restored rows 'console:policy-bundle' read/write carry scope_json {"source":"policy-bundle-install"} only; the Runtime
-- signer (data-runtime/internal/apps/console/auth_service_scope_mapping.go) authorises a scope only through an audience-bound grant
-- and keeps no legacy fallback, so Console's verified-policy token request fails with insufficient_scope. Existing rows are left untouched.
-- Guards (any one failing writes nothing): console.runtime exists, is active and has a credential; the enterprise.runtime reference grant
-- 'data-runtime:console:policy-bundle'/'read' (G-7, same physical naming) is present and active; none of the four rows exists yet. One transaction; mysql client.
SET @cid = (SELECT id FROM service_clients WHERE client_code='console.runtime' AND app_code='console' AND status='active' AND current_credential_id IS NOT NULL);
SET @ref = (SELECT COUNT(*) FROM service_client_grants g JOIN service_clients e ON e.id=g.service_client_id WHERE e.client_code='enterprise.runtime' AND g.resource_code='data-runtime:console:policy-bundle' AND g.action='read' AND g.status='active');
SET @pre = (SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=@cid AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='s4-b17-console-policy');
START TRANSACTION;
INSERT INTO service_client_grants (service_client_id, resource_code, action, scope_json, status, created_at, updated_at)
SELECT @cid, CONCAT(a.audience, ':console:policy-bundle'), a.action,
  JSON_OBJECT('source','s4-b17-console-policy','audience',a.audience,'tenantCode','C000001','deploymentCode','C000001-console',
              'semanticScope',CONCAT('console:policy-bundle:',a.action)),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM (SELECT 'data-runtime' AS audience,'read' AS action UNION ALL SELECT 'data-runtime','write'
      UNION ALL SELECT 'tenant-runtime','read' UNION ALL SELECT 'tenant-runtime','write') a
WHERE @cid IS NOT NULL AND @ref = 1 AND @pre = 0;
COMMIT;
SELECT id, resource_code, action, status, scope_json FROM service_client_grants
WHERE service_client_id=@cid AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='s4-b17-console-policy' ORDER BY id;
