-- Candidate local C000001 grant for the Enterprise Host IP product relation.
-- Back up service_client_grants first. A missing row alone is inserted;
-- an inactive prior row requires separate review and is never reactivated here.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'assets:ip-asset','link-product',
 JSON_OBJECT('source','seed:v2.13','purpose','enterprise-ip-asset-product-link','audience','data-runtime','semanticScope','assets:ip-asset:link-product'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND sc.current_credential_id IS NOT NULL
 AND NOT EXISTS(
   SELECT 1 FROM service_client_grants existing
   WHERE existing.service_client_id=sc.id AND existing.resource_code='assets:ip-asset' AND existing.action='link-product'
 );
COMMIT;
