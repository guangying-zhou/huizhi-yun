SELECT
  sc.`client_code`,sc.`app_code`,sc.`status` AS client_status,
  scc.`status` AS credential_status,
  scg.`status` AS grant_status,
  CONCAT(scg.`resource_code`,':',scg.`action`) AS capability
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id`=sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id`=sc.`id`
 AND scg.`resource_code`='assets:offboarding-recovery'
 AND scg.`action`='sync'
WHERE sc.`app_code`='people' OR sc.`client_code` IN ('people','people.runtime');
