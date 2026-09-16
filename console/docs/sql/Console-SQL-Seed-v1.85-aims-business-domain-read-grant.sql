-- Console SQL Seed v1.85: Aims tenant business-domain dictionary read grant.
-- Date: 2026-07-18
--
-- Aims project forms need the tenant business-domain dictionary, but project
-- roles must not receive Console org-profile UI permissions. This service-only
-- grant authorizes only the read endpoint used by the Aims BFF.

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
  'console:business-domain',
  'view',
  JSON_OBJECT(
    'source', 'seed:v1.85',
    'purpose', 'aims-read-tenant-business-domain-dictionary',
    'endpoint', '/api/v1/console/service/business-domains'
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

COMMIT;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  scg.`resource_code`,
  scg.`action`,
  scg.`scope_json`,
  scg.`status`
FROM `service_clients` sc
INNER JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
  AND scg.`resource_code` = 'console:business-domain'
  AND scg.`action` = 'view';
