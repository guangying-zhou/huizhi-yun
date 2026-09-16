-- Codocs v1.2: add open department folder visibility.
-- Department managers can mark department document folders as open to all logged-in users.

SET @schema_name := DATABASE();

SELECT COUNT(*) INTO @has_folder_is_open
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema_name
  AND TABLE_NAME = 'folders'
  AND COLUMN_NAME = 'is_open';

SET @ddl := IF(
  @has_folder_is_open = 0,
  'ALTER TABLE `folders`
     ADD COLUMN `is_open` TINYINT NOT NULL DEFAULT 0 COMMENT ''是否开放目录: 0-部门内可见 1-登录用户可见'' AFTER `sort_order`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_folder_open_index
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema_name
  AND TABLE_NAME = 'folders'
  AND INDEX_NAME = 'idx_folders_department_open';

SET @ddl := IF(
  @has_folder_open_index = 0,
  'ALTER TABLE `folders` ADD INDEX `idx_folders_department_open` (`folder_type`, `is_open`, `dept_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
