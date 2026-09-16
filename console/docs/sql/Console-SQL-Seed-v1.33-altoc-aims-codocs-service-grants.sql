-- Console SQL Seed v1.33: Altoc -> Aims/Codocs service API grants.
-- Date: 2026-06-20
-- Purpose:
--   Allow Altoc runtime service clients to request the Aims and Codocs service
--   scopes used by delivery project bridge, service-ticket work item bridge,
--   and ops knowledge document relation linking.
--
-- Token contracts:
--   Altoc -> Aims read:
--     aud=aims, scope=aims:read
--     GET /api/v1/service/projects/by-contract/{contractCode}
--   Altoc -> Aims write:
--     aud=aims, scope=aims:write
--     POST /api/v1/service/projects/from-contract
--     POST /api/v1/service/projects/{projectCode}/payment-milestones:sync
--     POST /api/v1/service/service-tickets/{ticketCode}/work-item
--   Altoc -> Codocs write:
--     aud=codocs, scope=codocs:documents:write
--     POST /api/v1/service/ops-knowledge/link
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
  'aims',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.33',
    'purpose', 'altoc-aims-project-bridge-read',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/projects/by-contract/{contractCode}'
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
  'aims',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.33',
    'purpose', 'altoc-aims-project-and-service-ticket-bridge-write',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/projects/from-contract',
      '/api/v1/service/projects/{projectCode}/payment-milestones:sync',
      '/api/v1/service/service-tickets/{ticketCode}/work-item'
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
  'codocs:documents',
  'write',
  JSON_OBJECT(
    'source', 'seed:v1.33',
    'purpose', 'altoc-codocs-ops-knowledge-relation-link',
    'endpoints', JSON_ARRAY(
      '/api/v1/service/ops-knowledge/link'
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
  MAX(scg.`resource_code` = 'aims' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_aims_read`,
  MAX(scg.`resource_code` = 'aims' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_aims_write`,
  MAX(scg.`resource_code` = 'codocs:documents' AND scg.`action` = 'write' AND scg.`status` = 'active') AS `has_codocs_documents_write`
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
