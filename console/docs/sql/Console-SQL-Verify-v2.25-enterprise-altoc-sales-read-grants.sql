-- Expect exactly 3 resource rows, each client_status/credential_status=active,
-- exact_rows=1 and active_exact_rows=1. SQL is not token issuance or Runtime proof.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT r.resource,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:enterprise-altoc-g2-read'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose'))='enterprise-altoc-g2-read'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('altoc:',r.resource,':view')
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
CROSS JOIN (SELECT 'lead' AS resource UNION ALL SELECT 'opportunity' UNION ALL SELECT 'quotation') r
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=CONCAT('data-runtime:altoc:',r.resource) AND g.action='view'
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,r.resource,sc.status,scc.status
ORDER BY r.resource;
