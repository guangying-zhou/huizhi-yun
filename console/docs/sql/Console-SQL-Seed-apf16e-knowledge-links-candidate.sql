-- CANDIDATE ONLY. No credentials, no automatic execution or revoked resurrection.
-- Operator must set all five parameters from reviewed deployment facts. Runtime
-- audience is the one actually configured on the target workers (not two copies).
-- @tenant_code, @enterprise_deployment, @assets_deployment, @codocs_deployment,
-- @runtime_audience IN ('data-runtime','tenant-runtime'). Backup+approval required.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT c.id, CASE WHEN p.client='enterprise.runtime' THEN p.resource ELSE CONCAT(@runtime_audience,':',p.resource) END,'create',
 JSON_OBJECT('source','seed:apf16e-knowledge-links','semanticScope',CONCAT(p.resource,':create'),'audience',CASE WHEN p.client='enterprise.runtime' THEN p.target ELSE @runtime_audience END,'tenantCode',@tenant_code,'deploymentCode',CASE p.client WHEN 'enterprise.runtime' THEN @enterprise_deployment WHEN 'assets.runtime' THEN @assets_deployment ELSE @codocs_deployment END),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients c
JOIN service_client_credentials k ON k.id=c.current_credential_id AND k.status='active'
JOIN (
 SELECT 'enterprise.runtime' client,'enterprise' app,'assets' target,'assets:asset-link' resource
 UNION ALL SELECT 'enterprise.runtime','enterprise','codocs','codocs:knowledge-link'
 UNION ALL SELECT 'assets.runtime','assets','assets','assets:asset-link'
 UNION ALL SELECT 'codocs.runtime','codocs','codocs','codocs:knowledge-link'
) p ON BINARY c.client_code=BINARY p.client AND BINARY c.app_code=BINARY p.app
WHERE c.status='active' AND @tenant_code IS NOT NULL AND @enterprise_deployment IS NOT NULL AND @assets_deployment IS NOT NULL AND @codocs_deployment IS NOT NULL AND @runtime_audience IN ('data-runtime','tenant-runtime')
AND NOT EXISTS(SELECT 1 FROM service_client_grants g WHERE g.service_client_id=c.id AND g.action='create' AND BINARY g.resource_code=BINARY CASE WHEN p.client='enterprise.runtime' THEN p.resource ELSE CONCAT(@runtime_audience,':',p.resource) END);
-- Expected inserted=4 on an empty installation; existing rows require verify.
SELECT ROW_COUNT() AS inserted;
COMMIT;
