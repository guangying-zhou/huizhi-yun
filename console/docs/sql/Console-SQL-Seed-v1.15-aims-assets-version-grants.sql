-- Console SQL Seed v1.15: Aims/Assets product-version service grants.
--
-- Purpose:
--   Allow Aims to read product master data from Assets and allow Assets to
--   read product version summaries from Aims through Console service tokens.
--
-- Preconditions:
--   Runtime service clients already exist for Aims and Assets
--   (for example aims.runtime and assets.runtime).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

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
  'assets',
  'read',
  JSON_OBJECT('endpoints', JSON_ARRAY('/api/v1/service/products')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` = 'aims'
   OR `client_code` IN ('aims', 'aims.runtime')
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
  `id`,
  'aims',
  'read',
  JSON_OBJECT('endpoints', JSON_ARRAY('/api/v1/service/products/:productCode/versions')),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `app_code` = 'assets'
   OR `client_code` IN ('assets', 'assets.runtime')
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
