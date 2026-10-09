-- Console SQL Seed v1.88: Aims runtime -> Codocs deterministic document-quality APIs.
-- Date: 2026-07-25
--
-- Grants only the credential-backed aims.runtime client the three exact
-- service capabilities used to resolve a frozen document version, create an
-- exact review grant, and read that granted version during quality review.

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
  client.`id`,
  grant_spec.`resource_code`,
  grant_spec.`action`,
  JSON_OBJECT(
    'source', 'seed:v1.88',
    'semanticScope', CONCAT(grant_spec.`resource_code`, ':', grant_spec.`action`),
    'purpose', grant_spec.`purpose`,
    'audience', 'codocs',
    'endpoints', grant_spec.`endpoints`
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` client
INNER JOIN (
  SELECT
    'codocs:project-document:version' AS `resource_code`,
    'resolve' AS `action`,
    'aims-runtime-resolve-project-document-version' AS `purpose`,
    JSON_ARRAY('/api/v1/service/project-documents/{uuid}/versions/{versionId}:resolve') AS `endpoints`
  UNION ALL
  SELECT
    'codocs:project-document:review-grant',
    'create',
    'aims-runtime-create-project-document-review-grant',
    JSON_ARRAY('/api/v1/service/project-document-review-grants')
  UNION ALL
  SELECT
    'codocs:project-document:review-content',
    'read',
    'aims-runtime-read-granted-project-document-version',
    JSON_ARRAY('/api/v1/service/project-documents/{uuid}/versions/{versionId}/review-content')
) grant_spec
WHERE client.`status` = 'active'
  AND client.`app_code` = 'aims'
  AND client.`client_code` = 'aims.runtime'
  AND client.`current_credential_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;
