-- Expected result: one row named service_command_receipt.
SELECT `TABLE_NAME`
FROM `information_schema`.`TABLES`
WHERE `TABLE_SCHEMA`=DATABASE()
  AND `TABLE_NAME`='service_command_receipt';

-- Expected result: two rows, both active. The Connector Runtime row must also
-- retain the tenant/deployment binding created during enrollment.
SELECT
  `sc`.`client_code`,
  `sc`.`app_code`,
  `grant_row`.`resource_code`,
  `grant_row`.`action`,
  `grant_row`.`status`,
  JSON_UNQUOTE(JSON_EXTRACT(`grant_row`.`scope_json`,'$.tenantCode')) AS `tenant_code`,
  JSON_UNQUOTE(JSON_EXTRACT(`grant_row`.`scope_json`,'$.deploymentCode')) AS `deployment_code`,
  `grant_row`.`scope_json`
FROM `service_clients` AS `sc`
INNER JOIN `service_client_grants` AS `grant_row`
  ON `grant_row`.`service_client_id`=`sc`.`id`
WHERE (`sc`.`client_code`='console.runtime'
       AND `grant_row`.`resource_code`='connector-runtime:directory'
       AND `grant_row`.`action`='sync')
   OR (`sc`.`app_code`='connector-runtime'
       AND `sc`.`client_code` LIKE 'connector-runtime.%'
       AND `grant_row`.`resource_code`='console:directory-profiles'
       AND `grant_row`.`action`='sync')
ORDER BY `sc`.`client_code`,`grant_row`.`resource_code`;
