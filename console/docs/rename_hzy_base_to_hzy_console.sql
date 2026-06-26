-- Rename Console database from hzy_base to hzy_console.
--
-- MySQL does not support RENAME DATABASE. This migration creates the target
-- database, then moves all base tables with a single RENAME TABLE statement.
--
-- Run before switching DB_NAME from hzy_base to hzy_console in production.
-- Recommended preflight:
--   1. Stop the console app and any jobs that write to hzy_base.
--   2. Take a backup:
--        mysqldump --single-transaction --routines --triggers hzy_base > hzy_base_backup.sql
--   3. Run this script as a user with CREATE/ALTER/DROP privileges.
--   4. Verify row counts in hzy_console.
--   5. Drop hzy_base manually only after verification.

CREATE DATABASE IF NOT EXISTS `hzy_console`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `hzy_console`;

DELIMITER $$

DROP PROCEDURE IF EXISTS `migrate_hzy_base_to_hzy_console`$$

CREATE PROCEDURE `migrate_hzy_base_to_hzy_console`()
BEGIN
  DECLARE source_schema_count INT DEFAULT 0;
  DECLARE target_object_count INT DEFAULT 0;
  DECLARE source_table_count INT DEFAULT 0;
  DECLARE rename_targets LONGTEXT DEFAULT NULL;

  SELECT COUNT(*)
    INTO source_schema_count
    FROM information_schema.SCHEMATA
   WHERE SCHEMA_NAME = 'hzy_base';

  IF source_schema_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Source database hzy_base does not exist.';
  END IF;

  SELECT COUNT(*)
    INTO target_object_count
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = 'hzy_console';

  IF target_object_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Target database hzy_console is not empty. Abort to avoid mixing data.';
  END IF;

  SET SESSION group_concat_max_len = 1048576;

  SELECT COUNT(*),
         GROUP_CONCAT(
           CONCAT(
             '`hzy_base`.`', REPLACE(TABLE_NAME, '`', '``'), '`',
             ' TO ',
             '`hzy_console`.`', REPLACE(TABLE_NAME, '`', '``'), '`'
           )
           ORDER BY TABLE_NAME
           SEPARATOR ', '
         )
    INTO source_table_count, rename_targets
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = 'hzy_base'
     AND TABLE_TYPE = 'BASE TABLE';

  IF source_table_count = 0 OR rename_targets IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Source database hzy_base has no base tables to migrate.';
  END IF;

  SET @rename_sql = CONCAT('RENAME TABLE ', rename_targets);
  PREPARE rename_stmt FROM @rename_sql;
  EXECUTE rename_stmt;
  DEALLOCATE PREPARE rename_stmt;

  SELECT source_table_count AS migrated_table_count,
         'hzy_base' AS source_database,
         'hzy_console' AS target_database;
END$$

CALL `migrate_hzy_base_to_hzy_console`()$$

DROP PROCEDURE IF EXISTS `migrate_hzy_base_to_hzy_console`$$

DELIMITER ;

-- Keep the old schema until verification is complete.
-- After checking row counts and app startup, you can drop it manually:
--   DROP DATABASE `hzy_base`;
