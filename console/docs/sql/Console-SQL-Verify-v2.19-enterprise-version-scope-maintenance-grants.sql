-- Expect six rows, each 1 exact row and 1 active exact binding; source must match.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT expected.audience,expected.action,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:round3-d4-stage3'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=expected.audience
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('aims:product-versions:',expected.action) THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
JOIN (
 SELECT 'aims:product-versions' AS resource_code,'data-runtime' AS audience,'scope-edit' AS action
 UNION ALL SELECT 'aims:product-versions','data-runtime','scope-visibility'
 UNION ALL SELECT 'aims:product-versions','data-runtime','scope-legacy-criteria'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','tenant-runtime','scope-edit'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','tenant-runtime','scope-visibility'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','tenant-runtime','scope-legacy-criteria'
) expected
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=expected.resource_code AND g.action=expected.action
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,expected.audience,expected.action,sc.status,scc.status
ORDER BY expected.audience,expected.action;
