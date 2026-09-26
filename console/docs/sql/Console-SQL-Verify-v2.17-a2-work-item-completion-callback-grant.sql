-- Expected exactly one row: row_count=1 and every *_ok=1.
SELECT COUNT(*) AS row_count,
 SUM(g.status='active') AS active_ok,
 SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime') AS audience_ok,
 SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='aims:work-item-completion-callback:execute') AS semantic_scope_ok,
 SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001') AS tenant_ok,
 SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-aims') AS deployment_ok,
 SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:round3-a2-work-item-completion-callback') AS source_ok
FROM service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims'
 AND g.resource_code='aims:work-item-completion-callback' AND g.action='execute';
