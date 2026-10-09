-- Rollback of b17-connector-audience-facts.sql: restores each row's preflight scope_json by id, only while the row still carries the
-- marker audienceFacts=s4-b17-audience-facts-connector.
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
CREATE TEMPORARY TABLE b17_audience_facts AS
  SELECT * FROM (
      SELECT 6357 AS id,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
      UNION ALL SELECT 9677 AS id,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
      UNION ALL SELECT 628427 AS id,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "usageTypes": ["integration"], "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
      UNION ALL SELECT 628428 AS id,'{"source": "connector-runtime-enrollment", "purpose": "typed-enterprise-connector", "tenantCode": "C000001", "deploymentCode": "C000001-console", "integrationCodes": ["wecom.default", "dingtalk.default", "dingtalk.identity"]}' AS old_json
  ) x;
UPDATE service_client_grants g JOIN b17_audience_facts f ON g.id=f.id
SET g.scope_json = CAST(f.old_json AS JSON), g.updated_at = UTC_TIMESTAMP()
WHERE JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audienceFacts'))='s4-b17-audience-facts-connector';
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
