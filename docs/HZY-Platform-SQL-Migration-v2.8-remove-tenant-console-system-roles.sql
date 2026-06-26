-- HZY Platform migration v2.8: remove deprecated tenant_console global system role seeds
--
-- Context:
--   Console permissions are now modeled as the normal application app_code='console'.
--   The old internal tenant_console global role/template seeds should no longer appear
--   in platform_system_roles or platform_system_templates.
--
-- Scope:
--   Removes only global platform system role/template seed data for tenant_console.
--   It intentionally leaves tenant_roles / tenant_account_roles untouched for audit
--   continuity; those rows no longer participate in app runtime bundle generation.

START TRANSACTION;

DELETE pstr
FROM `platform_system_template_roles` pstr
LEFT JOIN `platform_system_templates` pst
  ON pst.id = pstr.system_template_id
WHERE pstr.system_role_code IN (
  'tenant_console_owner',
  'tenant_console_operator',
  'tenant_console_viewer'
)
   OR pst.template_code IN (
     'tenant_console_admin',
     'tenant_console_view'
   );

DELETE psrs
FROM `platform_system_role_scopes` psrs
INNER JOIN `platform_system_roles` psr
  ON psr.id = psrs.system_role_id
WHERE psr.app_code = 'tenant_console'
   OR psr.role_code IN (
     'tenant_console_owner',
     'tenant_console_operator',
     'tenant_console_viewer'
   );

DELETE psrp
FROM `platform_system_role_permissions` psrp
INNER JOIN `platform_system_roles` psr
  ON psr.id = psrp.system_role_id
WHERE psr.app_code = 'tenant_console'
   OR psr.role_code IN (
     'tenant_console_owner',
     'tenant_console_operator',
     'tenant_console_viewer'
   );

DELETE FROM `platform_system_templates`
WHERE `template_code` IN (
  'tenant_console_admin',
  'tenant_console_view'
);

DELETE FROM `platform_system_roles`
WHERE `app_code` = 'tenant_console'
   OR `role_code` IN (
     'tenant_console_owner',
     'tenant_console_operator',
     'tenant_console_viewer'
   );

COMMIT;

-- Post-checks:
SELECT
  `id`,
  `role_code`,
  `app_code`,
  `status`
FROM `platform_system_roles`
WHERE `app_code` = 'tenant_console'
   OR `role_code` IN (
     'tenant_console_owner',
     'tenant_console_operator',
     'tenant_console_viewer'
   );
