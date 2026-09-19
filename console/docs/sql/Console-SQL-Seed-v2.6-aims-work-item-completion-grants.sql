-- Candidate only: no environment application. Scope source is Aims/Workflow
-- manifests and exact Runtime/BFF declarations. Existing revoked grants are
-- deliberately left unchanged; use the authorized repair path for drift.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, expected.resource_code, expected.action,
 JSON_OBJECT('source','seed:v2.6','purpose','aims-work-item-completion','audience',expected.audience,'semanticScope',expected.semantic_scope),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc JOIN (
 SELECT 'aims:work-item-completion-callback' resource_code,'execute' action,'aims' audience,'aims:work-item-completion-callback:execute' semantic_scope
 UNION ALL SELECT 'data-runtime:aims:work-item-completion-callback','execute','data-runtime','aims:work-item-completion-callback:execute'
 UNION ALL SELECT 'tenant-runtime:aims:work-item-completion-callback','execute','tenant-runtime','aims:work-item-completion-callback:execute'
 UNION ALL SELECT 'aims:integration_operation','execute','aims','aims:integration_operation:execute'
 UNION ALL SELECT 'data-runtime:aims:integration_operation','execute','data-runtime','aims:integration_operation:execute'
 UNION ALL SELECT 'tenant-runtime:aims:integration_operation','execute','tenant-runtime','aims:integration_operation:execute'
 UNION ALL SELECT 'workflow:work-item-complete','create','workflow','workflow:work-item-complete:create'
) expected
WHERE sc.status='active' AND sc.app_code='aims' AND sc.client_code='aims.runtime'
 AND NOT EXISTS(SELECT 1 FROM service_client_grants existing WHERE existing.service_client_id=sc.id AND existing.resource_code=expected.resource_code AND existing.action=expected.action);
COMMIT;
