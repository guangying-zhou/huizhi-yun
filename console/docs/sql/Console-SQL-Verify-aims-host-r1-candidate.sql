-- CANDIDATE ONLY: do not execute without environment approval.
-- Set @r1_tenant and @r1_enterprise_deployment from protected registered facts.
-- Only the active enterprise.runtime client; never revive, repair, or rotate.
-- Run verify before/after. Missing/conflicting/revoked rows must stop rollout.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
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
SELECT e.resource_code,e.action,e.audience,e.semantic_scope,
COUNT(g.id) AS exact_active_rows,
(SELECT COUNT(*) FROM service_client_grants old JOIN service_clients owner ON owner.id=old.service_client_id
 WHERE BINARY owner.client_code=BINARY 'enterprise.runtime'
 AND ((old.resource_code=e.resource_code AND old.action=e.action)
 OR (JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.audience'))=e.audience
 AND JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.semanticScope'))=e.semantic_scope))) AS tuple_rows
FROM expected e LEFT JOIN service_clients sc ON BINARY sc.client_code=BINARY 'enterprise.runtime' AND BINARY sc.app_code=BINARY 'enterprise' AND sc.status='active'
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND (g.resource_code=e.resource_code OR (e.resource_code IN ('data-runtime:aims:integration_operation','tenant-runtime:aims:integration_operation') AND g.resource_code='aims:integration_operation') OR (e.resource_code IN ('data-runtime:aims:milestone-rollover','tenant-runtime:aims:milestone-rollover') AND g.resource_code='aims:milestone-rollover') OR (e.resource_code IN ('data-runtime:aims:notifications-due','tenant-runtime:aims:notifications-due') AND g.resource_code='aims:notifications-due')) AND g.action=e.action AND g.status='active'
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=e.audience
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=e.semantic_scope
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=@r1_tenant
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=@r1_enterprise_deployment
GROUP BY e.resource_code,e.action,e.audience,e.semantic_scope;
-- Every expected tuple must be exactly 1. Zero/duplicate => STOP, never widen.

SELECT COUNT(*) AS exact_active_client_rows FROM service_clients WHERE BINARY client_code=BINARY 'enterprise.runtime' AND BINARY app_code=BINARY 'enterprise' AND status='active';
-- Before seed: missing (0/0) may be installed; conflicting (0/>0) or duplicates must STOP.
-- After seed: every tuple must be (1/1), exact_active_client_rows=1.

-- Only the three enumerated R1 capability aliases are accepted, with every
-- exact semantic scope/audience/tenant/deployment/client predicate above.
-- Seed never restores revoked rows; environment restoration is separately approved.
