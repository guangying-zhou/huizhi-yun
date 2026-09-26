-- Expect one ACTIVE exact row for each audience, with an active client and credential.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT expected.audience,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='active' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=expected.audience
     AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
     AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'
     AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='aims:work-item-plan-ready:execute' THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
JOIN (
 SELECT 'aims:work-item-plan-ready' AS resource_code,'data-runtime' AS audience
 UNION ALL SELECT 'tenant-runtime:aims:work-item-plan-ready','tenant-runtime'
) expected
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=expected.resource_code AND g.action='execute'
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,expected.audience,sc.status,scc.status
ORDER BY expected.audience;
