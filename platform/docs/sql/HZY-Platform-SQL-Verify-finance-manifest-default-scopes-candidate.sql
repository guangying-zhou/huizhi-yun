-- Read-only. Run after migration and again after the approved manifest import.
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_app_role_scopes' AND COLUMN_NAME = 'source_type';
SELECT source_type, COUNT(*) AS scope_count FROM platform_app_role_scopes GROUP BY source_type;
-- Both must be zero; role/action authority comes from the same declared permission.
SELECT COUNT(*) AS orphan_default_scopes
FROM platform_app_role_scopes s LEFT JOIN platform_app_role_permissions p
 ON p.app_role_id=s.app_role_id AND p.app_code=s.app_code AND p.resource_code=s.resource_code AND p.action=s.action
WHERE s.source_type='manifest_default' AND p.app_role_id IS NULL;
SELECT COUNT(*) AS invalid_default_roles
FROM platform_app_role_scopes s JOIN platform_app_roles r ON r.id=s.app_role_id
WHERE s.app_code='finance' AND s.source_type='manifest_default'
 AND NOT ((r.role_code IN ('finance:admin','finance:manager') AND s.scope_type='tenant' AND s.scope_value='global')
 OR (r.role_code='finance:expense_submitter' AND s.resource_code='expenses' AND s.scope_type='subject' AND s.scope_value='self'));
