-- CANDIDATE ONLY. Each audience/resource must have one ACTIVE, fully bound row.
-- Old ACTIVE rows with only tenant/deployment binding absent are repairable by a
-- separately reviewed binding-only repair. REVOKED rows must never be revived.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT a.audience,s.resource_code,sc.status AS client_status,scc.status AS credential_status,
 COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN g.status='revoked' THEN 1 ELSE 0 END) AS revoked_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=a.audience
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('aims:',s.resource_code,':execute')
  AND (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')),'') IS NULL
    OR NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')),'') IS NULL)
  AND (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')),'') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001')
  AND (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')),'') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-aims')
  THEN 1 ELSE 0 END) AS active_binding_only_missing_rows,
 SUM(CASE WHEN g.status='active'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=a.audience
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-aims'
  AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('aims:',s.resource_code,':execute')
  THEN 1 ELSE 0 END) AS active_exact_rows
FROM service_clients sc
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
CROSS JOIN (
 SELECT 'integration_operation' AS resource_code
 UNION ALL SELECT 'notifications-due'
 UNION ALL SELECT 'milestone-rollover'
) s
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND g.resource_code=CONCAT(a.audience,':aims:',s.resource_code) AND g.action='execute'
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims'
GROUP BY sc.id,a.audience,s.resource_code,sc.status,scc.status
ORDER BY a.audience,s.resource_code;
