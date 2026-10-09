-- People rank dictionary series (2026-08-29). Safe to run repeatedly.
-- Adds the professional/management type to existing people_ranks rows.
SET NAMES utf8mb4;
USE `hzy_people`;

SET @rank_series_missing := (
  SELECT COUNT(*) = 0
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_ranks'
    AND COLUMN_NAME = 'rank_series'
);

SET @ddl := IF(
  @rank_series_missing,
  'ALTER TABLE `people_ranks` ADD COLUMN `rank_series` ENUM(''M'', ''P'') NULL DEFAULT NULL COMMENT ''职级类型：M 管理，P 专业'' AFTER `rank_name`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Invalid legacy dictionary values are listed before CHECK constraints are
-- installed. Constraint creation intentionally fails until they are repaired.
SELECT `rank_code`, `rank_level`, `sort_order`, `enabled`
FROM `people_ranks`
WHERE `rank_level` < 0 OR `sort_order` < 0 OR `enabled` NOT IN (0, 1)
ORDER BY `rank_code`;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_ranks` ADD CONSTRAINT `ck_people_rank_numeric` CHECK (`rank_level` >= 0 AND `sort_order` >= 0)',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_ranks'
    AND CONSTRAINT_NAME = 'ck_people_rank_numeric'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_ranks` ADD CONSTRAINT `ck_people_rank_enabled` CHECK (`enabled` IN (0, 1))',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_ranks'
    AND CONSTRAINT_NAME = 'ck_people_rank_enabled'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `people_ranks`
SET `rank_series` = 'M'
WHERE `rank_series` IS NULL
  AND (
    UPPER(`rank_code`) REGEXP '(^|[-_])M[0-9]+$'
    OR `rank_name` LIKE '管理%'
  );

UPDATE `people_ranks`
SET `rank_series` = 'P'
WHERE `rank_series` IS NULL
  AND (
    UPPER(`rank_code`) REGEXP '(^|[-_])P[0-9]+$'
    OR `rank_name` LIKE '专业%'
  );

-- Review and map any rows returned here, then rerun this migration. The
-- following NOT NULL conversion intentionally fails while unresolved rows
-- remain so a custom management rank is never silently classified as P.
SELECT `rank_code`, `rank_name`
FROM `people_ranks`
WHERE `rank_series` IS NULL
ORDER BY `rank_code`;

-- Abort deterministically if the preceding result contains any row. This
-- duplicate-key guard does not depend on the tenant session's sql_mode.
DROP TEMPORARY TABLE IF EXISTS `_people_rank_series_unresolved_guard`;
CREATE TEMPORARY TABLE `_people_rank_series_unresolved_guard` (
  `guard_id` TINYINT NOT NULL,
  PRIMARY KEY (`guard_id`)
);
INSERT INTO `_people_rank_series_unresolved_guard` (`guard_id`) VALUES (1);
INSERT INTO `_people_rank_series_unresolved_guard` (`guard_id`)
SELECT 1
FROM `people_ranks`
WHERE `rank_series` IS NULL
LIMIT 1;
DROP TEMPORARY TABLE `_people_rank_series_unresolved_guard`;

-- MySQL requires strict mode for a nullable-to-NOT-NULL InnoDB conversion.
-- Run migrations on a dedicated connection: a failed DDL batch must discard
-- that connection. Successful runs restore the caller's previous mode below.
SET @rank_series_previous_sql_mode := @@SESSION.sql_mode;
SET @rank_series_strict_sql_mode := IF(
  FIND_IN_SET('STRICT_TRANS_TABLES', @rank_series_previous_sql_mode) > 0
    OR FIND_IN_SET('STRICT_ALL_TABLES', @rank_series_previous_sql_mode) > 0,
  @rank_series_previous_sql_mode,
  IF(
    @rank_series_previous_sql_mode = '',
    'STRICT_TRANS_TABLES',
    CONCAT(@rank_series_previous_sql_mode, ',STRICT_TRANS_TABLES')
  )
);
SET SESSION sql_mode = @rank_series_strict_sql_mode;

SET @ddl := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `people_ranks` MODIFY COLUMN `rank_series` ENUM(''M'', ''P'') NOT NULL DEFAULT ''P'' COMMENT ''职级类型：M 管理，P 专业''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_ranks'
    AND COLUMN_NAME = 'rank_series'
    AND (IS_NULLABLE = 'YES' OR COLUMN_DEFAULT IS NULL)
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET SESSION sql_mode = @rank_series_previous_sql_mode;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `people_ranks` ADD KEY `idx_people_rank_series_level` (`rank_series`, `rank_level`, `enabled`, `sort_order`)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_ranks'
    AND INDEX_NAME = 'idx_people_rank_series_level'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
