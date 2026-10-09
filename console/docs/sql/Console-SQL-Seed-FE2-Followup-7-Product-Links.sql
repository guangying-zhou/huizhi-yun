-- Apply only in C000001 after the approved grant-table backup and Platform release.
START TRANSACTION;
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT c.id, expected.resource_code, expected.action,
  JSON_OBJECT('source','seed:fe2-followup-7','tenantCode','C000001','deploymentCode','C000001-test-enterprise','audience',expected.audience,'semanticScope',expected.semantic_scope),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients c JOIN (
  SELECT 'aims:product-documents' resource_code, 'create' action, 'data-runtime' audience, 'aims:product-documents:create' semantic_scope
  UNION ALL SELECT 'tenant-runtime:aims:product-documents', 'create', 'tenant-runtime', 'aims:product-documents:create'
  UNION ALL SELECT 'aims:project-products', 'read', 'data-runtime', 'aims:project-products:read'
  UNION ALL SELECT 'tenant-runtime:aims:project-products', 'read', 'tenant-runtime', 'aims:project-products:read'
  UNION ALL SELECT 'aims:project-products', 'create', 'data-runtime', 'aims:project-products:create'
  UNION ALL SELECT 'tenant-runtime:aims:project-products', 'create', 'tenant-runtime', 'aims:project-products:create'
) expected
WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise' AND c.status='active'
  AND c.current_credential_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM service_client_grants g WHERE g.service_client_id=c.id AND g.resource_code=expected.resource_code AND g.action=expected.action);
COMMIT;
