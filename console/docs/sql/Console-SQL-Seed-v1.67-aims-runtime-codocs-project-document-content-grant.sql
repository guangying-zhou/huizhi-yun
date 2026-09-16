-- Console SQL Seed v1.67: Aims runtime -> Codocs exact project-document content read.
-- Date: 2026-07-14
--
-- v1.52 granted this capability to the metadata-only `aims` client. Managed
-- Cloudflare requests are issued by the credential-backed `aims.runtime`
-- identity. Grant only that exact active runtime client; do not create or
-- rotate credentials and do not grant browser permissions.

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
  'codocs:project-document:content',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.67',
    'semanticScope', 'codocs:project-document:content:read',
    'purpose', 'aims-runtime-codocs-project-document-content-read',
    'audience', 'codocs',
    'endpoints', JSON_ARRAY('/api/v1/service/project-documents/{uuid}/content')
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
