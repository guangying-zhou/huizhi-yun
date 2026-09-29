-- Read-only candidate verification. All rows must be ACTIVE, then obtain real
-- Console service tokens for each complete scope combination/audience before
-- enabling the new source action. SQL existence alone is not readiness.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.client_code,expected.resource_code,expected.action,
 CASE WHEN g.id IS NULL THEN 'MISSING' WHEN g.status<>'active' THEN 'NOT_ACTIVE'
 WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')),'')<>expected.audience
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')),'')<>expected.semantic_scope THEN 'BINDING_MISMATCH' ELSE 'ACTIVE' END verification_status
FROM service_clients sc JOIN (
 SELECT 'aims:work-item-completion-callback' resource_code,'execute' action,'aims' audience,'aims:work-item-completion-callback:execute' semantic_scope
 UNION ALL SELECT 'data-runtime:aims:work-item-completion-callback','execute','data-runtime','aims:work-item-completion-callback:execute'
 UNION ALL SELECT 'tenant-runtime:aims:work-item-completion-callback','execute','tenant-runtime','aims:work-item-completion-callback:execute'
 UNION ALL SELECT 'aims:integration_operation','execute','aims','aims:integration_operation:execute'
 UNION ALL SELECT 'data-runtime:aims:integration_operation','execute','data-runtime','aims:integration_operation:execute'
 UNION ALL SELECT 'tenant-runtime:aims:integration_operation','execute','tenant-runtime','aims:integration_operation:execute'
 UNION ALL SELECT 'workflow:work-item-complete','create','workflow','workflow:work-item-complete:create'
) expected LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.resource_code=expected.resource_code AND g.action=expected.action
WHERE sc.status='active' AND sc.app_code='aims' AND sc.client_code='aims.runtime'
ORDER BY expected.resource_code,expected.action;
