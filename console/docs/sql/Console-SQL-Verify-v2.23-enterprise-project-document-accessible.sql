-- Expect exactly one result row, ACTIVE client/credential, exact_rows=1,
-- active_exact_rows=1; never accept missing or mismatched bindings.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:round3-native-project-documents'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='aims:project-documents:read'
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code='data-runtime:aims:project-documents' AND g.action='read'
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,sc.status,scc.status;
