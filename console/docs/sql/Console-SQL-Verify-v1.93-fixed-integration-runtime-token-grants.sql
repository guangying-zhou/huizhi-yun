-- Console SQL Verify v1.93: fixed integration Runtime token grants.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every fixed-operation consumer must have both audience-qualified token
-- grants. Each client should return two rows here.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  CONCAT(g.`resource_code`, ':', g.`action`) AS `scope`,
  g.`status`,
  JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.purpose')) AS `purpose`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('aims', 'codocs', 'altoc', 'assets', 'workflow')
    OR sc.`client_code` IN (
      'aims', 'aims.runtime', 'codocs', 'codocs.runtime',
      'altoc', 'altoc.runtime', 'assets', 'assets.runtime',
      'workflow', 'workflow.runtime'
    )
  )
  AND g.`resource_code` IN (
    'data-runtime:integration_operations',
    'tenant-runtime:integration_operations'
  )
  AND g.`action` = 'execute'
ORDER BY sc.`app_code`, sc.`client_code`, g.`resource_code`;

-- This query must return no rows. Aims/Codocs need the union of GitLab and
-- WeCom policies after the v1.83 overwrite is repaired.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  g.`scope_json`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('aims', 'codocs')
    OR sc.`client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
  )
  AND g.`resource_code` = 'integration_operations'
  AND g.`action` = 'execute'
  AND g.`status` = 'active'
  AND NOT (
    JSON_CONTAINS(g.`scope_json`, JSON_QUOTE('gitlab.default'), '$.integrationCodes')
    AND JSON_CONTAINS(g.`scope_json`, JSON_QUOTE('wecom.default'), '$.integrationCodes')
    AND JSON_CONTAINS(g.`scope_json`, JSON_QUOTE('gitlab.markdown-tree'), '$.operations')
    AND JSON_CONTAINS(g.`scope_json`, JSON_QUOTE('gitlab.file'), '$.operations')
    AND JSON_CONTAINS(g.`scope_json`, JSON_QUOTE('wecom.oauth-user'), '$.operations')
    AND JSON_CONTAINS(g.`scope_json`, JSON_QUOTE('wecom.user-detail'), '$.operations')
  );

-- This query must return no rows. It catches a missing Runtime audience grant.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  COUNT(DISTINCT g.`resource_code`) AS `active_runtime_token_grants`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
 AND g.`resource_code` IN (
   'data-runtime:integration_operations',
   'tenant-runtime:integration_operations'
 )
 AND g.`action` = 'execute'
 AND g.`status` = 'active'
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('aims', 'codocs', 'altoc', 'assets', 'workflow')
    OR sc.`client_code` IN (
      'aims', 'aims.runtime', 'codocs', 'codocs.runtime',
      'altoc', 'altoc.runtime', 'assets', 'assets.runtime',
      'workflow', 'workflow.runtime'
    )
  )
GROUP BY sc.`id`, sc.`client_code`, sc.`app_code`
HAVING COUNT(DISTINCT g.`resource_code`) <> 2;
