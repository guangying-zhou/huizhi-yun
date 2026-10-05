-- Console SQL Migration v1.14: register the Workflow runtime URL system setting.
-- Date: 2026-05-18 (revised 2026-06-15)
-- Purpose:
--   Ensure the `workflow.apiUrl` setting-catalog entry exists so business
--   applications can resolve the Workflow service base URL from Console.
--
-- NOTE (revised 2026-06-15):
--   This migration previously ALSO wrote a tenant-scoped setting_value of
--   'http://localhost:3020'. That hard-coded development address overwrote each
--   deployment's real Workflow URL on every re-run, which made the Approval
--   Center 403 in production (workflow-proxy requests were sent to
--   localhost:3020 instead of the real Workflow host).
--
--   The setting_value write has been REMOVED. The actual URL is
--   environment-specific and must be configured per deployment via the Console
--   system-settings page (or a deployment-specific SQL), for example:
--     https://workflow.huizhi.yun/workflow
--
--   The catalog default below (localhost:3020) only applies to local dev when
--   no tenant value is set; it never overrides a value configured in Console.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `setting_catalogs` (
  `setting_key`,
  `setting_name`,
  `value_type`,
  `scope_type`,
  `category`,
  `default_value_json`,
  `validator_json`,
  `is_required`,
  `editable_in_ui`,
  `description`,
  `status`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'workflow.apiUrl',
    'Workflow API 地址',
    'url',
    'tenant',
    'runtime',
    JSON_QUOTE('http://localhost:3020'),
    JSON_OBJECT('pattern', '^https?://.+'),
    1,
    1,
    '审批流服务基础地址，不包含 /api/v1；生产值请在 Console 系统设置中按部署配置（如 https://workflow.huizhi.yun/workflow）',
    'active',
    UTC_TIMESTAMP(),
    UTC_TIMESTAMP()
  )
ON DUPLICATE KEY UPDATE
  `default_value_json` = VALUES(`default_value_json`),
  `validator_json` = VALUES(`validator_json`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();

-- NOTE: Intentionally no INSERT INTO `setting_values` here. The Workflow URL is
-- environment-specific and is configured per deployment via Console system
-- settings, so this migration must not overwrite it.
