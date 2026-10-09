-- Console SQL Seed v2.1: exact People -> Console DingTalk HR source grants.
-- Safe to run repeatedly; contains no credentials.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

-- Revoke grants created by early drafts of this seed. These resources are
-- dedicated to this integration, so no non-canonical client may retain them.
UPDATE service_client_grants g
INNER JOIN service_clients sc ON sc.id=g.service_client_id
SET g.status='inactive',g.updated_at=UTC_TIMESTAMP()
WHERE g.resource_code='console:hr-source-sync'
  AND NOT (
    (sc.app_code='people' AND sc.client_code='people.runtime')
    OR (sc.app_code='console' AND sc.client_code='console.runtime')
  );

UPDATE service_client_grants g
INNER JOIN service_clients sc ON sc.id=g.service_client_id
SET g.status='inactive',g.updated_at=UTC_TIMESTAMP()
WHERE g.resource_code='people:hr-source-department-remap'
  AND NOT (sc.app_code='people' AND sc.client_code='people.runtime');

INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'console:hr-source-sync',grant_row.action,
       JSON_OBJECT('source','seed:v2.1','purpose','people-dingtalk-hr-source-sync'),
       'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (
  SELECT 'view' action
  UNION ALL SELECT 'execute'
  UNION ALL SELECT 'admin'
) grant_row
WHERE sc.status='active'
  AND sc.app_code='people'
  AND sc.client_code='people.runtime'
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

-- Only the canonical People Runtime client may rewrite People department
-- references, and only after validating the alias against Console facts.
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'people:hr-source-department-remap','execute',
       JSON_OBJECT('source','seed:v2.1','purpose','people-dingtalk-department-reference-remap'),
       'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active'
  AND sc.app_code='people'
  AND sc.client_code='people.runtime'
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

-- Console re-signs the People service command for its own tenant runtime.
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'console:hr-source-sync',grant_row.action,
       JSON_OBJECT('source','seed:v2.1','purpose','console-hr-source-tenant-runtime'),
       'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (
  SELECT 'view' action
  UNION ALL SELECT 'admin'
) grant_row
WHERE sc.status='active'
  AND sc.app_code='console'
  AND sc.client_code='console.runtime'
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

COMMIT;
