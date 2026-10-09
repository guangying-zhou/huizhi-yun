-- R2 callback-only addition: exactly two tuples. No R1 worker scopes.
-- CANDIDATE ONLY: do not execute without environment approval.
-- Set @r1_tenant and @r1_enterprise_deployment from protected registered facts.
-- Only the active enterprise.runtime client; never revive, repair, or rotate.
-- Run verify before/after. Missing/conflicting/revoked rows must stop rollout.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
WITH expected AS (
SELECT 'data-runtime:aims:scheduler' resource_code,'execute' action,'data-runtime' audience,'aims:scheduler:execute' semantic_scope
UNION ALL SELECT 'tenant-runtime:aims:scheduler' resource_code,'execute' action,'tenant-runtime' audience,'aims:scheduler:execute' semantic_scope
)
SELECT e.resource_code,e.action,e.audience,e.semantic_scope,
COUNT(g.id) AS exact_active_rows,
(SELECT COUNT(*) FROM service_client_grants old JOIN service_clients owner ON owner.id=old.service_client_id
 WHERE BINARY owner.client_code=BINARY 'enterprise.runtime'
 AND ((old.resource_code=e.resource_code AND old.action=e.action)
 OR (JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.audience'))=e.audience
 AND JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.semanticScope'))=e.semantic_scope))) AS tuple_rows
FROM expected e LEFT JOIN service_clients sc ON BINARY sc.client_code=BINARY 'enterprise.runtime' AND BINARY sc.app_code=BINARY 'enterprise' AND sc.status='active'
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.resource_code=e.resource_code AND g.action=e.action AND g.status='active'
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=e.audience
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=e.semantic_scope
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=@r1_tenant
AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=@r1_enterprise_deployment
GROUP BY e.resource_code,e.action,e.audience,e.semantic_scope;
-- Every expected tuple must be exactly 1. Zero/duplicate => STOP, never widen.

SELECT COUNT(*) AS exact_active_client_rows FROM service_clients WHERE BINARY client_code=BINARY 'enterprise.runtime' AND BINARY app_code=BINARY 'enterprise' AND status='active';
-- Before seed: missing (0/0) may be installed; conflicting (0/>0) or duplicates must STOP.
-- After seed: every tuple must be (1/1), exact_active_client_rows=1.

