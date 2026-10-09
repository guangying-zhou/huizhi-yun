-- ============================================================
-- v4.8 项目密级
-- 目标：
--   1. 为 aims_projects 增加项目级密级。
--   2. 支持 L0-公开、L1-内部、L2-机密、L3-绝密。
--   3. 与 security_level 共同形成项目访问控制策略。
--
-- 策略说明：
--   L0/L1 按所选可见范围生效。
--   L2 最宽只允许部门范围；公司范围应收紧为部门范围。
--   L3 仅允许项目组或白名单访问；部门/管理部门范围放行不生效。
-- ============================================================

USE `hzy_aims`;

-- ------------------------------------------------------------
-- 1) 新增 confidentiality_level
-- ------------------------------------------------------------
SET @has_confidentiality_level := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND COLUMN_NAME = 'confidentiality_level'
);

SET @sql := IF(
  @has_confidentiality_level = 0,
  'ALTER TABLE `aims_projects`
     ADD COLUMN `confidentiality_level` ENUM(''L0'',''L1'',''L2'',''L3'') NOT NULL DEFAULT ''L1''
     COMMENT ''项目密级: L0=公开, L1=内部, L2=机密, L3=绝密''
     AFTER `security_level`',
  'SELECT ''aims_projects.confidentiality_level already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 已存在列的环境统一 ENUM、默认值和列顺序。
SET @has_confidentiality_level := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND COLUMN_NAME = 'confidentiality_level'
);

SET @sql := IF(
  @has_confidentiality_level > 0,
  'UPDATE `aims_projects`
     SET `confidentiality_level` = ''L1''
     WHERE `confidentiality_level` IS NULL',
  'SELECT ''aims_projects.confidentiality_level missing, skip null backfill'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_confidentiality_level > 0,
  'ALTER TABLE `aims_projects`
     MODIFY COLUMN `confidentiality_level` ENUM(''L0'',''L1'',''L2'',''L3'') NOT NULL DEFAULT ''L1''
     COMMENT ''项目密级: L0=公开, L1=内部, L2=机密, L3=绝密''
     AFTER `security_level`',
  'SELECT ''aims_projects.confidentiality_level missing, skip enum upgrade'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) 新增组合索引（用于密级 + 可见范围过滤）
-- ------------------------------------------------------------
SET @has_idx_confidentiality_security_dept := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aims_projects'
    AND INDEX_NAME = 'idx_confidentiality_security_dept'
);

SET @sql := IF(
  @has_idx_confidentiality_security_dept = 0,
  'ALTER TABLE `aims_projects`
     ADD KEY `idx_confidentiality_security_dept` (`confidentiality_level`, `security_level`, `dept_code`)',
  'SELECT ''aims_projects.idx_confidentiality_security_dept already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
