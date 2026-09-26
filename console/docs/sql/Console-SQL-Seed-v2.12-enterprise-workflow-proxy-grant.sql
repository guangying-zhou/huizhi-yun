-- Candidate grant for the Enterprise Host approval panel. Local C000001 only
-- after a verified grant-table backup. Inserts only if no prior row exists;
-- a revoked row must not be silently reactivated.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'workflow','proxy',
 JSON_OBJECT('source','seed:v2.12','purpose','enterprise-aims-completion-approval-panel','audience','workflow','semanticScope','workflow:proxy'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND sc.current_credential_id IS NOT NULL
 AND NOT EXISTS(
   SELECT 1 FROM service_client_grants existing
   WHERE existing.service_client_id=sc.id AND existing.resource_code='workflow' AND existing.action='proxy'
 );
COMMIT;
