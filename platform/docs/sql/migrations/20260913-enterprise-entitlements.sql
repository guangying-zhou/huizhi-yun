-- ADR-018 additive control-plane migration. Apply only via approved environment migration.
-- No order, subscription, License or business data is modified.
CREATE TABLE IF NOT EXISTS tenant_enterprise_entitlements (
  tenant_code VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  schema_version VARCHAR(64) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  effective_from DATETIME(3) NOT NULL,
  effective_until DATETIME(3) NULL,
  period_kind VARCHAR(16) NOT NULL,
  entitlement_json JSON NOT NULL,
  migration_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code, revision),
  CONSTRAINT fk_enterprise_entitlement_tenant FOREIGN KEY (tenant_code) REFERENCES tenants(tenant_code),
  CONSTRAINT chk_enterprise_entitlement_period CHECK ((period_kind = 'finite' AND effective_until IS NOT NULL AND effective_until > effective_from) OR (period_kind = 'unlimited' AND effective_until IS NULL)),
  CONSTRAINT chk_enterprise_entitlement_status CHECK (status IN ('pending', 'active', 'suspended', 'expired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tenant_enterprise_entitlement_current (
  tenant_code VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (tenant_code),
  CONSTRAINT fk_enterprise_entitlement_current FOREIGN KEY (tenant_code, revision) REFERENCES tenant_enterprise_entitlements(tenant_code, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tenant_enterprise_entitlement_migrations (
  tenant_code VARCHAR(64) NOT NULL,
  migration_id VARCHAR(128) NOT NULL,
  request_hash VARCHAR(80) NOT NULL,
  source_hash VARCHAR(80) NOT NULL,
  previous_revision BIGINT UNSIGNED NOT NULL,
  result_revision BIGINT UNSIGNED NOT NULL,
  historical_ids_json JSON NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code, migration_id),
  CONSTRAINT fk_enterprise_entitlement_receipt FOREIGN KEY (tenant_code, result_revision) REFERENCES tenant_enterprise_entitlements(tenant_code, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
