-- Console SQL Seed v1.20: Workflow runtime and proxy service grants.
-- Date: 2026-06-14
-- Purpose:
--   1. Workflow reads/writes its data-runtime adapter through Console service
--      tokens. Console requires service-token scopes to be prefixed by the
--      requested audience. Install both supported audience prefixes so
--      deployments using HZY_DATA_RUNTIME_AUDIENCE=data-runtime and deployments
--      using the legacy default tenant-runtime audience are both covered.
--   2. Business applications host the shared Approval Center through
--      Foundation. Their runtime service clients need workflow:proxy so the
--      local app can verify the browser user and call Workflow with a short
--      service token plus the verified actor UID.
--
-- Required semantic scopes:
--   workflow.read
--   workflow.write
--
-- Console service-token scopes:
--   data-runtime:workflow:read
--   data-runtime:workflow:write
--   tenant-runtime:workflow:read
--   tenant-runtime:workflow:write
--
-- Symptom when missing:
--   GET /<app>/api/workflow-proxy/tasks/done returns 403
--   GET /<app>/api/workflow-proxy/tasks/initiated returns 403

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

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
  JSON_OBJECT('source', 'seed:v1.20', 'semanticScope', grants.`semantic_scope`),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:workflow' AS `resource_code`, 'read' AS `action`, 'workflow.read' AS `semantic_scope`
  UNION ALL SELECT 'data-runtime:workflow', 'write', 'workflow.write'
  UNION ALL SELECT 'tenant-runtime:workflow', 'read', 'workflow.read'
  UNION ALL SELECT 'tenant-runtime:workflow', 'write', 'workflow.write'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'workflow' OR sc.`client_code` IN ('workflow', 'workflow.runtime'))
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
  'workflow',
  'proxy',
  JSON_OBJECT('source', 'seed:v1.20', 'purpose', 'foundation-approval-center-proxy'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (
    sc.`app_code` IN ('console', 'codocs', 'aims', 'altoc', 'assets', 'finance', 'people', 'align', 'insights')
    OR sc.`client_code` IN (
      'console', 'console.runtime',
      'codocs', 'codocs.runtime',
      'aims', 'aims.runtime',
      'altoc', 'altoc.runtime',
      'assets', 'assets.runtime',
      'finance', 'finance.runtime',
      'people', 'people.runtime',
      'align', 'align.runtime',
      'insights', 'insights.runtime'
    )
  )
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
