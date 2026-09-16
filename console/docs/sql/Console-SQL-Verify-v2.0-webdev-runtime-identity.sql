-- Expected: exactly one active webdev.runtime row with an active current
-- credential and all four runtime grants equal to 1.
SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  SUM(scg.`resource_code` = 'data-runtime:webdev' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `data_runtime_read`,
  SUM(scg.`resource_code` = 'data-runtime:webdev' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `data_runtime_write`,
  SUM(scg.`resource_code` = 'tenant-runtime:webdev' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `tenant_runtime_read`,
  SUM(scg.`resource_code` = 'tenant-runtime:webdev' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `tenant_runtime_write`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`client_code` = 'webdev.runtime'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`;

-- Expected: four active grant rows and no tenant/deployment override in
-- scope_json. The canonical binding is derived from the trusted tenant and
-- exact webdev.runtime client by Console's service-client policy.
SELECT
  scg.`resource_code`,
  scg.`action`,
  scg.`status`,
  scg.`scope_json`
FROM `service_client_grants` scg
INNER JOIN `service_clients` sc
  ON sc.`id` = scg.`service_client_id`
WHERE sc.`client_code` = 'webdev.runtime'
  AND scg.`resource_code` IN ('data-runtime:webdev', 'tenant-runtime:webdev')
ORDER BY scg.`resource_code`, scg.`action`;
