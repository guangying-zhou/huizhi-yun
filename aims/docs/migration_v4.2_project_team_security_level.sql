-- ============================================================
-- v4.2 项目安全等级增加“项目组可见”
-- 目标：
--   1. 将 aims_projects.security_level 扩展为四级可见范围。
--   2. 支持 project_team=项目组可见。
--
-- 规则说明：
--   company      企业内登录用户可见。
--   department   项目所属部门用户、项目负责人、项目成员可见。
--   project_team 项目负责人、项目创建人、项目成员可见。
--   whitelist    项目负责人、项目创建人、项目成员、access_whitelist 中用户可见。
--   所有安全等级均不限制项目所在部门经理、分管领导和上级部门领导访问。
-- ============================================================

USE `hzy_aims`;

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
  'SELECT ''aims_projects.security_level missing, skip project_team enum upgrade'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
