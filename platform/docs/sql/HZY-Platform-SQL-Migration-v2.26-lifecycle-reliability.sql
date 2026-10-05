CREATE TABLE IF NOT EXISTS platform_lifecycle_scope_versions (
  tenant_code VARCHAR(64) NOT NULL, employee_uid VARCHAR(64) NOT NULL,
  applied_revision BIGINT UNSIGNED NOT NULL, snapshot_hash CHAR(64) NOT NULL, lifecycle_type VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code,employee_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_command_receipt (
  receipt_id CHAR(36) PRIMARY KEY,operation_id CHAR(36) NOT NULL,operation_code VARCHAR(191) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,source_deployment_code VARCHAR(128) NOT NULL,deployment_code VARCHAR(128) NOT NULL,
  source_app VARCHAR(50) NOT NULL,target_app VARCHAR(50) NOT NULL,required_capability VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,command_schema_version VARCHAR(30) NOT NULL,command_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,target_biz_type VARCHAR(100) NULL,target_biz_code VARCHAR(191) NULL,
  response_http_status SMALLINT UNSIGNED NULL,response_summary_sha256 CHAR(64) NULL,
  received_at DATETIME(3) NOT NULL,last_received_at DATETIME(3) NOT NULL,completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_platform_scr_identity (tenant_code,source_deployment_code,source_app,target_app,operation_code,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
