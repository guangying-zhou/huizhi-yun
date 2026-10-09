-- Rollback of a7b-prod-console-login-wecom.sql. Removes both paths only if they are exactly what the forward SQL wrote.
UPDATE tenants
SET settings_json = JSON_REMOVE(
      JSON_REMOVE(settings_json, '$.deploymentEnvironments.prod.consoleLogin'),
      '$.deploymentEnvironments.test.consoleLogin.enabledProviders'),
    updated_at = UTC_TIMESTAMP()
WHERE tenant_code = 'C000001'
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.prod.consoleLogin') =
      CAST('{"mode": "oidc", "wecom": {"agentid": "1000007", "corpid": "wwe3597050c256d8e4"}, "enabledProviders": ["oidc", "wecom"]}' AS JSON)
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.test.consoleLogin.enabledProviders') = CAST('["oidc"]' AS JSON);
