-- Aims v5.7 - repair service-ticket delivery generation columns.
-- Safe to run repeatedly after migration_v4.9_work_item_service_ext.sql.

SET @aims_add_delivery_generation = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_item_service_ext'
      AND COLUMN_NAME = 'delivery_generation'
  ),
  'SELECT 1',
  'ALTER TABLE `work_item_service_ext` ADD COLUMN `delivery_generation` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `last_synced_at`'
);
PREPARE aims_add_delivery_generation_stmt FROM @aims_add_delivery_generation;
EXECUTE aims_add_delivery_generation_stmt;
DEALLOCATE PREPARE aims_add_delivery_generation_stmt;

SET @aims_add_last_delivery_status = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'work_item_service_ext'
      AND COLUMN_NAME = 'last_delivery_status'
  ),
  'SELECT 1',
  'ALTER TABLE `work_item_service_ext` ADD COLUMN `last_delivery_status` VARCHAR(30) DEFAULT NULL AFTER `delivery_generation`'
);
PREPARE aims_add_last_delivery_status_stmt FROM @aims_add_last_delivery_status;
EXECUTE aims_add_last_delivery_status_stmt;
DEALLOCATE PREPARE aims_add_last_delivery_status_stmt;
