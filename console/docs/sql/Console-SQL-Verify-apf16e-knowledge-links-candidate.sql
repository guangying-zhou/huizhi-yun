-- Same reviewed variables as the seed. Exactly four rows, all predicates valid.
SELECT COUNT(*)=4 AND COALESCE(SUM(g.status='active' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=BINARY CONCAT(p.resource,':create') AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=BINARY CASE WHEN p.client='enterprise.runtime' THEN p.target ELSE @runtime_audience END AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=BINARY @tenant_code AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=BINARY CASE p.client WHEN 'enterprise.runtime' THEN @enterprise_deployment WHEN 'assets.runtime' THEN @assets_deployment ELSE @codocs_deployment END),0)=4 AS PASS
FROM service_client_grants g JOIN service_clients c ON c.id=g.service_client_id JOIN (
 SELECT 'enterprise.runtime' client,'enterprise' app,'assets' target,'assets:asset-link' resource
 UNION ALL SELECT 'enterprise.runtime','enterprise','codocs','codocs:knowledge-link'
 UNION ALL SELECT 'assets.runtime','assets','assets','assets:asset-link'
 UNION ALL SELECT 'codocs.runtime','codocs','codocs','codocs:knowledge-link'
) p ON BINARY c.client_code=BINARY p.client AND BINARY c.app_code=BINARY p.app
WHERE g.action='create' AND BINARY g.resource_code=BINARY CASE WHEN p.client='enterprise.runtime' THEN p.resource ELSE CONCAT(@runtime_audience,':',p.resource) END;
-- A revoked/conflicting existing row yields PASS=0. Never revive or merge it.
-- Compare ordered full-table non-target hashes with the encrypted preimage;
-- rollback may DELETE only newly inserted IDs after receipt/use checks.
