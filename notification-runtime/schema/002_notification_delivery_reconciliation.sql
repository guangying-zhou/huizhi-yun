CREATE TABLE IF NOT EXISTS notification_delivery_reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  delivery_id BIGINT UNSIGNED NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  deployment_code VARCHAR(64) NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  actor_source_app VARCHAR(64) NOT NULL,
  actor_client_id VARCHAR(128) NOT NULL,
  actor_subject VARCHAR(191) NULL,
  reason VARCHAR(512) NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  evidence_reference VARCHAR(191) NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_notification_reconciliation_delivery (delivery_id, id),
  KEY idx_notification_reconciliation_tenant_time (tenant_code, deployment_code, created_at),
  CONSTRAINT fk_notification_reconciliation_delivery
    FOREIGN KEY (delivery_id) REFERENCES notification_delivery_ledger (id),
  CONSTRAINT chk_notification_reconciliation_transition CHECK (
    from_status = 'partial_unknown' AND to_status IN ('succeeded', 'failed')
  ),
  CONSTRAINT chk_notification_reconciliation_reason CHECK (CHAR_LENGTH(reason) >= 8),
  CONSTRAINT chk_notification_reconciliation_evidence CHECK (
    CHAR_LENGTH(evidence_type) >= 1 AND CHAR_LENGTH(evidence_reference) >= 1
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- This table is append-only by runtime contract. The runtime DB account only needs
-- SELECT/INSERT here; do not grant UPDATE or DELETE on reconciliation audit rows.
