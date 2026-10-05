-- S4 B17 fix 12: audience facts for the connector runtime service client in prod hzy_console (C000001).
-- service_clients.id=1043 (connector-runtime.C000001-console) has grants whose scope_json carries no audience; the Runtime signer
-- (data-runtime/internal/apps/console/auth_service_scope_mapping.go) keeps no legacy fallback, so the connector's token requests fail with
-- insufficient_scope (exit 78). The connector requests exactly four (audience, scope) pairs (notification-runtime/internal/console/client.go:
-- 120,148,179,222,248): (data-runtime, data-runtime:integration_config:view), (data-runtime, data-runtime:credential_vault:resolve),
-- (console, console:connector-runtime:heartbeat), (console, console:directory-profiles:sync). The mapping accepts a bound grant when
-- audience matches and grant.scope == requested scope with the scope starting "<audience>:", so only the audience key is needed (no
-- semanticScope). Audience = the resource prefix. Untouched: 6328/6329 (unprefixed), 6330 (revoked), 628439/628440 (tenant-runtime, not
-- requested). Each row is changed by id only if its scope_json is byte-identical to the preflight value (CAS); nothing is written unless all
-- four match. No rows added; resource/action/status unchanged. One transaction; mysql client.
SET @cid = (SELECT id FROM service_clients WHERE client_code='connector-runtime.C000001-console' AND app_code='connector-runtime' AND status='active');
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
CREATE TEMPORARY TABLE b17_audience_facts AS
  SELECT * FROM (
      SELECT 6357 AS id,'console:connector-runtime' AS resource_code,'heartbeat' AS action,'console' AS audience,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
      UNION ALL SELECT 9677 AS id,'console:directory-profiles' AS resource_code,'sync' AS action,'console' AS audience,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
      UNION ALL SELECT 628427 AS id,'data-runtime:credential_vault' AS resource_code,'resolve' AS action,'data-runtime' AS audience,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "usageTypes": ["integration"], "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
      UNION ALL SELECT 628428 AS id,'data-runtime:integration_config' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
  ) x;
SET @expected = (SELECT COUNT(*) FROM b17_audience_facts);
SET @ready = (SELECT COUNT(*) FROM b17_audience_facts f JOIN service_client_grants g ON g.id=f.id AND g.service_client_id=@cid
  AND g.resource_code=f.resource_code AND g.action=f.action AND g.status='active' AND CAST(g.scope_json AS CHAR)=f.old_json);
START TRANSACTION;
UPDATE service_client_grants g JOIN b17_audience_facts f ON g.id=f.id AND g.service_client_id=@cid
  AND g.resource_code=f.resource_code AND g.action=f.action AND g.status='active' AND CAST(g.scope_json AS CHAR)=f.old_json
SET g.scope_json = JSON_SET(g.scope_json,'$.audience',f.audience,'$.audienceFacts','s4-b17-audience-facts-connector'),
    g.updated_at = UTC_TIMESTAMP()
WHERE @cid IS NOT NULL AND @expected = 4 AND @ready = 4;
COMMIT;
SELECT @expected AS expected, @ready AS ready,
  (SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=@cid AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.audienceFacts'))='s4-b17-audience-facts-connector') AS applied;
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
