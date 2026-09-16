-- Repeatable migration for Work Calendar reads and writes through Tenant Runtime.

SET @work_calendars_revision_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='work_calendars' AND column_name='revision'
);
SET @work_calendars_revision_ddl := IF(
  @work_calendars_revision_exists=0,
  'ALTER TABLE `work_calendars` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`',
  'SELECT 1'
);
PREPARE work_calendars_revision_statement FROM @work_calendars_revision_ddl;
EXECUTE work_calendars_revision_statement;
DEALLOCATE PREPARE work_calendars_revision_statement;

SET @work_calendar_days_revision_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='work_calendar_days' AND column_name='revision'
);
SET @work_calendar_days_revision_ddl := IF(
  @work_calendar_days_revision_exists=0,
  'ALTER TABLE `work_calendar_days` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `remark`',
  'SELECT 1'
);
PREPARE work_calendar_days_revision_statement FROM @work_calendar_days_revision_ddl;
EXECUTE work_calendar_days_revision_statement;
DEALLOCATE PREPARE work_calendar_days_revision_statement;

SET @work_calendar_months_revision_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='work_calendar_months' AND column_name='revision'
);
SET @work_calendar_months_revision_ddl := IF(
  @work_calendar_months_revision_exists=0,
  'ALTER TABLE `work_calendar_months` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `source`',
  'SELECT 1'
);
PREPARE work_calendar_months_revision_statement FROM @work_calendar_months_revision_ddl;
EXECUTE work_calendar_months_revision_statement;
DEALLOCATE PREPARE work_calendar_months_revision_statement;
