-- Console SQL Seed v1.21: People / Finance runtime service clients and cross-app grants.
-- Date: 2026-06-17
-- Purpose:
--   People BFF reads Finance people-cost parameters through Console service tokens:
--     aud=finance, scope=finance:read, source=people.
--   Finance project accounting sync reads People project people-cost summaries:
--     aud=people, scope=people:read, source=finance.
--   Aims contribution sync writes People contribution snapshots:
--     aud=people, scope=people:write, source=aims.
--
-- Symptom when missing:
--   Console service token request failed: service client not found for app: people
--   or insufficient_scope for finance:read / people:read / people:write.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- people.runtime
-- ---------------------------------------------------------------------------
INSERT INTO `service_clients` (
  `client_code`,
  `client_name`,
  `client_type`,
  `app_code`,
  `description`,
  `status`,
  `created_at`,
  `updated_at`
) VALUES (
  'people.runtime',
  'People Runtime',
  'app',
  'people',
  'Runtime app identity for People cross-module service calls',
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
) ON DUPLICATE KEY UPDATE
  `client_name` = VALUES(`client_name`),
  `client_type` = VALUES(`client_type`),
  `app_code` = VALUES(`app_code`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SET @people_sc_id := (
  SELECT `id` FROM `service_clients`
  WHERE `client_code` = 'people.runtime'
  LIMIT 1
);

INSERT INTO `vault_secrets` (
  `secret_code`,
  `secret_ref`,
  `secret_name`,
  `secret_type`,
  `usage_type`,
  `owner_type`,
  `owner_key`,
  `storage_backend`,
  `reveal_policy`,
  `masked_preview`,
  `status`,
  `created_by`,
  `created_at`,
  `updated_at`
) VALUES (
  'svc.people.runtime.client_secret',
  'hzybase://vault/svc.people.runtime.client_secret',
  'People Runtime Secret',
  'client_secret',
  'service',
  'service_client',
  'people.runtime',
  'env_ref',
  'approval',
  'runtime-identity',
  'active',
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
) ON DUPLICATE KEY UPDATE
  `secret_name` = VALUES(`secret_name`),
  `secret_type` = 'client_secret',
  `usage_type` = 'service',
  `owner_type` = 'service_client',
  `owner_key` = VALUES(`owner_key`),
  `storage_backend` = 'env_ref',
  `reveal_policy` = 'approval',
  `masked_preview` = VALUES(`masked_preview`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SET @people_secret_id := (
  SELECT `id` FROM `vault_secrets`
  WHERE `secret_code` = 'svc.people.runtime.client_secret'
  LIMIT 1
);

INSERT INTO `vault_secret_versions` (
  `secret_id`,
  `version_no`,
  `backend_secret_ref`,
  `content_hash`,
  `encryption_scheme`,
  `status`,
  `activated_at`,
  `created_by`,
  `created_at`
)
SELECT
  @people_secret_id,
  1,
  'HZY_SERVICE_CLIENT_PEOPLE_SECRET',
  'sha256_runtime_identity_placeholder_people',
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'system',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secret_versions`
  WHERE `secret_id` = @people_secret_id
    AND `version_no` = 1
);

SET @people_secret_version_id := (
  SELECT `id` FROM `vault_secret_versions`
  WHERE `secret_id` = @people_secret_id
    AND `version_no` = 1
  LIMIT 1
);

UPDATE `vault_secret_versions`
SET `backend_secret_ref` = 'HZY_SERVICE_CLIENT_PEOPLE_SECRET',
    `content_hash` = 'sha256_runtime_identity_placeholder_people',
    `encryption_scheme` = 'external_ref',
    `status` = 'active'
WHERE `id` = @people_secret_version_id;

UPDATE `vault_secrets`
SET `current_version_id` = @people_secret_version_id,
    `updated_at` = UTC_TIMESTAMP()
WHERE `id` = @people_secret_id;

INSERT INTO `service_client_credentials` (
  `service_client_id`,
  `client_id`,
  `version_no`,
  `secret_id`,
  `issued_at`,
  `status`
) VALUES (
  @people_sc_id,
  'people.runtime',
  1,
  @people_secret_id,
  UTC_TIMESTAMP(),
  'active'
) ON DUPLICATE KEY UPDATE
  `service_client_id` = VALUES(`service_client_id`),
  `secret_id` = VALUES(`secret_id`),
  `status` = 'active';

SET @people_credential_id := (
  SELECT `id` FROM `service_client_credentials`
  WHERE `client_id` = 'people.runtime'
  LIMIT 1
);

UPDATE `service_client_credentials`
SET `status` = 'retired'
WHERE `service_client_id` = @people_sc_id
  AND `id` <> @people_credential_id
  AND `status` = 'active';

UPDATE `service_clients`
SET `current_credential_id` = @people_credential_id,
    `updated_at` = UTC_TIMESTAMP()
WHERE `id` = @people_sc_id;

-- ---------------------------------------------------------------------------
-- finance.runtime
-- ---------------------------------------------------------------------------
INSERT INTO `service_clients` (
  `client_code`,
  `client_name`,
  `client_type`,
  `app_code`,
  `description`,
  `status`,
  `created_at`,
  `updated_at`
) VALUES (
  'finance.runtime',
  'Finance Runtime',
  'app',
  'finance',
  'Runtime app identity for Finance cross-module service calls',
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
) ON DUPLICATE KEY UPDATE
  `client_name` = VALUES(`client_name`),
  `client_type` = VALUES(`client_type`),
  `app_code` = VALUES(`app_code`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SET @finance_sc_id := (
  SELECT `id` FROM `service_clients`
  WHERE `client_code` = 'finance.runtime'
  LIMIT 1
);

INSERT INTO `vault_secrets` (
  `secret_code`,
  `secret_ref`,
  `secret_name`,
  `secret_type`,
  `usage_type`,
  `owner_type`,
  `owner_key`,
  `storage_backend`,
  `reveal_policy`,
  `masked_preview`,
  `status`,
  `created_by`,
  `created_at`,
  `updated_at`
) VALUES (
  'svc.finance.runtime.client_secret',
  'hzybase://vault/svc.finance.runtime.client_secret',
  'Finance Runtime Secret',
  'client_secret',
  'service',
  'service_client',
  'finance.runtime',
  'env_ref',
  'approval',
  'runtime-identity',
  'active',
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
) ON DUPLICATE KEY UPDATE
  `secret_name` = VALUES(`secret_name`),
  `secret_type` = 'client_secret',
  `usage_type` = 'service',
  `owner_type` = 'service_client',
  `owner_key` = VALUES(`owner_key`),
  `storage_backend` = 'env_ref',
  `reveal_policy` = 'approval',
  `masked_preview` = VALUES(`masked_preview`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

SET @finance_secret_id := (
  SELECT `id` FROM `vault_secrets`
  WHERE `secret_code` = 'svc.finance.runtime.client_secret'
  LIMIT 1
);

INSERT INTO `vault_secret_versions` (
  `secret_id`,
  `version_no`,
  `backend_secret_ref`,
  `content_hash`,
  `encryption_scheme`,
  `status`,
  `activated_at`,
  `created_by`,
  `created_at`
)
SELECT
  @finance_secret_id,
  1,
  'HZY_SERVICE_CLIENT_FINANCE_SECRET',
  'sha256_runtime_identity_placeholder_finance',
  'external_ref',
  'active',
  UTC_TIMESTAMP(),
  'system',
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM `vault_secret_versions`
  WHERE `secret_id` = @finance_secret_id
    AND `version_no` = 1
);

SET @finance_secret_version_id := (
  SELECT `id` FROM `vault_secret_versions`
  WHERE `secret_id` = @finance_secret_id
    AND `version_no` = 1
  LIMIT 1
);

UPDATE `vault_secret_versions`
SET `backend_secret_ref` = 'HZY_SERVICE_CLIENT_FINANCE_SECRET',
    `content_hash` = 'sha256_runtime_identity_placeholder_finance',
    `encryption_scheme` = 'external_ref',
    `status` = 'active'
WHERE `id` = @finance_secret_version_id;

UPDATE `vault_secrets`
SET `current_version_id` = @finance_secret_version_id,
    `updated_at` = UTC_TIMESTAMP()
WHERE `id` = @finance_secret_id;

INSERT INTO `service_client_credentials` (
  `service_client_id`,
  `client_id`,
  `version_no`,
  `secret_id`,
  `issued_at`,
  `status`
) VALUES (
  @finance_sc_id,
  'finance.runtime',
  1,
  @finance_secret_id,
  UTC_TIMESTAMP(),
  'active'
) ON DUPLICATE KEY UPDATE
  `service_client_id` = VALUES(`service_client_id`),
  `secret_id` = VALUES(`secret_id`),
  `status` = 'active';

SET @finance_credential_id := (
  SELECT `id` FROM `service_client_credentials`
  WHERE `client_id` = 'finance.runtime'
  LIMIT 1
);

UPDATE `service_client_credentials`
SET `status` = 'retired'
WHERE `service_client_id` = @finance_sc_id
  AND `id` <> @finance_credential_id
  AND `status` = 'active';

UPDATE `service_clients`
SET `current_credential_id` = @finance_credential_id,
    `updated_at` = UTC_TIMESTAMP()
WHERE `id` = @finance_sc_id;

-- ---------------------------------------------------------------------------
-- Cross-app grants.
-- ---------------------------------------------------------------------------
INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
) VALUES
  (@people_sc_id, 'finance', 'read', JSON_OBJECT('source', 'seed:v1.21', 'purpose', 'people-read-finance-cost-parameters'), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  (@finance_sc_id, 'people', 'read', JSON_OBJECT('source', 'seed:v1.21', 'purpose', 'finance-read-people-project-costs'), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

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
  sc.`id`,
  'people',
  'write',
  JSON_OBJECT('source', 'seed:v1.21', 'purpose', 'aims-sync-people-contributions'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
INNER JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
WHERE sc.`status` = 'active'
  AND scc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  GROUP_CONCAT(CONCAT(scg.`resource_code`, ':', scg.`action`) ORDER BY scg.`resource_code`, scg.`action` SEPARATOR ',') AS `active_grants`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
 AND scg.`status` = 'active'
WHERE sc.`client_code` IN ('people.runtime', 'finance.runtime', 'aims.runtime')
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;
