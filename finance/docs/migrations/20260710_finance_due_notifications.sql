-- Finance G4-2: explicit issuance/reconciliation responsibility and reliable due notification checkpoints.
-- Repeatable migration. It does not backfill responsibility, dispatch notifications, or change existing business rows.

USE hzy_finance;

DROP PROCEDURE IF EXISTS hzy_finance_due_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_finance_due_add_index_if_missing;
DROP PROCEDURE IF EXISTS hzy_finance_due_add_constraint_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_finance_due_add_column_if_missing(
  IN p_table_name VARCHAR(64), IN p_column_name VARCHAR(64), IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = p_table_name AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_finance_due_add_index_if_missing(
  IN p_table_name VARCHAR(64), IN p_index_name VARCHAR(64), IN p_index_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = p_table_name AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_def);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_finance_due_add_constraint_if_missing(
  IN p_table_name VARCHAR(64), IN p_constraint_name VARCHAR(64), IN p_constraint_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name = p_table_name AND constraint_name = p_constraint_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `', p_constraint_name, '` ', p_constraint_def);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_finance_due_add_column_if_missing('invoice_request', 'issuance_responsible_uid',
  'issuance_responsible_uid VARCHAR(50) DEFAULT NULL COMMENT ''已批开票唯一直接责任人UID'' AFTER issued_invoice_id');
CALL hzy_finance_due_add_column_if_missing('invoice_request', 'issuance_due_at',
  'issuance_due_at DATETIME DEFAULT NULL COMMENT ''已批开票办理时限'' AFTER issuance_responsible_uid');
CALL hzy_finance_due_add_index_if_missing('invoice_request', 'idx_invoice_request_issuance_due',
  'INDEX idx_invoice_request_issuance_due (status, issuance_due_at, id)');
CALL hzy_finance_due_add_index_if_missing('invoice_request', 'idx_invoice_request_issuance_responsible',
  'INDEX idx_invoice_request_issuance_responsible (issuance_responsible_uid, status, issuance_due_at)');
CALL hzy_finance_due_add_constraint_if_missing('invoice_request', 'ck_invoice_request_issuance_responsibility',
  'CHECK ((issuance_responsible_uid IS NULL AND issuance_due_at IS NULL) OR (issuance_responsible_uid IS NOT NULL AND issuance_due_at IS NOT NULL AND issuance_responsible_uid = TRIM(issuance_responsible_uid) AND issuance_responsible_uid <> '''' AND LOWER(issuance_responsible_uid) <> ''@all'' AND issuance_responsible_uid NOT REGEXP ''[[:cntrl:]]''))');

CALL hzy_finance_due_add_column_if_missing('finance_receipt', 'reconciliation_responsible_uid',
  'reconciliation_responsible_uid VARCHAR(50) DEFAULT NULL COMMENT ''未核销事项唯一直接责任人UID'' AFTER handler_user_id');
CALL hzy_finance_due_add_column_if_missing('finance_receipt', 'reconciliation_due_at',
  'reconciliation_due_at DATETIME DEFAULT NULL COMMENT ''到账核销办理时限'' AFTER reconciliation_responsible_uid');
CALL hzy_finance_due_add_index_if_missing('finance_receipt', 'idx_finance_receipt_reconciliation_due',
  'INDEX idx_finance_receipt_reconciliation_due (status, reconciliation_due_at, id)');
CALL hzy_finance_due_add_index_if_missing('finance_receipt', 'idx_finance_receipt_reconciliation_responsible',
  'INDEX idx_finance_receipt_reconciliation_responsible (reconciliation_responsible_uid, status, reconciliation_due_at)');
CALL hzy_finance_due_add_constraint_if_missing('finance_receipt', 'ck_finance_receipt_reconciliation_responsibility',
  'CHECK ((reconciliation_responsible_uid IS NULL AND reconciliation_due_at IS NULL) OR (reconciliation_responsible_uid IS NOT NULL AND reconciliation_due_at IS NOT NULL AND reconciliation_responsible_uid = TRIM(reconciliation_responsible_uid) AND reconciliation_responsible_uid <> '''' AND LOWER(reconciliation_responsible_uid) <> ''@all'' AND reconciliation_responsible_uid NOT REGEXP ''[[:cntrl:]]''))');

CREATE TABLE IF NOT EXISTS finance_notification_checkpoint (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_stream ENUM('invoice_issuance_due', 'receipt_reconciliation_due') NOT NULL,
  source_type ENUM('invoice_request', 'finance_receipt') NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  condition_generation BIGINT UNSIGNED NOT NULL,
  phase ENUM('D30', 'D7', 'D1', 'expired') NOT NULL,
  source_version CHAR(64) NOT NULL,
  event_version VARCHAR(191) NOT NULL,
  previous_event_version VARCHAR(191) DEFAULT NULL,
  previous_recipient_uid VARCHAR(50) DEFAULT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  actionable_key VARCHAR(191) NOT NULL,
  due_at DATETIME NOT NULL,
  source_code VARCHAR(50) NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  recipient_candidates_json JSON NOT NULL,
  state ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  close_reason ENUM('superseded', 'condition_resolved', 'condition_cancelled') DEFAULT NULL,
  closed_at DATETIME DEFAULT NULL,
  notification_id VARCHAR(191) DEFAULT NULL,
  notified_recipient_uid VARCHAR(50) DEFAULT NULL,
  acknowledged_at DATETIME DEFAULT NULL,
  lifecycle_next_version VARCHAR(191) DEFAULT NULL,
  lifecycle_closed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_finance_notification_event (event_version),
  UNIQUE KEY uk_finance_notification_idempotency (idempotency_key),
  UNIQUE KEY uk_finance_notification_phase (event_stream, source_type, source_id, condition_generation, phase),
  KEY idx_finance_notification_source (event_stream, source_type, source_id, state, condition_generation),
  KEY idx_finance_notification_closure (event_stream, state, close_reason, lifecycle_closed_at, closed_at),
  KEY idx_finance_notification_code (source_type, source_code, state, condition_generation),
  CONSTRAINT ck_finance_notification_identity CHECK (
    condition_generation > 0
    AND source_version = TRIM(source_version) AND source_version <> ''
    AND event_version = TRIM(event_version) AND event_version <> ''
    AND idempotency_key = TRIM(idempotency_key) AND idempotency_key <> ''
    AND actionable_key = TRIM(actionable_key) AND actionable_key <> ''
    AND source_code = TRIM(source_code) AND source_code <> ''
    AND ((event_stream = 'invoice_issuance_due' AND source_type = 'invoice_request')
      OR (event_stream = 'receipt_reconciliation_due' AND source_type = 'finance_receipt'))
  ),
  CONSTRAINT ck_finance_notification_state CHECK (
    (state = 'open' AND close_reason IS NULL AND closed_at IS NULL)
    OR (state = 'closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL)
  ),
  CONSTRAINT ck_finance_notification_ack CHECK (
    (notification_id IS NULL AND notified_recipient_uid IS NULL AND acknowledged_at IS NULL)
    OR (notification_id IS NOT NULL AND notified_recipient_uid IS NOT NULL AND acknowledged_at IS NOT NULL)
  ),
  CONSTRAINT ck_finance_notification_lifecycle_ack CHECK (
    (lifecycle_next_version IS NULL AND lifecycle_closed_at IS NULL)
    OR (lifecycle_next_version IS NOT NULL AND lifecycle_closed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Finance 开票与核销到期通知检查点';

DROP PROCEDURE IF EXISTS hzy_finance_due_add_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_finance_due_add_index_if_missing;
DROP PROCEDURE IF EXISTS hzy_finance_due_add_constraint_if_missing;
