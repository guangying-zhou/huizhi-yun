-- HZY Platform SQL Migration v2.14: application display order.
--
-- Purpose:
--   Let Platform application registry control the order used by runtime
--   applications, policy bundles, Console workspace and Foundation AppRail /
--   AppLauncher.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'platform_applications'
    AND COLUMN_NAME = 'sort_order'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `platform_applications` ADD COLUMN `sort_order` INT NOT NULL DEFAULT 1000 COMMENT ''应用展示顺序；越小越靠前，进入 runtime applications / policy bundle'' AFTER `bundle_enabled`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'platform_applications'
    AND INDEX_NAME = 'idx_platform_applications_sort'
);
SET @sql := IF(
  @index_exists = 0,
  'ALTER TABLE `platform_applications` ADD KEY `idx_platform_applications_sort` (`sort_order`, `app_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `platform_applications` pa
INNER JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY app_code ASC) * 10 AS next_sort_order
  FROM `platform_applications`
) ranked ON ranked.id = pa.id
SET pa.sort_order = ranked.next_sort_order
WHERE pa.sort_order = 1000;
