-- S4 A7 prerequisite: give C000001's prod environment a tenantGateway.subdomain so that
-- POST /api/platform/tenant-admin/deployment-settings/install-command stops returning 409.
-- Touches ONLY tenants.settings_json path $.deploymentEnvironments.prod.tenantGateway.subdomain for C000001.
-- Does not touch deployment_sites, dataRuntime, platform, consoleLogin, or the test environment.
-- Executor: run inside a transaction on hzy_platform_dev; require ROW_COUNT() = 1, then the verification SELECTs, then COMMIT.
-- Guard: the prod scope must not exist yet.
UPDATE tenants
SET settings_json = JSON_SET(settings_json, '$.deploymentEnvironments.prod', JSON_OBJECT('tenantGateway', JSON_OBJECT('subdomain', 'aidcp'))),
    updated_at = UTC_TIMESTAMP()
WHERE tenant_code = 'C000001'
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments') IS NOT NULL
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.prod') IS NULL;
