-- Dedicated receivable collection responsibility and reliable due notification checkpoints.
-- Repeatable on MySQL 8. Historical rows deliberately remain NULL; no owner/contract fallback.
SET @schema_name = DATABASE();

SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='receivable_plan' AND column_name='collection_responsible_uid');
SET @sql = IF(@has_column=0, 'ALTER TABLE receivable_plan ADD COLUMN collection_responsible_uid VARCHAR(50) NULL COMMENT ''应收催收唯一直接责任人UID（不从合同负责人推导）'' AFTER owner_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@schema_name AND table_name='receivable_plan' AND index_name='idx_rp_collection_due');
SET @sql = IF(@has_index=0, 'ALTER TABLE receivable_plan ADD INDEX idx_rp_collection_due (status, planned_payment_date, id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_index = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@schema_name AND table_name='receivable_plan' AND index_name='idx_rp_collection_responsible');
SET @sql = IF(@has_index=0, 'ALTER TABLE receivable_plan ADD INDEX idx_rp_collection_responsible (collection_responsible_uid, status, planned_payment_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_check = (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=@schema_name AND table_name='receivable_plan' AND constraint_name='ck_rp_collection_responsible');
SET @sql = IF(@has_check=0, 'ALTER TABLE receivable_plan ADD CONSTRAINT ck_rp_collection_responsible CHECK (collection_responsible_uid IS NULL OR (collection_responsible_uid=TRIM(collection_responsible_uid) AND collection_responsible_uid<>'''' AND LOWER(collection_responsible_uid)<>''@all'' AND collection_responsible_uid NOT REGEXP ''[[:cntrl:]]''))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS altoc_receivable_notification_checkpoint (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, event_stream ENUM('receivable_plan_due') NOT NULL,
  source_type ENUM('receivable_plan') NOT NULL, source_id BIGINT NOT NULL, condition_generation BIGINT UNSIGNED NOT NULL,
  phase ENUM('D30','D7','D1','expired') NOT NULL, source_version CHAR(64) NOT NULL, event_version VARCHAR(191) NOT NULL,
  previous_event_version VARCHAR(191) NULL, previous_recipient_uid VARCHAR(50) NULL, idempotency_key VARCHAR(191) NOT NULL,
  actionable_key VARCHAR(191) NOT NULL, due_at DATE NOT NULL, source_code VARCHAR(30) NOT NULL, source_name VARCHAR(255) NOT NULL,
  recipient_candidates_json JSON NOT NULL, state ENUM('open','closed') NOT NULL DEFAULT 'open',
  close_reason ENUM('superseded','condition_resolved','condition_cancelled') NULL, closed_at DATETIME NULL,
  notification_id VARCHAR(191) NULL, notified_recipient_uid VARCHAR(50) NULL, acknowledged_at DATETIME NULL,
  lifecycle_next_version VARCHAR(191) NULL, lifecycle_closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(id), UNIQUE KEY uk_arn_event(event_version), UNIQUE KEY uk_arn_idempotency(idempotency_key),
  UNIQUE KEY uk_arn_phase(event_stream,source_type,source_id,condition_generation,phase),
  KEY idx_arn_source(event_stream,source_type,source_id,state,condition_generation),
  KEY idx_arn_closure(event_stream,state,close_reason,lifecycle_closed_at,closed_at),
  CONSTRAINT fk_arn_receivable_plan FOREIGN KEY(source_id) REFERENCES receivable_plan(id),
  CONSTRAINT ck_arn_identity CHECK(condition_generation>0 AND event_stream='receivable_plan_due' AND source_type='receivable_plan'
    AND source_version=TRIM(source_version) AND source_version<>'' AND event_version=TRIM(event_version) AND event_version<>''
    AND idempotency_key=TRIM(idempotency_key) AND idempotency_key<>'' AND actionable_key=TRIM(actionable_key) AND actionable_key<>''
    AND source_code=TRIM(source_code) AND source_code<>''),
  CONSTRAINT ck_arn_state CHECK((state='open' AND close_reason IS NULL AND closed_at IS NULL) OR (state='closed' AND close_reason IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT ck_arn_ack CHECK((notification_id IS NULL AND notified_recipient_uid IS NULL AND acknowledged_at IS NULL) OR (notification_id IS NOT NULL AND notified_recipient_uid IS NOT NULL AND acknowledged_at IS NOT NULL)),
  CONSTRAINT ck_arn_lifecycle CHECK((lifecycle_next_version IS NULL AND lifecycle_closed_at IS NULL) OR (lifecycle_next_version IS NOT NULL AND lifecycle_closed_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Altoc 应收到期通知检查点';
