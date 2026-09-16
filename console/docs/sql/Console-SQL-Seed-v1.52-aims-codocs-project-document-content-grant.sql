-- Console SQL Seed v1.52: Aims -> Codocs exact project-document content read.
-- NOT EXECUTED by this repository change. Apply only through the approved
-- Console change procedure after companion verify review.
--
-- This grants a service capability only. It creates no browser role, user
-- grant, credential, secret, document ACL, or project membership. Codocs
-- still requires the signed command and its own owner/share/relation ACL.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `service_client_grants` (`service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`)
SELECT sc.`id`, 'codocs:project-document:content', 'read', JSON_OBJECT(
  'source', 'seed:v1.52',
  'purpose', 'aims-codocs-project-document-content-read',
  'audience', 'codocs',
  'endpoints', JSON_ARRAY('/api/v1/service/project-documents/{uuid}/content')
), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND sc.`app_code` = 'aims'
  AND sc.`client_code` = 'aims'
ON DUPLICATE KEY UPDATE `scope_json` = VALUES(`scope_json`), `status` = 'active', `updated_at` = UTC_TIMESTAMP();

COMMIT;
