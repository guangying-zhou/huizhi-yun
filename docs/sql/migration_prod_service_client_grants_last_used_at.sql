-- 生产迁移：service_client_grants 增加 last_used_at
-- Date: 2026-08-24
--
-- 目的：为跨应用授权清理提供**唯一可靠的判据**。
--
-- 背景：grant 的授予来源分散在三处且互不同步 ——
--   1. docs/Console-SQL-Seed-*.sql（86 个文件，大量使用 CROSS JOIN + SUBSTRING_INDEX 动态计算列）
--   2. Go 自动 provision（auth_service_tokens.go 的 consoleRuntimeServiceScopes）
--   3. env 变量 HZY_SERVICE_CLIENT_<APP>_GRANTS
-- 而代码侧的 scope 有大量是动态拼接的（如 altoc 的 `altoc:${resource}:${action}`
-- 来自权限规则表，finance 的 `finance:*.read` 来自路由映射），
-- **无法靠静态分析判断某条 grant 是否仍在使用**。
-- 2026-08-23 的三次静态审计分别误报 73 / 29 / 215 条，证明此路不通。
--
-- 有了使用记录后，观察 2–4 周（需覆盖月度任务）再按 last_used_at IS NULL 判定孤儿。
--
-- 纯新增可空列，不改动任何现有数据，无锁风险（MySQL 8 INSTANT DDL）。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hzy_console`.`service_client_grants`
  ADD COLUMN `last_used_at` DATETIME NULL DEFAULT NULL
    COMMENT '该 grant 最近一次实际用于签发 service token 的时间；NULL 表示自打点上线以来从未使用'
    AFTER `status`,
  ADD INDEX `idx_scg_last_used` (`status`, `last_used_at`);

-- 核验：应返回 last_used_at 列，IS_NULLABLE=YES
-- SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA='hzy_console' AND TABLE_NAME='service_client_grants'
--   AND COLUMN_NAME='last_used_at';
--
-- 观察 2–4 周后，孤儿候选：
-- SELECT c.app_code, c.client_code,
--        CONCAT(g.resource_code,':',g.action) AS scope,
--        JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source')) AS source,
--        g.updated_at
-- FROM service_client_grants g
-- JOIN service_clients c ON c.id = g.service_client_id
-- WHERE g.status='active' AND g.last_used_at IS NULL
-- ORDER BY c.app_code, scope;
