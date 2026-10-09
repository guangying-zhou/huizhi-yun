-- FE-2 follow-up #4b: prepare the exact Enterprise Host notification grant.
-- Apply only after explicit C000001 approval and an encrypted Console backup.
-- Existing disabled or differently bound grants are intentionally not repaired.
START TRANSACTION;
INSERT INTO service_client_grants
  (service_client_id, resource_code, action, scope_json, status, created_at, updated_at)
SELECT c.id, 'notifications', 'publish',
  JSON_OBJECT(
    'source', 'seed:fe2-followup-enterprise-notifications-publish',
    'tenantCode', 'C000001',
    'deploymentCode', 'C000001-test-enterprise',
    'audience', 'notifications',
    'semanticScope', 'notifications:publish'
  ),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients c
WHERE c.client_code = 'enterprise.runtime'
  AND c.app_code = 'enterprise'
  AND c.status = 'active'
  AND c.current_credential_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM service_client_grants g
    WHERE g.service_client_id = c.id
      AND g.resource_code = 'notifications'
      AND g.action = 'publish'
  );
COMMIT;
