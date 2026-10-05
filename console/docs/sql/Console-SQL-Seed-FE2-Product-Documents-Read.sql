-- FE-2 test-environment candidate. Apply only after B2 review and a Console
-- backup. Existing inactive grants are intentionally left for repair review.
START TRANSACTION;
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT c.id, expected.resource_code, 'read',
  JSON_OBJECT('source','seed:fe2-product-documents-read','tenantCode','C000001','deploymentCode','C000001-test-enterprise','audience',expected.audience,'semanticScope','aims:product-documents:read'),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients c JOIN (
  SELECT 'aims:product-documents' resource_code, 'data-runtime' audience
  UNION ALL SELECT 'tenant-runtime:aims:product-documents', 'tenant-runtime'
) expected
WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise' AND c.status='active'
  AND c.current_credential_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM service_client_grants g
    WHERE g.service_client_id=c.id AND g.resource_code=expected.resource_code AND g.action='read');
COMMIT;
