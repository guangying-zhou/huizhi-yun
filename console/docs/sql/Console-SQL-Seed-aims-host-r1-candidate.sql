-- CANDIDATE ONLY: do not execute without environment approval.
-- Set @r1_tenant and @r1_enterprise_deployment from protected registered facts.
-- Only the active enterprise.runtime client; never revive, repair, or rotate.
-- Run verify before/after. Missing/conflicting/revoked rows must stop rollout.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
WITH expected AS (
SELECT 'data-runtime:aims:integration_operation' resource_code,'execute' action,'data-runtime' audience,'aims:integration_operation:execute' semantic_scope
UNION ALL SELECT 'data-runtime:aims:milestone-rollover' resource_code,'execute' action,'data-runtime' audience,'aims:milestone-rollover:execute' semantic_scope
UNION ALL SELECT 'data-runtime:aims:notifications-due' resource_code,'execute' action,'data-runtime' audience,'aims:notifications-due:execute' semantic_scope
UNION ALL SELECT 'tenant-runtime:aims:integration_operation' resource_code,'execute' action,'tenant-runtime' audience,'aims:integration_operation:execute' semantic_scope
UNION ALL SELECT 'tenant-runtime:aims:milestone-rollover' resource_code,'execute' action,'tenant-runtime' audience,'aims:milestone-rollover:execute' semantic_scope
UNION ALL SELECT 'tenant-runtime:aims:notifications-due' resource_code,'execute' action,'tenant-runtime' audience,'aims:notifications-due:execute' semantic_scope
UNION ALL SELECT 'workflow:work-item-complete' resource_code,'create' action,'workflow' audience,'workflow:work-item-complete:create' semantic_scope
UNION ALL SELECT 'workflow:action_defs' resource_code,'sync' action,'workflow' audience,'workflow:action_defs:sync' semantic_scope
UNION ALL SELECT 'codocs:product-document' resource_code,'create' action,'codocs' audience,'codocs:product-document:create' semantic_scope
UNION ALL SELECT 'codocs:company-weekly-summary' resource_code,'publish' action,'codocs' audience,'codocs:company-weekly-summary:publish' semantic_scope
UNION ALL SELECT 'notifications' resource_code,'publish' action,'notifications' audience,'notifications:publish' semantic_scope
)
SELECT sc.id,e.resource_code,e.action,JSON_OBJECT('source','candidate:aims-host-r1','audience',e.audience,'semanticScope',e.semantic_scope,'tenantCode',@r1_tenant,'deploymentCode',@r1_enterprise_deployment),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc JOIN expected e
WHERE BINARY sc.client_code=BINARY 'enterprise.runtime' AND BINARY sc.app_code=BINARY 'enterprise' AND sc.status='active'
AND LENGTH(TRIM(@r1_tenant))>0 AND LENGTH(TRIM(@r1_enterprise_deployment))>0
AND NOT EXISTS(SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id AND old.resource_code=e.resource_code AND old.action=e.action)
AND NOT EXISTS(SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id AND JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.audience'))=e.audience AND JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.semanticScope'))=e.semantic_scope);
SELECT ROW_COUNT() AS inserted_rows;
COMMIT;
