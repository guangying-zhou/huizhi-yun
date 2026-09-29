-- Candidate only. Back up service_client_grants before C000001 apply.
-- Insert missing exact audience rows; a revoked row is never reactivated here.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,expected.resource_code,'execute',
 JSON_OBJECT('source','seed:round3-a-plan-ready','purpose','enterprise-work-item-plan-ready',
   'tenantCode','C000001','deploymentCode','C000001-test-enterprise',
   'audience',expected.audience,'semanticScope','aims:work-item-plan-ready:execute'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN (
 SELECT 'aims:work-item-plan-ready' AS resource_code,'data-runtime' AS audience
 UNION ALL SELECT 'tenant-runtime:aims:work-item-plan-ready','tenant-runtime'
) expected
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
 AND sc.status='active' AND sc.current_credential_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM service_client_grants existing
   WHERE existing.service_client_id=sc.id AND existing.resource_code=expected.resource_code
     AND existing.action='execute'
 );
COMMIT;
