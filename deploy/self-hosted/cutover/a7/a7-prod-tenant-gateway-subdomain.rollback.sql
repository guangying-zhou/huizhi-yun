-- Rollback of a7-prod-tenant-gateway-subdomain.sql. Removes the prod scope only if it is exactly what the forward SQL wrote.
UPDATE tenants
SET settings_json = JSON_REMOVE(settings_json, '$.deploymentEnvironments.prod'),
    updated_at = UTC_TIMESTAMP()
WHERE tenant_code = 'C000001'
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.prod') = CAST('{"tenantGateway": {"subdomain": "aidcp"}}' AS JSON);
