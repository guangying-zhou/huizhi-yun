-- Console SQL Seed v1.32: Assets service API grants.
-- Date: 2026-06-20
-- Purpose:
--   Allow business runtime service clients to request the Assets service
--   scopes used by delivery package, delivery view, delivery document, and
--   project cost summary service endpoints.
--
-- Token contracts:
--   Aims -> Assets read:
--     aud=assets, scope=assets:read
--     GET /api/v1/service/products
--     POST /api/v1/service/products/resolve-codes
--     GET /api/v1/service/deliveries/package
--   Aims -> Assets write:
--     aud=assets, scope=assets:write
--     POST /api/v1/service/deliveries/upsert
--     POST /api/v1/service/deliveries/{deliveryCode}/documents
--   Altoc -> Assets read/write:
--     aud=assets, scope=assets:read assets:write
--     GET /api/v1/service/products
--     GET /api/v1/service/deliveries/package
--     POST /api/v1/service/deliveries/upsert
--   Finance -> Assets read:
--     aud=assets, scope=assets:read
--     GET /api/v1/service/deliveries/package
--     GET /api/v1/service/projects/{projectCode}/cost-summary
--
-- Prerequisites:
--   - Aims, Altoc, and Finance runtime service clients exist in service_clients,
--     typically app_code in ('aims', 'altoc', 'finance') or client_code
--     in ('aims', 'aims.runtime', 'altoc', 'altoc.runtime',
--         'finance', 'finance.runtime').

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

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
  'assets',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.32',
    'purpose', 'aims-assets-product-and-delivery-package-read',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/products',
      '/api/v1/service/products/resolve-codes',
      '/api/v1/service/deliveries/package'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
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
  'assets',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.32',
    'purpose', 'aims-assets-delivery-view-and-document-write',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/deliveries/upsert',
      '/api/v1/service/deliveries/{deliveryCode}/documents'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
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
  'assets',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.32',
    'purpose', 'altoc-assets-product-and-delivery-package-read',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/products',
      '/api/v1/service/deliveries/package'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'altoc' OR sc.`client_code` IN ('altoc', 'altoc.runtime'))
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
  'assets',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.32',
    'purpose', 'altoc-assets-delivery-view-upsert',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/deliveries/upsert'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'altoc' OR sc.`client_code` IN ('altoc', 'altoc.runtime'))
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
  'assets',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.32',
    'purpose', 'finance-assets-delivery-package-and-cost-summary-read',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/deliveries/package',
      '/api/v1/service/projects/{projectCode}/cost-summary'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'assets' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_assets_read`,
  MAX(scg.`resource_code` = 'assets' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_assets_write`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` IN ('aims', 'altoc', 'finance')
   OR sc.`client_code` IN ('aims', 'aims.runtime', 'altoc', 'altoc.runtime', 'finance', 'finance.runtime')
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status`
ORDER BY sc.`app_code`, sc.`client_code`;
