-- Console SQL Verify v1.41: grant status only; never reads credentials or Vault material.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scg.`status` AS `grant_status`,
  CONCAT(scg.`resource_code`, ':', scg.`action`) AS `scope`,
  CASE
    WHEN sc.`status` = 'active'
      AND scg.`status` = 'active'
      AND CONCAT(scg.`resource_code`, ':', scg.`action`) = 'assets:offboarding-recovery:sync'
    THEN 'PASS'
    ELSE 'FAIL_GRANT'
  END AS `verification_status`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
 AND scg.`resource_code` = 'assets:offboarding-recovery'
 AND scg.`action` = 'sync'
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime'))
ORDER BY sc.`client_code`;
