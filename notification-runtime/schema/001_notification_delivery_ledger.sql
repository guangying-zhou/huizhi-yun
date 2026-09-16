CREATE TABLE IF NOT EXISTS notification_delivery_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_code VARCHAR(64) NOT NULL,
  deployment_code VARCHAR(64) NOT NULL,
  source_app VARCHAR(64) NOT NULL,
  source_client_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  provider_code VARCHAR(32) NOT NULL,
  integration_code VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  lease_owner VARCHAR(64) NULL,
  lease_expires_at DATETIME(6) NULL,
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 1,
  result_json JSON NULL,
  last_error_code VARCHAR(96) NULL,
  last_error_summary VARCHAR(512) NULL,
  succeeded_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_notification_delivery_identity (
    tenant_code, deployment_code, source_app, idempotency_key
  ),
  KEY idx_notification_delivery_status_lease (status, lease_expires_at),
  CONSTRAINT chk_notification_delivery_hash CHECK (request_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_notification_delivery_status CHECK (
    status IN ('processing', 'succeeded', 'failed', 'partial_unknown')
  ),
  CONSTRAINT chk_notification_delivery_attempt CHECK (attempt_count >= 1),
  CONSTRAINT chk_notification_delivery_fencing CHECK (fencing_token >= 1),
  CONSTRAINT chk_notification_delivery_lease CHECK (
    (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
