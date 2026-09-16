-- HZY Platform verify v2.19: project governance roles.

SELECT
  role.`role_code`,
  role.`max_active_assignments`,
  role.`subject_type_constraint`,
  role.`status`,
  GROUP_CONCAT(map.`app_role_code` ORDER BY map.`sort_order` SEPARATOR ',') AS `app_roles`
FROM `platform_system_roles` role
LEFT JOIN `platform_system_app_role_maps` map
  ON map.`system_role_id` = role.`id`
WHERE role.`role_code` IN ('project_director', 'qa')
GROUP BY
  role.`role_code`,
  role.`max_active_assignments`,
  role.`subject_type_constraint`,
  role.`status`
ORDER BY role.`role_code`;

-- Must return no rows.
SELECT
  role.`tenant_code`,
  role.`role_code`,
  COUNT(*) AS `active_holder_count`
FROM `tenant_roles` role
INNER JOIN `tenant_subject_roles` assignment
  ON assignment.`tenant_code` = role.`tenant_code`
 AND assignment.`role_id` = role.`id`
 AND assignment.`status` = 'active'
 AND (assignment.`starts_at` IS NULL OR assignment.`starts_at` <= UTC_TIMESTAMP())
 AND (assignment.`expired_at` IS NULL OR assignment.`expired_at` > UTC_TIMESTAMP())
WHERE role.`role_code` IN ('project_director', 'qa')
GROUP BY role.`tenant_code`, role.`role_code`
HAVING COUNT(*) > 1;
