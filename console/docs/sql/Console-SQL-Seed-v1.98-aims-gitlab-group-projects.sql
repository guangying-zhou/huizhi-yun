-- Console SQL Seed v1.98: Aims live GitLab group project catalog.
-- Date: 2026-08-24
--
-- Adds only the fixed GitLab group-project listing operation to the existing
-- Aims integration allow-list. Existing GitLab and WeCom operations remain
-- unchanged; this seed does not create credentials or human UI permissions.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

UPDATE `service_client_grants` grant_row
JOIN `service_clients` sc ON sc.`id` = grant_row.`service_client_id`
SET grant_row.`scope_json` = CASE
      WHEN JSON_CONTAINS(
        grant_row.`scope_json`,
        JSON_QUOTE('gitlab.group-projects'),
        '$.operations'
      )
        THEN JSON_SET(grant_row.`scope_json`, '$.source', 'seed:v1.98')
      ELSE JSON_ARRAY_APPEND(
        JSON_SET(grant_row.`scope_json`, '$.source', 'seed:v1.98'),
        '$.operations',
        'gitlab.group-projects'
      )
    END,
    grant_row.`status` = 'active',
    grant_row.`updated_at` = UTC_TIMESTAMP()
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
  AND grant_row.`resource_code` = 'integration_operations'
  AND grant_row.`action` = 'execute'
  AND grant_row.`status` = 'active'
  AND JSON_TYPE(JSON_EXTRACT(grant_row.`scope_json`, '$.integrationCodes')) = 'ARRAY'
  AND JSON_TYPE(JSON_EXTRACT(grant_row.`scope_json`, '$.operations')) = 'ARRAY'
  AND JSON_CONTAINS(
    grant_row.`scope_json`,
    JSON_QUOTE('gitlab.default'),
    '$.integrationCodes'
  );

COMMIT;
