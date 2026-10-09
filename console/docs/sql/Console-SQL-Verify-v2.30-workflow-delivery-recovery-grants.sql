-- CANDIDATE ONLY. Must return exactly two rows, each disabled with no
-- credential and exact_rows=active_exact_rows=1. Grant active != client active.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT a.audience,sc.status AS client_status,sc.current_credential_id,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.30'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose'))='workflow-controlled-delivery-recovery'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=a.audience
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-workflow-local'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='workflow:delivery-recovery:execute'
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=CONCAT(a.audience,':workflow:delivery-recovery') AND g.action='execute'
WHERE sc.client_code='workflow.maintenance' AND sc.app_code='workflow'
GROUP BY sc.id,a.audience,sc.status,sc.current_credential_id
ORDER BY a.audience;
