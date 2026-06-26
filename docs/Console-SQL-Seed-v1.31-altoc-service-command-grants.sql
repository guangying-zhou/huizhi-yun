-- Console SQL Seed v1.31: Altoc service command callback grants.
-- Date: 2026-06-20
-- Purpose:
--   Allow Aims and Finance service clients to request the fine-grained Altoc
--   service command scopes required by Altoc service endpoints.
--
-- Token contracts:
--   Aims -> Altoc mark receivable plan billable:
--     aud=altoc, scope=altoc:write altoc:receivable:mark-billable
--     POST /api/v1/service/receivable-plans/{receivablePlanCode}/mark-billable
--     POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable
--   Aims -> Altoc sync service-ticket delivery result:
--     aud=altoc, scope=altoc:write altoc:service_ticket:delivery-result:sync
--     POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync
--   Finance -> Altoc sync contract finance summary:
--     aud=altoc, scope=altoc:write altoc:contract:finance-summary:sync
--     POST /api/v1/service/contracts/{contractCode}/finance-summary:sync
--   Finance -> Altoc read customer maintenance summary:
--     aud=altoc, scope=altoc:read
--     GET /api/v1/service/customers/{customerCode}/maintenance-summary
--
-- Prerequisites:
--   - Aims and Finance runtime service clients exist in service_clients,
--     typically app_code in ('aims', 'finance') or client_code
--     in ('aims', 'aims.runtime', 'finance', 'finance.runtime').

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
  'altoc',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.31',
    'purpose', 'altoc-service-command-transport-write',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/receivable-plans/{receivablePlanCode}/mark-billable',
      '/api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable',
      '/api/v1/service/service-tickets/{ticketCode}/delivery-result:sync'
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
  'altoc',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.31',
    'purpose', 'finance-altoc-customer-maintenance-summary-read',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/customers/{customerCode}/maintenance-summary'
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
  'altoc:receivable',
  'mark-billable',
  JSON_OBJECT(
    'source', 'seed:v1.31',
    'purpose', 'aims-altoc-receivable-mark-billable',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/receivable-plans/{receivablePlanCode}/mark-billable',
      '/api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable'
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
  'altoc:service_ticket:delivery-result',
  'sync',
  JSON_OBJECT(
    'source', 'seed:v1.31',
    'purpose', 'aims-altoc-service-ticket-delivery-result-sync',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/service-tickets/{ticketCode}/delivery-result:sync'
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
  'altoc',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.31',
    'purpose', 'altoc-service-command-transport-write',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/contracts/{contractCode}/finance-summary:sync'
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
  'altoc:contract:finance-summary',
  'sync',
  JSON_OBJECT(
    'source', 'seed:v1.31',
    'purpose', 'finance-altoc-contract-finance-summary-sync',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/contracts/{contractCode}/finance-summary:sync'
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
  MAX(scg.`resource_code` = 'altoc' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_altoc_write`,
  MAX(scg.`resource_code` = 'altoc' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_altoc_read`,
  MAX(scg.`resource_code` = 'altoc:receivable' AND scg.`action` = 'mark-billable' AND scg.`status` = 'active') AS `has_altoc_receivable_mark_billable`,
  MAX(scg.`resource_code` = 'altoc:service_ticket:delivery-result' AND scg.`action` = 'sync' AND scg.`status` = 'active') AS `has_altoc_service_ticket_delivery_result_sync`,
  MAX(scg.`resource_code` = 'altoc:contract:finance-summary' AND scg.`action` = 'sync' AND scg.`status` = 'active') AS `has_altoc_contract_finance_summary_sync`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` IN ('aims', 'finance')
   OR sc.`client_code` IN ('aims', 'aims.runtime', 'finance', 'finance.runtime')
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  scc.`client_id`,
  scc.`status`
ORDER BY sc.`app_code`, sc.`client_code`;
