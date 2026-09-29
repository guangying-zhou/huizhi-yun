-- CANDIDATE ONLY. Each audience must have exactly one ACTIVE, fully bound row.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT a.audience,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.29'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose'))='workflow-scheduled-outbox-drain'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=a.audience
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-workflow-local'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='workflow:integration_operation:execute'
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=CONCAT(a.audience,':workflow:integration_operation') AND g.action='execute'
WHERE sc.client_code='workflow.runtime' AND sc.app_code='workflow'
GROUP BY sc.id,a.audience,sc.status,scc.status
ORDER BY a.audience;
