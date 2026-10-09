-- C000001 local only. Read-only. Mirrors Console mapServiceAudienceScopes for aims.runtime:
-- an active grant matches (scope, audience) when it is bound to that audience and its
-- semanticScope equals the scope (or its physical scope equals an audience-prefixed scope),
-- or when it has no audience and its physical scope equals the scope (legacy lane).
-- Ready when every enabled combination has exactly one match bound to C000001 /
-- C000001-test-aims, notifications-due has none, and legacy row 529971 is revoked.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT e.scope, a.audience, e.enabled,
 COUNT(g.id) AS matching_rows,
 SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
     AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-aims') AS bound_rows,
 CASE
  WHEN e.enabled=1 AND COUNT(g.id)=1 AND SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
       AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-aims')=1 THEN 'ready'
  WHEN e.enabled=0 AND COUNT(g.id)=0 THEN 'ready'
  ELSE 'NOT_READY' END AS verdict
FROM (SELECT 'aims:integration_operation:execute' AS scope, 1 AS enabled
      UNION ALL SELECT 'aims:milestone-rollover:execute', 1
      UNION ALL SELECT 'aims:notifications-due:execute', 0) e
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
JOIN service_clients sc ON sc.client_code='aims.runtime' AND sc.app_code='aims'
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.status='active' AND (
  (JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=a.audience AND (
     JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=e.scope
     OR (CONCAT(g.resource_code,':',g.action)=e.scope AND e.scope LIKE CONCAT(a.audience,':%'))))
  OR (JSON_EXTRACT(g.scope_json,'$.audience') IS NULL AND CONCAT(g.resource_code,':',g.action)=e.scope))
GROUP BY e.scope, a.audience, e.enabled
ORDER BY e.scope, a.audience;
SELECT id, resource_code, status FROM service_client_grants WHERE id IN (529971, 530061, 13227398) ORDER BY id;
