-- Console SQL Seed v1.93: fixed integration Runtime token grants.
-- Date: 2026-08-11
--
-- v1.82/v1.83 created only the semantic integration_operations:execute
-- policy row. Runtime token requests are audience-qualified, so the token
-- issuer also needs data-runtime:/tenant-runtime:integration_operations.
-- v1.83 reused the semantic row and overwrote the Aims/Codocs GitLab policy
-- with the WeCom policy. Repair both layers without broadening the operation
-- allow-list.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- Token-issuance grants. These authorize only the exact plural execute scope;
-- the semantic row below still constrains integration code and operation.
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
  grants.`action`,
  JSON_OBJECT(
    'source', 'seed:v1.93',
    'semanticScope', CONCAT(grants.`resource_code`, ':', grants.`action`),
    'purpose', 'fixed-integration-runtime-token'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
CROSS JOIN (
  SELECT 'data-runtime:integration_operations' AS `resource_code`, 'execute' AS `action`
  UNION ALL SELECT 'tenant-runtime:integration_operations', 'execute'
) grants
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('aims', 'codocs', 'altoc', 'assets', 'workflow')
    OR sc.`client_code` IN (
      'aims', 'aims.runtime', 'codocs', 'codocs.runtime',
      'altoc', 'altoc.runtime', 'assets', 'assets.runtime',
      'workflow', 'workflow.runtime'
    )
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

-- Aims and Codocs consume both GitLab and WeCom fixed operations. Keep the
-- combined policy in the semantic grant that the Runtime rechecks per call.
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
      'gitlab.resolve-actions',
      'wecom.oauth-user',
      'wecom.user-detail'
    )
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('aims', 'codocs')
    OR sc.`client_code` IN ('aims', 'aims.runtime', 'codocs', 'codocs.runtime')
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

-- The remaining consumers use only the two fixed WeCom identity operations.
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
  'integration_operations',
  'execute',
  JSON_OBJECT(
    'integrationCodes', JSON_ARRAY('wecom.default'),
    'operations', JSON_ARRAY('wecom.oauth-user', 'wecom.user-detail')
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('altoc', 'assets', 'workflow')
    OR sc.`client_code` IN (
      'altoc', 'altoc.runtime', 'assets', 'assets.runtime',
      'workflow', 'workflow.runtime'
    )
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

COMMIT;
