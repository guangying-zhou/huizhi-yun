-- Codocs v1.1: add project ownership to cabinet files.
-- Required by Aims project file cabinet uploads/downloads.

SET @schema_name := DATABASE();

SELECT COUNT(*) INTO @has_project_code
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema_name
  AND TABLE_NAME = 'cabinet_files'
  AND COLUMN_NAME = 'project_code';

SET @ddl := IF(
  @has_project_code = 0,
  'ALTER TABLE `cabinet_files`
     ADD COLUMN `project_code` VARCHAR(100) NULL COMMENT ''所属项目编码(NULL表示非项目文件柜)'' AFTER `dept_code`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_project_index
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema_name
  AND TABLE_NAME = 'cabinet_files'
  AND INDEX_NAME = 'idx_cabinet_project';

SET @ddl := IF(
  @has_project_index = 0,
  'ALTER TABLE `cabinet_files` ADD INDEX `idx_cabinet_project` (`project_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
