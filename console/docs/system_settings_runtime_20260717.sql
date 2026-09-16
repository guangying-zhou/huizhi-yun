-- Repeatable migration for System Settings writes through Tenant Runtime.

SET @setting_values_revision_exists := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'setting_values'
     AND column_name = 'revision'
);
SET @setting_values_revision_ddl := IF(
  @setting_values_revision_exists = 0,
  'ALTER TABLE `setting_values` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `updated_by`',
  'SELECT 1'
);
PREPARE setting_values_revision_statement FROM @setting_values_revision_ddl;
EXECUTE setting_values_revision_statement;
DEALLOCATE PREPARE setting_values_revision_statement;
