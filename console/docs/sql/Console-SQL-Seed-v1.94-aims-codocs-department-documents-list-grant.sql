-- Console SQL Seed v1.94: Aims runtime -> Codocs department document list.
-- Date: 2026-08-11
--
-- Grants only the source-bound picker contract. It does not grant Aims a
-- Codocs tenant-runtime token, generic document search, summary, or content.

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
  'codocs:department-documents',
  'list',
  JSON_OBJECT(
    'source', 'seed:v1.94',
    'semanticScope', 'codocs:department-documents:list',
    'purpose', 'aims-runtime-codocs-department-document-picker',
    'audience', 'codocs',
    'endpoints', JSON_ARRAY('/api/v1/service/department-documents/search')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND sc.`app_code` = 'aims'
  AND sc.`client_code` = 'aims.runtime'
  AND sc.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;
