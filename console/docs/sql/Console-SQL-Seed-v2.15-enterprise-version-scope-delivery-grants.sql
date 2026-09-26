-- Candidate only. Back up service_client_grants before C000001 apply.
-- Four exact scope-action/audience rows; revoked rows require separate review.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,expected.resource_code,expected.action,
 JSON_OBJECT('source','seed:round3-b-stage2','purpose','enterprise-version-scope-delivery',
  'tenantCode','C000001','deploymentCode','C000001-test-enterprise',
  'audience',expected.audience,'semanticScope',CONCAT('aims:product-versions:',expected.action)),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN (
 SELECT 'aims:product-versions' AS resource_code,'data-runtime' AS audience,'scope-deliver' AS action
 UNION ALL SELECT 'aims:product-versions','data-runtime','scope-reopen'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','tenant-runtime','scope-deliver'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','tenant-runtime','scope-reopen'
) expected
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
 AND sc.status='active' AND sc.current_credential_id IS NOT NULL
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id AND existing.resource_code=expected.resource_code
   AND existing.action=expected.action
 );
COMMIT;
