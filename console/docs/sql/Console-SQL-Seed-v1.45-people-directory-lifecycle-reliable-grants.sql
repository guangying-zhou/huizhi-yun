SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, grant_row.resource_code, grant_row.action,
       JSON_OBJECT('source','seed:v1.45','purpose','people-directory-lifecycle-reliable-command'),
       'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (
  SELECT 'console:directory-employment' resource_code,'sync' action
  UNION ALL SELECT 'console:directory-offboarding','disable'
) grant_row
WHERE sc.status='active' AND (sc.app_code='people' OR sc.client_code IN ('people','people.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
COMMIT;
