-- 里程碑最终完成 Workflow 闭环。
-- v5.6 已预建 request_no/snapshot/hash/lock/workflow_instance_id 及里程碑锁外键；
-- 本迁移补充动态项目总监职责版本证据。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_require_v5_6_for_v5_9`$$
CREATE PROCEDURE `aims_require_v5_6_for_v5_9`()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'milestones'
      AND COLUMN_NAME = 'completion_lock_request_id'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Aims v5.9 requires completed v5.6 migration; milestones.completion_lock_request_id is missing';
  END IF;
END$$

CALL `aims_require_v5_6_for_v5_9`()$$
DROP PROCEDURE IF EXISTS `aims_require_v5_6_for_v5_9`$$

DELIMITER ;

SET @schema_name = DATABASE();

SET @has_reviewer_role_code = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'approval_records'
    AND COLUMN_NAME = 'reviewer_role_code'
);
SET @ddl = IF(
  @has_reviewer_role_code = 0,
  'ALTER TABLE approval_records ADD COLUMN reviewer_role_code VARCHAR(64) DEFAULT NULL AFTER reviewer_uid',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_reviewer_role_revision = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'approval_records'
    AND COLUMN_NAME = 'reviewer_role_revision'
);
SET @ddl = IF(
  @has_reviewer_role_revision = 0,
  'ALTER TABLE approval_records ADD COLUMN reviewer_role_revision BIGINT UNSIGNED DEFAULT NULL AFTER reviewer_role_code',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_reviewer_role_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'approval_records'
    AND INDEX_NAME = 'idx_approval_reviewer_role'
);
SET @ddl = IF(
  @has_reviewer_role_index = 0,
  'ALTER TABLE approval_records ADD KEY idx_approval_reviewer_role (reviewer_role_code, status, reviewer_role_revision)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
