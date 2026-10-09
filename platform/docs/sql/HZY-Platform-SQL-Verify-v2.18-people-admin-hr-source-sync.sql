-- HZY Platform verify v2.18: People administrator HR source permissions.
SELECT ar.role_code,rp.resource_code,rp.action,rp.manifest_action_id
FROM platform_app_roles ar
INNER JOIN platform_app_role_permissions rp ON rp.app_role_id=ar.id
WHERE ar.app_code='people'
  AND ar.role_code='people:admin'
  AND rp.resource_code='hr_source_sync'
  AND rp.action IN ('view','execute','admin')
ORDER BY rp.action;
