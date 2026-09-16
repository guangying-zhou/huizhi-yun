-- v5.8: reliable Codocs review-grant activation and idempotent version submission.

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_v58_add_column`$$
CREATE PROCEDURE `aims_v58_add_column`(
  IN target_table VARCHAR(64),
  IN target_column VARCHAR(64),
  IN column_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = target_table
      AND COLUMN_NAME = target_column
  ) THEN
    SET @ddl := CONCAT('ALTER TABLE `', target_table, '` ADD COLUMN ', column_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `aims_v58_add_index`$$
CREATE PROCEDURE `aims_v58_add_index`(
  IN target_table VARCHAR(64),
  IN target_index VARCHAR(64),
  IN index_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = target_table
      AND INDEX_NAME = target_index
  ) THEN
    SET @ddl := CONCAT('ALTER TABLE `', target_table, '` ADD ', index_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL aims_v58_add_column(
  'deliverable_submissions',
  'review_grant_id',
  '`review_grant_id` BIGINT UNSIGNED DEFAULT NULL AFTER `review_route`'
);
CALL aims_v58_add_column(
  'deliverable_submissions',
  'review_granted_at',
  '`review_granted_at` DATETIME(6) DEFAULT NULL AFTER `review_grant_id`'
);
CALL aims_v58_add_index(
  'deliverable_submissions',
  'uk_deliverable_submission_version',
  'UNIQUE KEY `uk_deliverable_submission_version` (`deliverable_id`, `document_version_id`)'
);

DROP PROCEDURE IF EXISTS `aims_v58_add_column`;
DROP PROCEDURE IF EXISTS `aims_v58_add_index`;
