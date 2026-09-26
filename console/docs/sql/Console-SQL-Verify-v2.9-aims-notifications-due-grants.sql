-- Read-only candidate verification. All rows must be ACTIVE, then obtain a real
-- Console service token for aims:notifications-due:execute on both Runtime
-- audiences before selecting the unified due-notification path. SQL existence alone is not readiness.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.client_code,expected.resource_code,expected.action,
 CASE WHEN g.id IS NULL THEN 'MISSING' WHEN g.status<>'active' THEN 'NOT_ACTIVE'
 WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')),'')<>expected.audience
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')),'')<>expected.semantic_scope THEN 'BINDING_MISMATCH' ELSE 'ACTIVE' END verification_status
FROM service_clients sc JOIN (
 SELECT 'aims:notifications-due' resource_code,'execute' action,'aims' audience,'aims:notifications-due:execute' semantic_scope
 UNION ALL SELECT 'data-runtime:aims:notifications-due','execute','data-runtime','aims:notifications-due:execute'
 UNION ALL SELECT 'tenant-runtime:aims:notifications-due','execute','tenant-runtime','aims:notifications-due:execute'
) expected LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.resource_code=expected.resource_code AND g.action=expected.action
WHERE sc.status='active' AND sc.app_code='aims' AND sc.client_code='aims.runtime'
ORDER BY expected.resource_code,expected.action;
