-- HZY Platform seed v2.18: People administrator HR source permissions.
-- Run after publishing the People manifest that contains hr_source_sync.
START TRANSACTION;

SET @people_manifest_id := (
  SELECT COALESCE(par.manifest_id, pa.latest_manifest_id)
  FROM platform_applications pa
  LEFT JOIN platform_app_releases par
    ON par.id=pa.latest_release_id AND par.app_code=pa.app_code
  WHERE pa.app_code='people'
  LIMIT 1
);

INSERT INTO platform_app_role_permissions
  (app_role_id,app_code,resource_code,action,manifest_action_id,created_at)
SELECT ar.id,mra.app_code,mra.resource_code,mra.action,mra.id,UTC_TIMESTAMP()
FROM platform_app_roles ar
INNER JOIN platform_app_manifest_resource_actions mra
  ON mra.manifest_id=@people_manifest_id
 AND mra.app_code='people'
 AND mra.resource_code='hr_source_sync'
 AND mra.action IN ('view','execute','admin')
 AND mra.status='active'
WHERE ar.role_code='people:admin' AND ar.app_code='people' AND ar.status='active'
ON DUPLICATE KEY UPDATE manifest_action_id=VALUES(manifest_action_id);

COMMIT;
