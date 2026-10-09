-- S4 A18: enable the WeCom login entry for C000001 prod (the DingTalk login stays off by user decision).
-- Touches ONLY two paths of tenants.settings_json for C000001:
--   1. $.deploymentEnvironments.prod.consoleLogin  (new; mode oidc, enabledProviders [oidc, wecom], wecom corpid/agentid; NO secrets)
--   2. $.deploymentEnvironments.test.consoleLogin.enabledProviders = ["oidc"]  (pins test's effective value)
-- Why (2): non-prod environments inherit prod's consoleLogin with a shallow per-key merge
-- (platform/server/utils/tenantDeploymentSettings.ts consoleLoginEnvironmentSettings + mergeConsoleLoginSettings).
-- test has no enabledProviders of its own, so without the pin it would inherit ["oidc","wecom"]. ["oidc"] is exactly
-- what test's normalized value is today (mode oidc, no list => [mode]). Test's wecom corpid/agentid are explicit empty
-- strings and therefore already override prod's, and test has no dingtalk block, so nothing else changes.
-- Executor: run in ONE transaction on hzy_platform_dev; require ROW_COUNT() = 1, then the verification SELECTs, then COMMIT.
-- Guards: prod.consoleLogin absent, test.consoleLogin.enabledProviders absent, test.consoleLogin present, prod scope exists.
UPDATE tenants
SET settings_json = JSON_SET(
      JSON_SET(settings_json,
        '$.deploymentEnvironments.prod.consoleLogin',
        JSON_OBJECT('mode', 'oidc',
                    'enabledProviders', JSON_ARRAY('oidc', 'wecom'),
                    'wecom', JSON_OBJECT('corpid', 'wwe3597050c256d8e4', 'agentid', '1000007'))),
      '$.deploymentEnvironments.test.consoleLogin.enabledProviders', JSON_ARRAY('oidc')),
    updated_at = UTC_TIMESTAMP()
WHERE tenant_code = 'C000001'
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.prod') IS NOT NULL
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.prod.consoleLogin') IS NULL
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.test.consoleLogin') IS NOT NULL
  AND JSON_EXTRACT(settings_json, '$.deploymentEnvironments.test.consoleLogin.enabledProviders') IS NULL;
