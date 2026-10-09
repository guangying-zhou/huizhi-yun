-- CANDIDATE ONLY / P1 rollout: no environment authorization implied.
-- Bind all @p1_* variables from reviewed protected Registry/runtime facts.
-- Audience parameters are actual deployment audiences, not automatic dual grants.
-- Preflight must stop on missing clients, revoked/conflicting rows or a semantic
-- alias stored under another physical key. No repair, revive or credential write.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Require 8 rows, each clients=1, present=1, exact_active=1, revoked=0.
-- NULL/missing binding, disabled client and conflicting audience fail verification.
SELECT e.client,e.resource,e.action,e.audience,e.semantic_scope,e.deployment,
 COUNT(DISTINCT sc.id) AS clients,COUNT(g.id) AS present,
 COALESCE(SUM(g.status='revoked'),0) AS revoked_requires_separate_approval,
 COALESCE(SUM(g.status='active' AND sc.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=e.audience
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=e.semantic_scope
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=@p1_tenant
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=e.deployment
 AND (e.resource NOT IN ('integration_config','credential_vault') OR
 (JSON_LENGTH(JSON_EXTRACT(g.scope_json,'$.integrationCodes'))=1
 AND JSON_CONTAINS(JSON_EXTRACT(g.scope_json,'$.integrationCodes'),JSON_QUOTE('oss.default'))
 AND JSON_CONTAINS(JSON_EXTRACT(g.scope_json,'$.usageTypes'),JSON_QUOTE('integration'))))
 AND @p1_tenant IS NOT NULL AND LENGTH(TRIM(@p1_tenant))>0
 AND @p1_enterprise_deployment IS NOT NULL AND @p1_workflow_deployment IS NOT NULL
 AND @p1_console_deployment IS NOT NULL AND @p1_codocs_deployment IS NOT NULL
 AND @p1_runtime_audience IN ('data-runtime','tenant-runtime')
 AND @p1_codocs_runtime_audience IN ('data-runtime','tenant-runtime')),0) AS exact_active
FROM (
SELECT 'workflow.runtime' AS client,'workflow' AS app,'enterprise:workflow-callback' AS resource,'execute' AS action,'enterprise' AS audience,'enterprise:workflow-callback:execute' AS semantic_scope,@p1_workflow_deployment AS deployment
UNION ALL SELECT 'console.runtime','console','enterprise:notification-detail','authorize','enterprise','enterprise:notification-detail:authorize',@p1_console_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise',CONCAT(@p1_runtime_audience,':aims:scheduler'),'execute',@p1_runtime_audience,'aims:scheduler:execute',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise',CONCAT(@p1_runtime_audience,':aims:notification-detail'),'authorize',@p1_runtime_audience,'aims:notification-detail:authorize',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise',CONCAT(@p1_runtime_audience,':assets:notification-detail'),'authorize',@p1_runtime_audience,'assets:notification-detail:authorize',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise','integration_config','view',@p1_runtime_audience,'integration_config:view',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise','credential_vault','resolve',@p1_runtime_audience,'credential_vault:resolve',@p1_enterprise_deployment
UNION ALL SELECT 'codocs.runtime','codocs',CONCAT(@p1_codocs_runtime_audience,':codocs'),'read',@p1_codocs_runtime_audience,'codocs.read',@p1_codocs_deployment
) e
LEFT JOIN service_clients sc ON BINARY sc.client_code=BINARY e.client AND BINARY sc.app_code=BINARY e.app
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.resource_code=e.resource AND g.action=e.action
GROUP BY e.client,e.resource,e.action,e.audience,e.semantic_scope,e.deployment ORDER BY e.client,e.semantic_scope;
