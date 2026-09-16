-- HZY Platform verify v2.17: People administrator integration-operation permissions.

SELECT
  ar.`role_code`,
  rp.`resource_code`,
  rp.`action`,
  rp.`manifest_action_id`
FROM `platform_app_roles` ar
INNER JOIN `platform_app_role_permissions` rp ON rp.`app_role_id` = ar.`id`
WHERE ar.`app_code` = 'people'
  AND ar.`role_code` = 'people:admin'
  AND rp.`resource_code` = 'integration_operations'
  AND rp.`action` IN ('view', 'replay')
ORDER BY rp.`action`;
