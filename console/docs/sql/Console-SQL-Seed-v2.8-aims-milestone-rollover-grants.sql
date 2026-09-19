-- Candidate only: no environment application. Scope source is the Aims manifest
-- resource milestone-rollover and the unified Runtime route
-- /v1/enterprise/aims/milestones:rollover-due. Existing revoked grants are
-- deliberately left unchanged; use the authorized repair path for drift.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, expected.resource_code, expected.action,
 JSON_OBJECT('source','seed:v2.8','purpose','aims-milestone-rollover','audience',expected.audience,'semanticScope',expected.semantic_scope),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc JOIN (
 SELECT 'aims:milestone-rollover' resource_code,'execute' action,'aims' audience,'aims:milestone-rollover:execute' semantic_scope
 UNION ALL SELECT 'data-runtime:aims:milestone-rollover','execute','data-runtime','aims:milestone-rollover:execute'
 UNION ALL SELECT 'tenant-runtime:aims:milestone-rollover','execute','tenant-runtime','aims:milestone-rollover:execute'
) expected
WHERE sc.status='active' AND sc.app_code='aims' AND sc.client_code='aims.runtime'
 AND NOT EXISTS(SELECT 1 FROM service_client_grants existing WHERE existing.service_client_id=sc.id AND existing.resource_code=expected.resource_code AND existing.action=expected.action);
COMMIT;
