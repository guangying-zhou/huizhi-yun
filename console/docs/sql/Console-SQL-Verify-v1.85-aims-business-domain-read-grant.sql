-- Console SQL Verify v1.85: Aims tenant business-domain dictionary read grant.

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scg.`resource_code`,
  scg.`action`,
  scg.`status` AS `grant_status`,
  scg.`scope_json`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
 AND scg.`resource_code` = 'console:business-domain'
 AND scg.`action` = 'view'
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ORDER BY sc.`client_code`;
