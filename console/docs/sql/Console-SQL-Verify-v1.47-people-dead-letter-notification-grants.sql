-- Verification companion for Console SQL Seed v1.47.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  MAX(
    scg.`resource_code` = 'notifications'
    AND scg.`action` = 'publish'
    AND scg.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.purpose')) = 'integration-operation-dead-letter-notification'
  ) AS `has_dead_letter_notifications_publish`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'people' OR sc.`client_code` IN ('people', 'people.runtime')
GROUP BY sc.`client_code`, sc.`app_code`
ORDER BY sc.`app_code`, sc.`client_code`;
