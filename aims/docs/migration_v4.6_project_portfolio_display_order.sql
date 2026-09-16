-- ============================================================
-- v4.6 项目集显示顺序
-- 目标：
--   1. 为 project_portfolios 增加 display_order 字段。
--   2. 支持项目菜单与项目总览按显示顺序由小到大展示项目集。
-- ============================================================

USE `hzy_aims`;

-- ------------------------------------------------------------
-- 1) 新增 display_order
-- ------------------------------------------------------------
SET @has_project_portfolio_display_order := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_portfolios'
    AND COLUMN_NAME = 'display_order'
);

SET @sql := IF(
  @has_project_portfolio_display_order = 0,
  'ALTER TABLE `project_portfolios`
     ADD COLUMN `display_order` INT NOT NULL DEFAULT 0
     COMMENT ''显示顺序(由小到大排序)''
     AFTER `is_product_line`',
  'SELECT ''project_portfolios.display_order already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) 新增排序索引
-- ------------------------------------------------------------
SET @has_idx_project_portfolio_display_order := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_portfolios'
    AND INDEX_NAME = 'idx_display_order'
);

SET @sql := IF(
  @has_idx_project_portfolio_display_order = 0,
  'ALTER TABLE `project_portfolios`
     ADD KEY `idx_display_order` (`display_order`, `id`)',
  'SELECT ''project_portfolios.idx_display_order already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
