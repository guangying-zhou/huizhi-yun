-- Read-only verification; both audiences must report ACTIVE and a real
-- service token must subsequently prove aims:product-documents:read.
SELECT c.client_code, expected.resource_code, 'read' action,
  CASE WHEN g.id IS NULL THEN 'MISSING' WHEN g.status <> 'active' THEN 'NOT_ACTIVE'
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')),'') <> expected.audience
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')),'') <> 'C000001'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')),'') <> 'C000001-test-enterprise'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')),'') <> 'aims:product-documents:read'
      THEN 'BINDING_MISMATCH' ELSE 'ACTIVE' END verification_status
FROM service_clients c JOIN (
  SELECT 'aims:product-documents' resource_code, 'data-runtime' audience
  UNION ALL SELECT 'tenant-runtime:aims:product-documents', 'tenant-runtime'
) expected LEFT JOIN service_client_grants g ON g.service_client_id=c.id
  AND g.resource_code=expected.resource_code AND g.action='read'
WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise'
ORDER BY expected.resource_code;
