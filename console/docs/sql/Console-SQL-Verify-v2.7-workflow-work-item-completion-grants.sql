-- Read-only; each full scope/audience combination still requires real Console
-- service-token issuance before readiness can be declared.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.client_code,expected.resource_code,expected.action,
 CASE WHEN g.id IS NULL THEN 'MISSING' WHEN g.status<>'active' THEN 'NOT_ACTIVE'
 WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')),'')<>expected.audience
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')),'')<>expected.semantic_scope THEN 'BINDING_MISMATCH' ELSE 'ACTIVE' END verification_status
FROM service_clients sc JOIN (
 SELECT 'workflow:work-item-complete' resource_code,'create' action,'workflow' audience,'workflow:work-item-complete:create' semantic_scope
 UNION ALL SELECT 'data-runtime:workflow:work-item-complete','create','data-runtime','workflow:work-item-complete:create'
 UNION ALL SELECT 'tenant-runtime:workflow:work-item-complete','create','tenant-runtime','workflow:work-item-complete:create'
 UNION ALL SELECT 'workflow','callback','aims','workflow:callback'
) expected LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.resource_code=expected.resource_code AND g.action=expected.action
WHERE sc.status='active' AND sc.app_code='workflow' AND sc.client_code='workflow.runtime'
ORDER BY expected.resource_code,expected.action;
