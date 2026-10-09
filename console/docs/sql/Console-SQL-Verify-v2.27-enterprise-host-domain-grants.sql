-- Expect five rows: exact_rows=1 and active_exact_rows=1 for each domain on data-runtime.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT d.domain,'data-runtime' AS audience,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.27'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose'))='enterprise-host-domain'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT(d.domain,':enterprise-host:execute')
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
CROSS JOIN (SELECT 'aims' AS domain UNION ALL SELECT 'assets' UNION ALL SELECT 'codocs' UNION ALL SELECT 'altoc' UNION ALL SELECT 'console') d
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=CONCAT('data-runtime:',d.domain,':enterprise-host') AND g.action='execute'
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,d.domain,sc.status,scc.status
ORDER BY d.domain;
