-- 2026-07-10: target-owned service command receipt/inbox.
-- Apply before enabling receipt-required service command calls.

CREATE TABLE IF NOT EXISTS service_command_receipt (
  receipt_id CHAR(36) PRIMARY KEY,
  operation_id CHAR(36) NOT NULL,
  operation_code VARCHAR(191) NOT NULL,
  tenant_code VARCHAR(100) NOT NULL,
  source_deployment_code VARCHAR(100) NOT NULL,
  deployment_code VARCHAR(100) NOT NULL,
  source_app VARCHAR(50) NOT NULL,
  target_app VARCHAR(50) NOT NULL,
  required_capability VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  identity_sha256 BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CONCAT_WS('|', tenant_code, source_deployment_code, deployment_code, source_app, target_app, operation_code, idempotency_key), 256))) STORED,
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1',
  command_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  locked_by VARCHAR(100) DEFAULT NULL,
  locked_until DATETIME(3) DEFAULT NULL,
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1,
  first_request_id VARCHAR(100) DEFAULT NULL,
  last_request_id VARCHAR(100) DEFAULT NULL,
  correlation_id VARCHAR(100) DEFAULT NULL,
  original_actor_uid VARCHAR(100) DEFAULT NULL,
  service_client_id VARCHAR(100) DEFAULT NULL,
  target_biz_type VARCHAR(100) DEFAULT NULL,
  target_biz_code VARCHAR(191) DEFAULT NULL,
  response_http_status SMALLINT UNSIGNED DEFAULT NULL,
  response_summary_sha256 CHAR(64) DEFAULT NULL,
  last_error_code VARCHAR(100) DEFAULT NULL,
  last_error_class VARCHAR(50) DEFAULT NULL,
  last_error_summary VARCHAR(1000) DEFAULT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_scr_identity (identity_sha256),
  UNIQUE KEY uk_scr_operation_id (operation_id),
  INDEX idx_scr_status_lock (status, locked_until),
  INDEX idx_scr_target_biz (tenant_code, deployment_code, target_app, target_biz_type, target_biz_code),
  INDEX idx_scr_received (received_at),
  CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app OR (
    source_app = 'assets' AND target_app = 'assets'
    AND source_deployment_code = deployment_code
    AND original_actor_uid IS NOT NULL AND CHAR_LENGTH(TRIM(original_actor_uid)) > 0
    AND command_schema_version = 'assets-owned-command.v1'
    AND (
      (operation_code IN ('assets.products.create.v1', 'assets.products.edit.v1') AND required_capability = 'assets:product:edit')
      OR (operation_code = 'assets.product-categories.save.v1' AND required_capability = 'assets:admin:admin')
    )
  )),
  CONSTRAINT chk_scr_status CHECK (status IN ('processing', 'succeeded', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='目标服务命令 Inbox 回执；业务 mutation 与 succeeded 必须同事务';
