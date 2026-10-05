-- Expect view/edit each: exact_rows=1, active_exact_rows=1, active client/credential.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT a.action,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:enterprise-aims-admin-projects'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose'))='enterprise-aims-admin-projects'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('aims:admin-projects:',a.action)
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
CROSS JOIN (SELECT 'view' AS action UNION ALL SELECT 'edit') a
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code='data-runtime:aims:admin-projects' AND g.action=a.action
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,a.action,sc.status,scc.status
ORDER BY a.action;
