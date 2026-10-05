CREATE TABLE IF NOT EXISTS directory_lifecycle_scope_versions (
  employee_uid VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_revision BIGINT UNSIGNED NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  lifecycle_type VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_command_receipt (
  receipt_id CHAR(36) PRIMARY KEY, operation_id CHAR(36) NOT NULL,
  operation_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_deployment_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deployment_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_app VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_app VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  required_capability VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_schema_version VARCHAR(30) NOT NULL, command_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL, service_client_id VARCHAR(100) NULL, target_biz_type VARCHAR(100) NULL,
  target_biz_code VARCHAR(191) NULL, response_http_status SMALLINT UNSIGNED NULL, response_summary_sha256 CHAR(64) NULL, result_json JSON NULL,
  received_at DATETIME(3) NOT NULL, last_received_at DATETIME(3) NOT NULL, completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_console_scr_identity (tenant_code,source_deployment_code,deployment_code,source_app,target_app,operation_code,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_operation (
  operation_id CHAR(36) PRIMARY KEY, operation_key VARCHAR(191) NOT NULL, tenant_code VARCHAR(100) NOT NULL,
  deployment_code VARCHAR(100) NOT NULL, source_app VARCHAR(50) NOT NULL, target_app VARCHAR(50) NOT NULL,
  operation_code VARCHAR(191) NOT NULL, required_capability VARCHAR(191) NOT NULL, source_biz_type VARCHAR(100) NOT NULL,
  source_biz_code VARCHAR(191) NOT NULL, idempotency_key VARCHAR(191) NOT NULL, command_schema_version VARCHAR(30) NOT NULL,
  command_json JSON NOT NULL, command_sha256 CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0, fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), locked_until DATETIME(3) NULL,
  target_receipt_id CHAR(36) NULL,target_biz_type VARCHAR(100) NULL,target_biz_code VARCHAR(191) NULL,response_summary_sha256 CHAR(64) NULL,
  original_actor_uid VARCHAR(100) NULL,service_client_id VARCHAR(100) NULL,last_error_code VARCHAR(100) NULL,
  last_error_class VARCHAR(50) NULL,last_error_summary VARCHAR(1000) NULL,succeeded_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_console_iop_key (tenant_code,deployment_code,source_app,operation_key),
  KEY idx_console_iop_due (status,next_attempt_at,locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_operation_attempt (
  attempt_id CHAR(36) PRIMARY KEY,operation_id CHAR(36) NOT NULL,attempt_no INT UNSIGNED NOT NULL,
  fencing_token BIGINT UNSIGNED NOT NULL,result_status VARCHAR(32) NOT NULL,error_code VARCHAR(100) NULL,
  started_at DATETIME(3) NOT NULL,finished_at DATETIME(3) NULL,created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_console_ioa_attempt (operation_id,attempt_no),KEY idx_console_ioa_status (result_status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
