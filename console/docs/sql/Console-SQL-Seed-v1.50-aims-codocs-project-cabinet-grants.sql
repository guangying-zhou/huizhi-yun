-- Console SQL Seed v1.50: Aims -> Codocs project cabinet service grants.
-- NOT EXECUTED by this repository change. Apply only through the approved
-- Console change procedure after reviewing the companion verify file.
--
-- This is service-client-only metadata. It creates no browser role, user
-- grant, resource view permission, client credential, or secret.
--
-- Token contract: aud=codocs, source app=aims, client=aims|aims.runtime,
-- tenant/deployment claims must match the request context. Codocs accepts no
-- wildcard codocs:* or codocs:admin substitute for these endpoints.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_client_grants` (`service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`)
SELECT sc.`id`, 'codocs:project-cabinet', 'read', JSON_OBJECT(
  'source', 'seed:v1.50',
  'purpose', 'aims-codocs-project-cabinet-read',
  'audience', 'codocs',
  'endpoints', JSON_ARRAY(
    '/api/v1/project-cabinet/{id}/download-url',
    '/api/v1/project-cabinet/{id}/preview-url'
  )
), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ON DUPLICATE KEY UPDATE `scope_json` = VALUES(`scope_json`), `status` = 'active', `updated_at` = UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (`service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`)
SELECT sc.`id`, 'codocs:project-cabinet', 'upload', JSON_OBJECT(
  'source', 'seed:v1.50',
  'purpose', 'aims-codocs-project-cabinet-upload',
  'audience', 'codocs',
  'endpoints', JSON_ARRAY('/api/v1/project-cabinet/upload')
), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ON DUPLICATE KEY UPDATE `scope_json` = VALUES(`scope_json`), `status` = 'active', `updated_at` = UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (`service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`)
SELECT sc.`id`, 'codocs:project-cabinet', 'delete', JSON_OBJECT(
  'source', 'seed:v1.50',
  'purpose', 'aims-codocs-project-cabinet-delete',
  'audience', 'codocs',
  'endpoints', JSON_ARRAY('/api/v1/project-cabinet/{id}')
), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ON DUPLICATE KEY UPDATE `scope_json` = VALUES(`scope_json`), `status` = 'active', `updated_at` = UTC_TIMESTAMP();

COMMIT;
