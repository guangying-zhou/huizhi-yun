-- Read-only verification. Every row must be ACTIVE; then probe real issuance.
SELECT c.client_code, expected.resource_code, expected.action,
  CASE WHEN g.id IS NULL THEN 'MISSING' WHEN g.status <> 'active' THEN 'NOT_ACTIVE'
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')),'') <> expected.audience
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')),'') <> 'C000001'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')),'') <> 'C000001-test-enterprise'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')),'') <> expected.semantic_scope
      THEN 'BINDING_MISMATCH' ELSE 'ACTIVE' END verification_status
FROM service_clients c JOIN (
  SELECT 'aims:product-documents' resource_code, 'create' action, 'data-runtime' audience, 'aims:product-documents:create' semantic_scope
  UNION ALL SELECT 'tenant-runtime:aims:product-documents', 'create', 'tenant-runtime', 'aims:product-documents:create'
  UNION ALL SELECT 'aims:project-products', 'read', 'data-runtime', 'aims:project-products:read'
  UNION ALL SELECT 'tenant-runtime:aims:project-products', 'read', 'tenant-runtime', 'aims:project-products:read'
  UNION ALL SELECT 'aims:project-products', 'create', 'data-runtime', 'aims:project-products:create'
  UNION ALL SELECT 'tenant-runtime:aims:project-products', 'create', 'tenant-runtime', 'aims:project-products:create'
) expected LEFT JOIN service_client_grants g ON g.service_client_id=c.id AND g.resource_code=expected.resource_code AND g.action=expected.action
WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise'
ORDER BY expected.resource_code, expected.action;
