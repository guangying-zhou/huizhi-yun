-- Verification companion for Console SQL Seed v1.49.
SELECT sc.`client_code`, sc.`app_code`, scg.`resource_code`, scg.`action`, scg.`status`,
  JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.purpose')) AS `purpose`
FROM `service_clients` sc
JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE (sc.`client_code`, sc.`app_code`) IN (('aims.runtime','aims'),('altoc.runtime','altoc'),('assets.runtime','assets'),('people.runtime','people'))
  AND scg.`resource_code` IN ('data-runtime:aims:notifications_due','data-runtime:altoc:notifications_due','data-runtime:assets:notifications_due','data-runtime:people:notifications_due')
ORDER BY sc.`app_code`, sc.`client_code`;
