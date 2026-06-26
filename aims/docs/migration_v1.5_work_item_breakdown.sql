START TRANSACTION;

SET @has_start_date := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'work_items'
    AND COLUMN_NAME = 'start_date'
);

SET @ddl := IF(
  @has_start_date = 0,
  'ALTER TABLE `work_items` ADD COLUMN `start_date` DATE DEFAULT NULL COMMENT ''计划开始日期'' AFTER `description`',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;
