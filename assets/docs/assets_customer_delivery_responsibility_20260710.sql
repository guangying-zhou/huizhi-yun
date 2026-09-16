-- Assets B2: explicit responsibility and reliable customer-delivery due streams.
-- Run in hzy_assets (or the target Assets tenant database) before enabling B2 notifications.
-- This migration is repeatable and intentionally does not infer responsibility from Altoc contracts.

SET @hzy_assets_schema = DATABASE();

SET @hzy_has_delivery_responsible_uid = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @hzy_assets_schema
    AND TABLE_NAME = 'customer_delivery_assets'
    AND COLUMN_NAME = 'responsible_uid'
);
SET @hzy_sql = IF(
  @hzy_has_delivery_responsible_uid = 0,
  'ALTER TABLE `customer_delivery_assets` ADD COLUMN `responsible_uid` VARCHAR(64) DEFAULT NULL COMMENT ''Assets 内维护的交付资产运营责任人；不得由跨模块合同负责人隐式推导'' AFTER `support_expiry_at`',
  'SELECT 1'
);
PREPARE hzy_stmt FROM @hzy_sql;
EXECUTE hzy_stmt;
DEALLOCATE PREPARE hzy_stmt;

SET @hzy_has_delivery_responsible_dept = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @hzy_assets_schema
    AND TABLE_NAME = 'customer_delivery_assets'
    AND COLUMN_NAME = 'responsible_dept_code'
);
SET @hzy_sql = IF(
  @hzy_has_delivery_responsible_dept = 0,
  'ALTER TABLE `customer_delivery_assets` ADD COLUMN `responsible_dept_code` VARCHAR(64) DEFAULT NULL COMMENT ''运营责任部门；仅用于用户目标页数据范围，不作为通知广播对象'' AFTER `responsible_uid`',
  'SELECT 1'
);
PREPARE hzy_stmt FROM @hzy_sql;
EXECUTE hzy_stmt;
DEALLOCATE PREPARE hzy_stmt;

SET @hzy_has_delivery_responsibility_check = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @hzy_assets_schema
    AND TABLE_NAME = 'customer_delivery_assets'
    AND CONSTRAINT_NAME = 'chk_customer_delivery_asset_responsibility_pair'
);
SET @hzy_sql = IF(
  @hzy_has_delivery_responsibility_check = 0,
  'ALTER TABLE `customer_delivery_assets` ADD CONSTRAINT `chk_customer_delivery_asset_responsibility_pair` CHECK ((`responsible_uid` IS NULL AND `responsible_dept_code` IS NULL) OR (`responsible_uid` IS NOT NULL AND TRIM(`responsible_uid`) <> '''' AND LOWER(TRIM(`responsible_uid`)) <> ''@all'' AND `responsible_uid` = TRIM(`responsible_uid`) AND `responsible_dept_code` IS NOT NULL AND TRIM(`responsible_dept_code`) <> '''' AND `responsible_dept_code` = TRIM(`responsible_dept_code`)))',
  'SELECT 1'
);
PREPARE hzy_stmt FROM @hzy_sql;
EXECUTE hzy_stmt;
DEALLOCATE PREPARE hzy_stmt;

SET @hzy_has_delivery_responsibility_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @hzy_assets_schema
    AND TABLE_NAME = 'customer_delivery_assets'
    AND INDEX_NAME = 'idx_customer_delivery_asset_responsibility'
);
SET @hzy_sql = IF(
  @hzy_has_delivery_responsibility_index = 0,
  'ALTER TABLE `customer_delivery_assets` ADD KEY `idx_customer_delivery_asset_responsibility` (`responsible_uid`, `responsible_dept_code`, `status`)',
  'SELECT 1'
);
PREPARE hzy_stmt FROM @hzy_sql;
EXECUTE hzy_stmt;
DEALLOCATE PREPARE hzy_stmt;

ALTER TABLE `assets_notification_checkpoint`
  MODIFY COLUMN `event_stream` ENUM(
    'resource_expiry',
    'ip_expiry',
    'delivery_expiry',
    'delivery_warranty',
    'delivery_support'
  ) NOT NULL,
  MODIFY COLUMN `source_type` ENUM(
    'asset_item',
    'ip_asset',
    'customer_delivery_asset'
  ) NOT NULL;

SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @hzy_assets_schema AND TABLE_NAME = 'customer_delivery_assets'
     AND COLUMN_NAME IN ('responsible_uid', 'responsible_dept_code')) AS responsibility_column_count,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @hzy_assets_schema AND TABLE_NAME = 'customer_delivery_assets'
     AND INDEX_NAME = 'idx_customer_delivery_asset_responsibility') AS responsibility_index_count,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @hzy_assets_schema AND TABLE_NAME = 'customer_delivery_assets'
     AND CONSTRAINT_NAME = 'chk_customer_delivery_asset_responsibility_pair') AS responsibility_check_count;
