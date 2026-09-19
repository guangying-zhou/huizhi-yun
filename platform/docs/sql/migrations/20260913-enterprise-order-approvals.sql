-- Immutable operational approval evidence. Apply before enabling unified order creation.
CREATE TABLE IF NOT EXISTS enterprise_order_approvals (
  tenant_code VARCHAR(64) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  order_id BIGINT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  approval_reference VARCHAR(255) NOT NULL,
  approved_by_uid VARCHAR(128) NOT NULL,
  approved_json JSON NOT NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_code, request_id),
  UNIQUE KEY uk_enterprise_order_approval_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS enterprise_order_acceptances (
  order_id BIGINT NOT NULL PRIMARY KEY,
  tenant_code VARCHAR(64) NOT NULL,
  approval_hash CHAR(64) NOT NULL,
  accepted_by_uid VARCHAR(128) NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
