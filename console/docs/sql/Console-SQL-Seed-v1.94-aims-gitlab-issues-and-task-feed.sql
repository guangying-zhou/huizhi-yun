-- Console SQL Seed v1.94: Aims GitLab Issue export and external task feed.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- Aims alone may create/update GitLab Issues through the fixed-operation
-- boundary. Keep Codocs and other consumers on their existing narrower set.
INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`,
  'integration_operations',
  'execute',
  JSON_OBJECT(
    'integrationCodes', JSON_ARRAY('gitlab.default', 'wecom.default'),
    'operations', JSON_ARRAY(
      'gitlab.project-info',
      'gitlab.commits',
      'gitlab.commit-diff',
      'gitlab.markdown-tree',
      'gitlab.file',
      'gitlab.commit',
      'gitlab.issue-upsert',
      'gitlab.resolve-actions',
      'wecom.oauth-user',
      'wecom.user-detail'
    ),
    'source', 'seed:v1.94'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` = 'aims'
    OR sc.`client_code` IN ('aims', 'aims.runtime')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

-- Existing external task consumers receive only the exact Aims task-read
-- capability. A separately provisioned Orca client can be enrolled by using
-- app_code/client_code `orca` and rerunning this seed.
INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`,
  'aims:tasks',
  'read',
  JSON_OBJECT(
    'source', 'seed:v1.94',
    'semanticScope', 'aims:tasks:read',
    'purpose', 'external-consumer-read-aims-task-feed',
    'audience', 'aims',
    'endpoints', JSON_ARRAY('/api/v1/service/tasks')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('webdev', 'orca')
    OR sc.`client_code` IN ('webdev', 'webdev.runtime', 'orca', 'orca.runtime')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;
