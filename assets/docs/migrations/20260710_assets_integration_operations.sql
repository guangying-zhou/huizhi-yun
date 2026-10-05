-- Assets caller-owned outbox for customer-delivery-asset status -> Altoc. Additive; not executed here.
SET @schema_name = DATABASE();
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='customer_delivery_assets' AND column_name='altoc_status_sync_revision')=0,'ALTER TABLE customer_delivery_assets ADD COLUMN altoc_status_sync_revision BIGINT UNSIGNED NOT NULL DEFAULT 0','SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='customer_delivery_assets' AND column_name='altoc_status_sync_fingerprint')=0,'ALTER TABLE customer_delivery_assets ADD COLUMN altoc_status_sync_fingerprint CHAR(64) NULL','SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='customer_delivery_assets' AND column_name='altoc_status_sync_occurred_at')=0,'ALTER TABLE customer_delivery_assets ADD COLUMN altoc_status_sync_occurred_at DATETIME(3) NULL','SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS integration_operation (
  operation_id CHAR(36) PRIMARY KEY, operation_key VARCHAR(191) NOT NULL, correlation_key VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL DEFAULT 1, depends_on_operation_key VARCHAR(191) DEFAULT NULL,
  tenant_code VARCHAR(100) NOT NULL, deployment_code VARCHAR(100) NOT NULL, source_app VARCHAR(50) NOT NULL,
  target_app VARCHAR(50) NOT NULL, operation_code VARCHAR(191) NOT NULL, required_capability VARCHAR(191) NOT NULL,
  source_biz_type VARCHAR(100) NOT NULL, source_biz_code VARCHAR(191) NOT NULL, target_receipt_id CHAR(36) DEFAULT NULL,
  target_biz_type VARCHAR(100) DEFAULT NULL, target_biz_code VARCHAR(191) DEFAULT NULL, idempotency_key VARCHAR(191) NOT NULL,
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1', command_json JSON NOT NULL, command_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending', attempt_count INT UNSIGNED NOT NULL DEFAULT 0, max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_attempt_at DATETIME(3) DEFAULT NULL,
  locked_by VARCHAR(100) DEFAULT NULL, locked_until DATETIME(3) DEFAULT NULL, fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1, original_request_id VARCHAR(100) DEFAULT NULL, correlation_id VARCHAR(100) DEFAULT NULL,
  original_actor_uid VARCHAR(100) DEFAULT NULL, service_client_id VARCHAR(100) DEFAULT NULL, replay_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_replay_actor_uid VARCHAR(100) DEFAULT NULL, last_replay_reason VARCHAR(500) DEFAULT NULL, last_replay_at DATETIME(3) DEFAULT NULL,
  last_http_status SMALLINT UNSIGNED DEFAULT NULL, last_error_code VARCHAR(100) DEFAULT NULL, last_error_class VARCHAR(50) DEFAULT NULL,
  last_error_summary VARCHAR(1000) DEFAULT NULL, last_error_at DATETIME(3) DEFAULT NULL, response_summary_sha256 CHAR(64) DEFAULT NULL,
  failure_notified_at DATETIME(3) DEFAULT NULL, failure_notification_id VARCHAR(64) DEFAULT NULL, succeeded_at DATETIME(3) DEFAULT NULL,
  failed_permanent_at DATETIME(3) DEFAULT NULL, dead_lettered_at DATETIME(3) DEFAULT NULL, cancelled_at DATETIME(3) DEFAULT NULL,
  created_by VARCHAR(100) DEFAULT NULL, updated_by VARCHAR(100) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_assets_iop_identity (tenant_code,deployment_code,source_app,target_app,operation_code,idempotency_key),
  UNIQUE KEY uk_assets_iop_key (tenant_code,deployment_code,source_app,operation_key),
  UNIQUE KEY uk_assets_iop_sequence (tenant_code,deployment_code,source_app,correlation_key,sequence_no),
  INDEX idx_assets_iop_due (status,next_attempt_at,locked_until), INDEX idx_assets_iop_lock (status,locked_until),
  INDEX idx_assets_iop_dependency (tenant_code,deployment_code,source_app,depends_on_operation_key),
  INDEX idx_assets_iop_failure (tenant_code,deployment_code,source_app,status,failure_notified_at,dead_lettered_at,operation_id),
  CONSTRAINT chk_assets_iop_cross_app CHECK (source_app<>target_app),
  CONSTRAINT chk_assets_iop_status CHECK (status IN ('pending','processing','retry_wait','partial_unknown','succeeded','failed_permanent','dead_letter','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_operation_attempt (
  attempt_id CHAR(36) PRIMARY KEY, operation_id CHAR(36) NOT NULL, operation_code VARCHAR(191) NOT NULL,
  attempt_no INT UNSIGNED NOT NULL, trigger_type VARCHAR(32) NOT NULL, request_id VARCHAR(100) DEFAULT NULL,
  correlation_id VARCHAR(100) DEFAULT NULL, locked_by VARCHAR(100) DEFAULT NULL, fencing_token BIGINT UNSIGNED NOT NULL,
  result_status VARCHAR(32) NOT NULL DEFAULT 'processing', http_status SMALLINT UNSIGNED DEFAULT NULL,
  error_code VARCHAR(100) DEFAULT NULL, error_class VARCHAR(50) DEFAULT NULL, error_summary VARCHAR(1000) DEFAULT NULL,
  target_biz_type VARCHAR(100) DEFAULT NULL, target_biz_code VARCHAR(191) DEFAULT NULL, response_summary_sha256 CHAR(64) DEFAULT NULL,
  started_at DATETIME(3) NOT NULL, finished_at DATETIME(3) DEFAULT NULL, duration_ms BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uk_assets_ioa_attempt (operation_id,attempt_no),
  INDEX idx_assets_ioa_created (operation_id,created_at), INDEX idx_assets_ioa_result (result_status,created_at),
  CONSTRAINT fk_assets_ioa_operation FOREIGN KEY (operation_id) REFERENCES integration_operation(operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_assets_ioa_status CHECK (result_status IN ('processing','succeeded','retry_wait','partial_unknown','failed_permanent','dead_letter','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
