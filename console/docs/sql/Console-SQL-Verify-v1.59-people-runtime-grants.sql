-- Console SQL Verify v1.59: People tenant-runtime transport grants.

SELECT
  sc.`client_code`,
  sc.`app_code`,
  g.`resource_code`,
  g.`action`,
  g.`status`,
  JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.semanticScope')) AS `semantic_scope`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND (g.`resource_code`, g.`action`) IN (
    ('data-runtime:people', 'read'),
    ('data-runtime:people', 'write'),
    ('tenant-runtime:people', 'read'),
    ('tenant-runtime:people', 'write')
  )
ORDER BY sc.`client_code`, g.`resource_code`, g.`action`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_transport_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
  AND g.`status` = 'active'
  AND (g.`resource_code`, g.`action`) IN (
    ('data-runtime:people', 'read'),
    ('data-runtime:people', 'write'),
    ('tenant-runtime:people', 'read'),
    ('tenant-runtime:people', 'write')
  )
GROUP BY sc.`client_code`
HAVING COUNT(*) = 4;
