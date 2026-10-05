-- Console SQL Verify v1.60: Assets tenant-runtime transport grants.

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
  AND (sc.`app_code` = 'assets' OR sc.`client_code` IN ('assets', 'assets.runtime'))
  AND (g.`resource_code`, g.`action`) IN (
    ('data-runtime:assets', 'read'),
    ('data-runtime:assets', 'write'),
    ('tenant-runtime:assets', 'read'),
    ('tenant-runtime:assets', 'write')
  )
ORDER BY sc.`client_code`, g.`resource_code`, g.`action`;

SELECT
  sc.`client_code`,
  COUNT(*) AS `active_transport_grants`
FROM `service_clients` sc
INNER JOIN `service_client_grants` g ON g.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'assets' OR sc.`client_code` IN ('assets', 'assets.runtime'))
  AND g.`status` = 'active'
  AND (g.`resource_code`, g.`action`) IN (
    ('data-runtime:assets', 'read'),
    ('data-runtime:assets', 'write'),
    ('tenant-runtime:assets', 'read'),
    ('tenant-runtime:assets', 'write')
  )
GROUP BY sc.`client_code`
HAVING COUNT(*) = 4;
