-- Apply after 20260913-enterprise-entitlements.sql. Additive, no legacy records modified.
CREATE TABLE IF NOT EXISTS tenant_enterprise_entitlement_state_commands (
  tenant_code VARCHAR(64) NOT NULL,
  operation_id VARCHAR(120) NOT NULL,
  request_hash VARCHAR(80) NOT NULL,
  action VARCHAR(16) NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  previous_revision BIGINT UNSIGNED NOT NULL,
  result_revision BIGINT UNSIGNED NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code, operation_id),
  CONSTRAINT fk_entitlement_state_revision FOREIGN KEY (tenant_code, result_revision) REFERENCES tenant_enterprise_entitlements(tenant_code, revision),
  CONSTRAINT chk_entitlement_state_action CHECK (action IN ('suspend', 'revoke', 'restore'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
