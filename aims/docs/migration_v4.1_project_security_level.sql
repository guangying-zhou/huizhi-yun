-- ============================================================
-- v4.1 项目安全等级与可见范围
-- 目标：
--   1. 为 aims_projects 增加项目级可见范围。
--   2. 支持公司范围可见、部门范围可见、项目组可见、白名单四种访问控制模型。
--
-- 规则说明：
--   company     企业内登录用户可见。
--   department  项目所属部门用户、项目负责人、项目成员可见。
--   project_team 项目负责人、项目创建人、项目成员可见。
--   whitelist   项目负责人、项目创建人、项目成员、access_whitelist 中用户可见。
--   所有安全等级均不限制项目所在部门经理、分管领导和上级部门领导访问。
-- ============================================================

USE `hzy_aims`;

-- ------------------------------------------------------------
-- 1) 新增 security_level
-- ------------------------------------------------------------
SET @has_security_level := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND COLUMN_NAME = 'security_level'
);

SET @sql := IF(
  @has_security_level = 0,
  'ALTER TABLE `aims_projects`
     ADD COLUMN `security_level` ENUM(''company'',''department'',''project_team'',''whitelist'') NOT NULL DEFAULT ''company''
     COMMENT ''项目可见范围: company=公司范围可见, department=所属部门可见, project_team=项目组可见, whitelist=白名单可见''
     AFTER `leader_uid`',
  'SELECT ''aims_projects.security_level already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 已执行过旧版 v4.1 的环境需要扩展 ENUM。
SET @has_security_level := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND COLUMN_NAME = 'security_level'
);

SET @sql := IF(
  @has_security_level > 0,
  'ALTER TABLE `aims_projects`
     MODIFY COLUMN `security_level` ENUM(''company'',''department'',''project_team'',''whitelist'') NOT NULL DEFAULT ''company''
     COMMENT ''项目可见范围: company=公司范围可见, department=所属部门可见, project_team=项目组可见, whitelist=白名单可见''
     AFTER `leader_uid`',
  'SELECT ''aims_projects.security_level missing, skip enum upgrade'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) 新增 access_whitelist
-- ------------------------------------------------------------
SET @has_access_whitelist := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND COLUMN_NAME = 'access_whitelist'
);

SET @sql := IF(
  @has_access_whitelist = 0,
  'ALTER TABLE `aims_projects`
     ADD COLUMN `access_whitelist` JSON DEFAULT NULL
     COMMENT ''项目访问白名单UID数组，仅 security_level=whitelist 时用于额外授权''
     AFTER `security_level`',
  'SELECT ''aims_projects.access_whitelist already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 3) 新增组合索引（用于部门范围项目过滤）
-- ------------------------------------------------------------
SET @has_idx_security_level_dept := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND INDEX_NAME = 'idx_security_level_dept'
);

SET @sql := IF(
  @has_idx_security_level_dept = 0,
  'ALTER TABLE `aims_projects`
     ADD KEY `idx_security_level_dept` (`security_level`, `dept_code`)',
  'SELECT ''aims_projects.idx_security_level_dept already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
