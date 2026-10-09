-- Same three explicit variables as seed. Every expected row requires count=1,
-- active_exact=1. Missing clients also appear. This is not issuance evidence.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT s.client_code,a.audience,s.resource_code,s.action,COUNT(g.id) AS exact_rows,
 SUM(CASE WHEN sc.status='active' AND c.status='active' AND g.status='active'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=BINARY @feedback_tenant
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=BINARY IF(s.client_code='console.runtime',@feedback_console_deployment,@feedback_enterprise_deployment)
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=BINARY a.audience
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=BINARY CONCAT('console:',s.resource_code,':',s.action)
 THEN 1 ELSE 0 END) AS active_exact
FROM (
 SELECT 'console.runtime' AS client_code,'feedback' AS resource_code,'view' AS action
 UNION ALL SELECT 'console.runtime','feedback','retry'
 UNION ALL SELECT 'console.runtime','feedback','admin'
 UNION ALL SELECT 'console.runtime','feedback-settings','view'
 UNION ALL SELECT 'console.runtime','feedback-settings','edit'
 UNION ALL SELECT 'console.runtime','feedback-delivery','execute'
 UNION ALL SELECT 'enterprise.runtime','enterprise-host','execute'
) s CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
LEFT JOIN service_clients sc ON BINARY sc.client_code=BINARY s.client_code
LEFT JOIN service_client_credentials c ON c.id=sc.current_credential_id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND BINARY g.resource_code=BINARY CONCAT(a.audience,':console:',s.resource_code) AND BINARY g.action=BINARY s.action
GROUP BY s.client_code,a.audience,s.resource_code,s.action;
