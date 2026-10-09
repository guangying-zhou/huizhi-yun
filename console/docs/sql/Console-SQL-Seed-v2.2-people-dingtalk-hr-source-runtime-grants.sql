-- Console SQL Seed v2.2: repair People DingTalk HR source Runtime grants.
-- Safe to run repeatedly; contains no credentials.
--
-- v2.1 created only the semantic people:hr-source-department-remap:execute
-- grant. Foundation requests an audience-qualified Runtime token, so both
-- supported Runtime audience grants must exist on the canonical People client.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

-- The unqualified draft grant cannot authorize a Data Runtime token and must
-- not remain as a second authorization fact.
UPDATE service_client_grants
SET status='inactive',updated_at=UTC_TIMESTAMP()
WHERE resource_code='people:hr-source-department-remap'
  AND action='execute';

-- No non-canonical client may hold either audience-qualified remap grant.
UPDATE service_client_grants g
INNER JOIN service_clients sc ON sc.id=g.service_client_id
SET g.status='inactive',g.updated_at=UTC_TIMESTAMP()
WHERE g.resource_code IN (
    'data-runtime:people:hr-source-department-remap',
    'tenant-runtime:people:hr-source-department-remap'
  )
  AND g.action='execute'
  AND NOT (sc.app_code='people' AND sc.client_code='people.runtime');

INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,grant_row.resource_code,'execute',
       JSON_OBJECT(
         'source','seed:v2.2',
         'semanticScope',CONCAT(grant_row.resource_code,':execute'),
         'audience',grant_row.audience,
         'purpose','people-dingtalk-department-reference-remap'
       ),
       'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (
  SELECT 'data-runtime:people:hr-source-department-remap' resource_code,
         'data-runtime' audience
  UNION ALL
  SELECT 'tenant-runtime:people:hr-source-department-remap',
         'tenant-runtime'
) grant_row
WHERE sc.status='active'
  AND sc.app_code='people'
  AND sc.client_code='people.runtime'
ON DUPLICATE KEY UPDATE
  scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

COMMIT;
