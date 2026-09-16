-- ============================================================
-- v4.0 项目文档访问控制镜像字段
-- 目标：
--   1. 为 project_documents 增加访问控制展示镜像字段。
--   2. 支持项目文档列表按生命周期/密级进行筛选与展示。
--
-- 字段说明（最终鉴权以 Codocs 策略为准）：
--   access_lifecycle_stage        访问生命周期（draft/formal/archived）
--   access_confidentiality_level  访问密级（L0/L1/L2/L3）
--   access_summary                展示摘要（如：仅项目成员 / 已授权 2 项）
-- ============================================================

USE `hzy_aims`;

-- ------------------------------------------------------------
-- 1) 新增 access_lifecycle_stage
-- ------------------------------------------------------------
SET @has_access_lifecycle_stage := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_documents'
    AND COLUMN_NAME = 'access_lifecycle_stage'
);

SET @sql := IF(
  @has_access_lifecycle_stage = 0,
  'ALTER TABLE `project_documents`
     ADD COLUMN `access_lifecycle_stage` ENUM(''draft'',''formal'',''archived'') DEFAULT NULL
     COMMENT ''访问控制镜像：生命周期阶段（最终以 Codocs 策略为准）''
     AFTER `import_status`',
  'SELECT ''project_documents.access_lifecycle_stage already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) 新增 access_confidentiality_level
-- ------------------------------------------------------------
SET @has_access_confidentiality_level := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_documents'
    AND COLUMN_NAME = 'access_confidentiality_level'
);

SET @sql := IF(
  @has_access_confidentiality_level = 0,
  'ALTER TABLE `project_documents`
     ADD COLUMN `access_confidentiality_level` ENUM(''L0'',''L1'',''L2'',''L3'') DEFAULT NULL
     COMMENT ''访问控制镜像：密级（最终以 Codocs 策略为准）''
     AFTER `access_lifecycle_stage`',
  'SELECT ''project_documents.access_confidentiality_level already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 3) 新增 access_summary
-- ------------------------------------------------------------
SET @has_access_summary := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_documents'
    AND COLUMN_NAME = 'access_summary'
);

SET @sql := IF(
  @has_access_summary = 0,
  'ALTER TABLE `project_documents`
     ADD COLUMN `access_summary` VARCHAR(255) DEFAULT NULL
     COMMENT ''访问控制镜像：访问摘要（展示用）''
     AFTER `access_confidentiality_level`',
  'SELECT ''project_documents.access_summary already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 4) 新增组合索引（用于列表筛选）
-- ------------------------------------------------------------
SET @has_idx_access_stage_level := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_documents'
    AND INDEX_NAME = 'idx_access_stage_level'
);

SET @sql := IF(
  @has_idx_access_stage_level = 0,
  'ALTER TABLE `project_documents`
     ADD KEY `idx_access_stage_level` (`access_lifecycle_stage`, `access_confidentiality_level`)',
  'SELECT ''project_documents.idx_access_stage_level already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
