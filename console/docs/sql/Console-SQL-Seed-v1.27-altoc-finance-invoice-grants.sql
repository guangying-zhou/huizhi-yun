-- Console SQL Seed v1.27: Altoc -> Finance invoice request service grants.
-- Date: 2026-06-19
-- Purpose:
--   Allow Altoc runtime service clients to request Finance service tokens for
--   invoice request creation/submission.
--
-- Fixes:
--   Console service token request failed: insufficient_scope: finance:write
--
-- Token contracts:
--   Altoc -> Finance read:
--     aud=finance, scope=finance:read
--     GET /api/v1/finance/contracts/{contractCode}/summary
--     GET /api/v1/finance/contracts/summaries
--     GET /api/v1/finance/invoices
--     GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary
--   Altoc -> Finance write:
--     aud=finance, scope=finance:write
--     POST /api/v1/finance/invoice-requests
--     POST /api/v1/finance/invoice-requests/{code}/submit
--
-- Prerequisites:
--   - Altoc runtime service client exists in service_clients, typically
--     app_code='altoc' or client_code in ('altoc', 'altoc.runtime').

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
  'finance',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.27',
    'purpose', 'altoc-finance-contract-summary-invoice-and-maintenance-read',
    'endpoints', JSON_ARRAY(
      '/api/v1/finance/contracts/{contractCode}/summary',
      '/api/v1/finance/contracts/summaries',
      '/api/v1/finance/invoices',
      '/api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary'
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
  'finance',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.27',
    'purpose', 'altoc-finance-invoice-request-create-submit',
    'endpoints', JSON_ARRAY(
      '/api/v1/finance/invoice-requests',
      '/api/v1/finance/invoice-requests/{code}/submit'
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

COMMIT;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'finance' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_finance_read`,
  MAX(scg.`resource_code` = 'finance' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_finance_write`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'altoc'
   OR sc.`client_code` IN ('altoc', 'altoc.runtime')
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status`
ORDER BY sc.`client_code`;
