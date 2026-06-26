-- Assets 采购目的与资产归因迁移
-- 执行前请确认当前数据库为 hzy_assets

SET NAMES utf8mb4;

SET @asset_purpose_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_items'
    AND COLUMN_NAME = 'asset_purpose'
);

SET @asset_purpose_sql = IF(
  @asset_purpose_exists = 0,
  'ALTER TABLE `asset_items` ADD COLUMN `asset_purpose` VARCHAR(64) NOT NULL DEFAULT ''self_use'' COMMENT ''资产归因目的：self_use/project_procurement/sales_stock'' AFTER `asset_subtype`',
  'SELECT ''asset_items.asset_purpose already exists'''
);

PREPARE stmt_asset_purpose FROM @asset_purpose_sql;
EXECUTE stmt_asset_purpose;
DEALLOCATE PREPARE stmt_asset_purpose;

UPDATE `asset_items`
SET `asset_purpose` = CASE
  WHEN `project_code` IS NOT NULL AND TRIM(`project_code`) <> '' THEN 'project_procurement'
  WHEN `status` IN ('in_stock', 'pending_stock_in') AND `customer_code` IS NULL AND `contract_code` IS NULL THEN 'sales_stock'
  ELSE 'self_use'
END
WHERE `asset_purpose` IS NULL OR TRIM(`asset_purpose`) = '' OR `asset_purpose` = 'self_use';

ALTER TABLE `purchase_orders`
  MODIFY COLUMN `purpose_type` VARCHAR(64) NOT NULL DEFAULT 'self_use' COMMENT '采购目的：self_use/project_procurement/sales_stock';

UPDATE `purchase_orders`
SET `purpose_type` = CASE
  WHEN `purpose_type` = 'customer_delivery' THEN 'project_procurement'
  WHEN `purpose_type` = 'internal' AND `project_code` IS NOT NULL AND TRIM(`project_code`) <> '' THEN 'project_procurement'
  WHEN `purpose_type` = 'internal' THEN 'self_use'
  ELSE `purpose_type`
END;

DELETE FROM `system_parameters`
WHERE `param_key` IN (
  'dictionary.asset_purpose',
  'dictionary.purchase_purpose_type',
  'dictionary.assignment_action_type',
  'dictionary.assignment_target_type',
  'dictionary.assignment_status'
);
