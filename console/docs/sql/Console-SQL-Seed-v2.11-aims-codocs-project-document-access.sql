-- Exact capabilities declared by codocs/app.manifest.json.
-- Apply to an explicitly selected Console environment; no credentials created.
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'codocs:project-document-access',a.action,
  JSON_OBJECT('source','seed:v2.11','audience','codocs','purpose','signed-project-document-service'),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (SELECT 'read' AS action UNION ALL SELECT 'manage' UNION ALL SELECT 'create') a
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active'
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
-- Runtime integration access is an existing Foundation contract; pin both
-- supported audiences and oss.default, never a generic Vault permission.
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':',r.resource),r.action,
  JSON_OBJECT('source','seed:v2.11','audience',a.audience,'integrationCodes',JSON_ARRAY('oss.default'),'usageTypes',JSON_ARRAY('integration')),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
CROSS JOIN (SELECT 'integration_config' AS resource,'view' AS action UNION ALL SELECT 'credential_vault','resolve') r
WHERE sc.client_code='codocs.runtime' AND sc.app_code='codocs' AND sc.status='active'
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
COMMIT;
