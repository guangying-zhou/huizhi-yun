-- Finance migration: P2 legacy OA migration runner support
-- Date: 2026-05-18
--
-- Purpose:
--   1. Allow one source record to be mapped to multiple target tables/databases.
--   2. Keep the migration runner idempotent when the same wb_project row creates
--      both a Finance accounting object and an Aims project.

DELIMITER $$

DROP PROCEDURE IF EXISTS finance_replace_migration_map_unique_key $$
CREATE PROCEDURE finance_replace_migration_map_unique_key()
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'finance_migration_map'
          AND INDEX_NAME = 'uk_finance_migration_source'
    ) THEN
        ALTER TABLE finance_migration_map DROP INDEX uk_finance_migration_source;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'finance_migration_map'
          AND INDEX_NAME = 'uk_finance_migration_source_target'
    ) THEN
        ALTER TABLE finance_migration_map
            ADD UNIQUE KEY uk_finance_migration_source_target (source_system, source_table, source_id, target_table);
    END IF;
END $$

DELIMITER ;

CALL finance_replace_migration_map_unique_key();

DROP PROCEDURE IF EXISTS finance_replace_migration_map_unique_key;
