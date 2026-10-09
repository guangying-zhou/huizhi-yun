-- Candidate only; never reapplies/reactivates an existing revoked grant.
-- Workflow BFF uses its own workflow.runtime identity for its own Runtime.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, expected.resource_code, expected.action,
 JSON_OBJECT('source','seed:v2.7','purpose','workflow-aims-completion-target','audience',expected.audience,'semanticScope',expected.semantic_scope),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc JOIN (
 SELECT 'workflow:work-item-complete' resource_code,'create' action,'workflow' audience,'workflow:work-item-complete:create' semantic_scope
 UNION ALL SELECT 'data-runtime:workflow:work-item-complete','create','data-runtime','workflow:work-item-complete:create'
 UNION ALL SELECT 'tenant-runtime:workflow:work-item-complete','create','tenant-runtime','workflow:work-item-complete:create'
 UNION ALL SELECT 'workflow','callback','aims','workflow:callback'
) expected
WHERE sc.status='active' AND sc.app_code='workflow' AND sc.client_code='workflow.runtime'
 AND NOT EXISTS(SELECT 1 FROM service_client_grants existing WHERE existing.service_client_id=sc.id AND existing.resource_code=expected.resource_code AND existing.action=expected.action);
COMMIT;
