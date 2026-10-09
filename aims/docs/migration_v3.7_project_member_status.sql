-- ============================================================
-- 迁移脚本：项目成员状态字段补齐
--
-- 背景：
--   aims_schema.sql 已声明 aims_project_members.status，但部分开发库
--   仍停留在旧结构，导致依赖成员状态的接口报 Unknown column 'status'。
--
-- 修订（2026-08-31）：
--   原脚本使用 `ADD COLUMN IF NOT EXISTS`，该语法属 MariaDB，MySQL 8
--   会报 1064 语法错误。改为 information_schema + PREPARE 的幂等写法，
--   与 migration_v4.6 / v4.7 保持一致。列已存在时输出提示并跳过。
-- ============================================================

USE `hzy_aims`;

SET @has_project_member_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_project_members'
    AND COLUMN_NAME = 'status'
);

SET @sql := IF(
  @has_project_member_status = 0,
  'ALTER TABLE `aims_project_members`
     ADD COLUMN `status` ENUM(''active'',''suspended'')
       NOT NULL DEFAULT ''active''
       COMMENT ''成员状态: active=正常, suspended=已暂停''
     AFTER `role`',
  'SELECT ''aims_project_members.status already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
