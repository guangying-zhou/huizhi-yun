-- Prepare only. Apply after review to the selected test tenant Console database.
-- Back up service_client_grants first. One exact grant is used by both
-- data-runtime and tenant-runtime audiences, as with policy-bundle grants.
-- Neither bootstrap nor Console key assertion receives this scope directly.
START TRANSACTION;
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'console:service-token','exchange',
  JSON_OBJECT('source','seed:cpu-p1-service-token-exchange',
    'audiences',JSON_ARRAY('data-runtime','tenant-runtime')),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.client_code='console.runtime' AND sc.app_code='console'
  AND sc.client_type='runtime' AND sc.status='active'
  AND sc.current_credential_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM service_client_grants existing
    WHERE existing.service_client_id=sc.id
      AND existing.resource_code='console:service-token'
      AND existing.action='exchange'
  );
COMMIT;
