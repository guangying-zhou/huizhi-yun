-- HZY Platform seed v2.17: People administrator integration-operation permissions.
-- Date: 2026-07-13
--
-- The enterprise system_admin role maps to people:admin. Keep that role in
-- sync with the People manifest so operational diagnostics do not require a
-- second, hidden People directory role.

START TRANSACTION;

SET @people_manifest_id := (
  SELECT COALESCE(par.manifest_id, pa.latest_manifest_id)
  FROM platform_applications pa
  LEFT JOIN platform_app_releases par
    ON par.id = pa.latest_release_id
   AND par.app_code = pa.app_code
  WHERE pa.app_code = 'people'
  LIMIT 1
);

INSERT INTO `platform_app_role_permissions`
  (`app_role_id`, `app_code`, `resource_code`, `action`, `manifest_action_id`, `created_at`)
SELECT
  ar.`id`,
  mra.`app_code`,
  mra.`resource_code`,
  mra.`action`,
  mra.`id`,
  UTC_TIMESTAMP()
FROM `platform_app_roles` ar
INNER JOIN `platform_app_manifest_resource_actions` mra
  ON mra.`manifest_id` = @people_manifest_id
 AND mra.`app_code` = 'people'
 AND mra.`resource_code` = 'integration_operations'
 AND mra.`action` IN ('view', 'replay')
 AND mra.`status` = 'active'
WHERE ar.`role_code` = 'people:admin'
  AND ar.`app_code` = 'people'
  AND ar.`status` = 'active'
ON DUPLICATE KEY UPDATE
  `manifest_action_id` = VALUES(`manifest_action_id`);

COMMIT;
