-- Prepare only: back up grants; verify registry enterprise deployment first.
-- Exact five E0 identities. Only absent/JSON-null bindings are filled.
-- Wrong non-null bindings, revoked rows and other sources remain untouched.
-- Other semantic fields are unchanged; updated_at records the actual repair.
START TRANSACTION;
UPDATE service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
SET g.scope_json=JSON_SET(g.scope_json,
 '$.tenantCode',IF((JSON_EXTRACT(g.scope_json,'$.tenantCode') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='NULL'),'C000001',JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))),
 '$.deploymentCode',IF((JSON_EXTRACT(g.scope_json,'$.deploymentCode') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='NULL'),'C000001-test-enterprise',JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))))
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
 AND sc.client_type='runtime' AND sc.status='active' AND g.status='active'
 AND EXISTS(SELECT 1 FROM org_profiles WHERE singleton_key=1 AND BINARY tenant_code='C000001')
 AND ((g.id=13227387 AND BINARY g.resource_code='assets:ip-asset' AND BINARY g.action='link-product' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.13' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='assets:ip-asset:link-product')
 OR (g.id=10319368 AND BINARY g.resource_code='console:policy-bundle' AND BINARY g.action='read' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='enterprise-policy-reader' AND (JSON_EXTRACT(g.scope_json,'$.audience') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.audience'))='NULL') AND (JSON_EXTRACT(g.scope_json,'$.semanticScope') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='NULL'))
 OR (g.id=10325375 AND BINARY g.resource_code='data-runtime:console:policy-bundle' AND BINARY g.action='read' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='enterprise-policy-reader' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='console:policy-bundle:read')
 OR (g.id=10325376 AND BINARY g.resource_code='tenant-runtime:console:policy-bundle' AND BINARY g.action='read' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='enterprise-policy-reader' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='tenant-runtime' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='console:policy-bundle:read')
 OR (g.id=13227397 AND BINARY g.resource_code='workflow' AND BINARY g.action='proxy' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.12' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='workflow' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))='workflow:proxy'))
 AND ((JSON_EXTRACT(g.scope_json,'$.tenantCode') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='NULL') OR BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001')
 AND ((JSON_EXTRACT(g.scope_json,'$.deploymentCode') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='NULL') OR BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise')
 AND ((JSON_EXTRACT(g.scope_json,'$.tenantCode') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='NULL') OR (JSON_EXTRACT(g.scope_json,'$.deploymentCode') IS NULL OR JSON_TYPE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='NULL'));
COMMIT;
