-- Console SQL Seed v1.17: WebDev Issue 上报 service-client grants.
-- Date: 2026-06-13
-- Purpose:
--   业务应用（codocs/finance/workflow/aims/...）通过 Foundation 报告组件提交 Issue 时，
--   经 Console service token（audience=webdev, scope=webdev:issue:write）转发到 WebDev intake。
--   若 service client 缺少对应 grant，Console 拒签 / WebDev 校验失败，表现为
--   POST /<app>/api/webdev-report/issues 返回 403 (insufficient_scope: webdev:issue:write)。
--   本种子为所有 app 类 service client 补 webdev:issue:write / webdev:issue:read grant。
-- Scope 约定：scope 串 = resource_code:action（Console parseScope 以最后一个冒号分段）。
--   webdev:issue:write -> resource_code='webdev:issue', action='write'
--   webdev:issue:read  -> resource_code='webdev:issue', action='read'

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 写权限（提交 Issue）
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
  `id`,
  'webdev:issue',
  'write',
  JSON_OBJECT('source', 'seed:v1.17'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `status` = 'active'
  AND (`client_type` = 'app' OR `app_code` IS NOT NULL)
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

-- 读权限（“我已提报”列表 webdev:issue:read）
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
  `id`,
  'webdev:issue',
  'read',
  JSON_OBJECT('source', 'seed:v1.17'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `status` = 'active'
  AND (`client_type` = 'app' OR `app_code` IS NOT NULL)
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
