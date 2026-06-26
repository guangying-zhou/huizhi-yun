-- Console SQL Seed v1.12: Business app audit log write grants.
--
-- Purpose:
--   Allow Codocs/Aims runtime service clients to write login and operation
--   audit events into Console via service tokens.
--
-- Preconditions:
--   Runtime service clients already exist for the apps that need audit access
--   (for example aims.runtime and codocs.runtime).

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  'audit',
  'write',
  JSON_OBJECT('targets', JSON_ARRAY('login_logs', 'operation_logs')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` IN ('aims', 'codocs')
   OR `client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = JSON_OBJECT('targets', JSON_ARRAY('login_logs', 'operation_logs')),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
