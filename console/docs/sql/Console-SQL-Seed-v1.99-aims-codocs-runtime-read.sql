-- Console SQL Seed v1.99: Aims runtime -> Codocs tenant-runtime read.
-- Date: 2026-08-25
--
-- Aims evaluates project-document access through the shared data runtime with
-- a structured read-only POST. Foundation qualifies codocs.read with the
-- selected runtime audience before requesting a short-lived Console token.
-- Grant both supported audience names only to the credential-backed
-- aims.runtime identity. This seed creates no credential or human permission.

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
  grants.`resource_code`,
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.99',
    'semanticScope', 'codocs.read',
    'purpose', 'aims-runtime-codocs-document-access-check',
    'audience', grants.`audience`,
    'endpoints', JSON_ARRAY('/v1/codocs/document-access/check')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:codocs' AS `resource_code`, 'data-runtime' AS `audience`
  UNION ALL
  SELECT 'tenant-runtime:codocs', 'tenant-runtime'
) grants
WHERE sc.`status` = 'active'
  AND sc.`app_code` = 'aims'
  AND sc.`client_code` = 'aims.runtime'
  AND sc.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;
