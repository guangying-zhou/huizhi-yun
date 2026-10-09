-- G4-2: pending actionable target identity must be explicit.
-- Repeatable on MySQL 8. Historical pending rows without a target fail closed;
-- terminal rows use a non-routable sentinel only to satisfy storage integrity.
SET @hzy_console_schema = DATABASE();

UPDATE `portal_actionable_projections`
SET `state` = 'cancelled',
    `closed_at` = COALESCE(`closed_at`, UTC_TIMESTAMP()),
    `updated_at` = UTC_TIMESTAMP()
WHERE `target_app_code` IS NULL
  AND `state` = 'pending';

UPDATE `portal_actionable_projections`
SET `target_app_code` = 'unavailable',
    `updated_at` = UTC_TIMESTAMP()
WHERE `target_app_code` IS NULL
  AND `state` IN ('resolved', 'cancelled');

SET @hzy_target_nullable = (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @hzy_console_schema
    AND TABLE_NAME = 'portal_actionable_projections'
    AND COLUMN_NAME = 'target_app_code'
);
SET @hzy_sql = IF(
  @hzy_target_nullable = 'YES',
  'ALTER TABLE `portal_actionable_projections` MODIFY COLUMN `target_app_code` VARCHAR(64) NOT NULL',
  'SELECT 1'
);
PREPARE hzy_stmt FROM @hzy_sql;
EXECUTE hzy_stmt;
DEALLOCATE PREPARE hzy_stmt;
