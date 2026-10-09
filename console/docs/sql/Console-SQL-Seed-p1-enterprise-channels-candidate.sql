-- CANDIDATE ONLY / P1 rollout: no environment authorization implied.
-- Bind all @p1_* variables from reviewed protected Registry/runtime facts.
-- Audience parameters are actual deployment audiences, not automatic dual grants.
-- Preflight must stop on missing clients, revoked/conflicting rows or a semantic
-- alias stored under another physical key. No repair, revive or credential write.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,e.resource,e.action,
 JSON_MERGE_PATCH(JSON_OBJECT('source','candidate:adr018a-p1-channels','audience',e.audience,
 'semanticScope',e.semantic_scope,'tenantCode',@p1_tenant,'deploymentCode',e.deployment),
 CASE WHEN e.client='enterprise.runtime' AND e.resource IN ('integration_config','credential_vault') THEN
 JSON_OBJECT('integrationCodes',JSON_ARRAY('oss.default'),'usageTypes',JSON_ARRAY('integration')) ELSE JSON_OBJECT() END),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc JOIN (
SELECT 'workflow.runtime' AS client,'workflow' AS app,'enterprise:workflow-callback' AS resource,'execute' AS action,'enterprise' AS audience,'enterprise:workflow-callback:execute' AS semantic_scope,@p1_workflow_deployment AS deployment
UNION ALL SELECT 'console.runtime','console','enterprise:notification-detail','authorize','enterprise','enterprise:notification-detail:authorize',@p1_console_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise',CONCAT(@p1_runtime_audience,':aims:scheduler'),'execute',@p1_runtime_audience,'aims:scheduler:execute',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise',CONCAT(@p1_runtime_audience,':aims:notification-detail'),'authorize',@p1_runtime_audience,'aims:notification-detail:authorize',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise',CONCAT(@p1_runtime_audience,':assets:notification-detail'),'authorize',@p1_runtime_audience,'assets:notification-detail:authorize',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise','integration_config','view',@p1_runtime_audience,'integration_config:view',@p1_enterprise_deployment
UNION ALL SELECT 'enterprise.runtime','enterprise','credential_vault','resolve',@p1_runtime_audience,'credential_vault:resolve',@p1_enterprise_deployment
UNION ALL SELECT 'codocs.runtime','codocs',CONCAT(@p1_codocs_runtime_audience,':codocs'),'read',@p1_codocs_runtime_audience,'codocs.read',@p1_codocs_deployment
) e ON BINARY sc.client_code=BINARY e.client AND BINARY sc.app_code=BINARY e.app
WHERE sc.status='active' AND @p1_tenant IS NOT NULL AND LENGTH(TRIM(@p1_tenant))>0
 AND @p1_enterprise_deployment IS NOT NULL AND @p1_workflow_deployment IS NOT NULL
 AND @p1_console_deployment IS NOT NULL AND @p1_codocs_deployment IS NOT NULL
 AND @p1_runtime_audience IN ('data-runtime','tenant-runtime')
 AND @p1_codocs_runtime_audience IN ('data-runtime','tenant-runtime')
 AND LENGTH(TRIM(e.deployment))>0
 AND NOT EXISTS(SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id AND old.resource_code=e.resource AND old.action=e.action)
 AND NOT EXISTS(SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id
   AND JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.audience'))=e.audience
   AND JSON_UNQUOTE(JSON_EXTRACT(old.scope_json,'$.semanticScope'))=e.semantic_scope);
SELECT ROW_COUNT() AS inserted_rows;
COMMIT;
