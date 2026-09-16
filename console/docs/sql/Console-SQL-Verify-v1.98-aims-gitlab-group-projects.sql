-- Console SQL Verify v1.98: query below must return no rows.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT sc.`client_code`, sc.`app_code`, grant_row.`status`, grant_row.`scope_json`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = sc.`id`
 AND grant_row.`resource_code` = 'integration_operations'
 AND grant_row.`action` = 'execute'
 AND grant_row.`status` = 'active'
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
  AND (
    grant_row.`id` IS NULL
    OR JSON_TYPE(JSON_EXTRACT(grant_row.`scope_json`, '$.integrationCodes')) <> 'ARRAY'
    OR JSON_TYPE(JSON_EXTRACT(grant_row.`scope_json`, '$.operations')) <> 'ARRAY'
    OR NOT JSON_CONTAINS(
      grant_row.`scope_json`,
      JSON_QUOTE('gitlab.default'),
      '$.integrationCodes'
    )
    OR NOT JSON_CONTAINS(
      grant_row.`scope_json`,
      JSON_QUOTE('gitlab.group-projects'),
      '$.operations'
    )
  );
