-- Console SQL Verify v2.35 (candidate): GitLab repository operations are read-only.
-- Read-only. Run before and after the seed; after the seed the first query
-- must return zero rows for every status.

-- 1. Grants that still carry a repository write operation (expect none after the seed).
SELECT
  sc.`client_code`,
  sc.`app_code`,
  g.`status`,
  JSON_SEARCH(g.`scope_json`, 'one', 'gitlab.commit', NULL, '$.operations') IS NOT NULL AS `has_commit`,
  JSON_SEARCH(g.`scope_json`, 'one', 'gitlab.resolve-actions', NULL, '$.operations') IS NOT NULL AS `has_resolve_actions`
FROM `service_client_grants` g
JOIN `service_clients` sc ON sc.`id` = g.`service_client_id`
WHERE g.`resource_code` = 'integration_operations'
  AND g.`action` = 'execute'
  AND (
    JSON_SEARCH(g.`scope_json`, 'one', 'gitlab.commit', NULL, '$.operations') IS NOT NULL
    OR JSON_SEARCH(g.`scope_json`, 'one', 'gitlab.resolve-actions', NULL, '$.operations') IS NOT NULL
  )
ORDER BY sc.`client_code`;

-- 2. Remaining GitLab operations per client: the read operations and, where
--    it was granted, gitlab.issue-upsert must be unchanged.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  g.`status`,
  JSON_EXTRACT(g.`scope_json`, '$.integrationCodes') AS `integration_codes`,
  JSON_EXTRACT(g.`scope_json`, '$.operations') AS `operations`
FROM `service_client_grants` g
JOIN `service_clients` sc ON sc.`id` = g.`service_client_id`
WHERE g.`resource_code` = 'integration_operations'
  AND g.`action` = 'execute'
  AND JSON_SEARCH(g.`scope_json`, 'one', 'gitlab.%', NULL, '$.operations') IS NOT NULL
ORDER BY sc.`client_code`;
