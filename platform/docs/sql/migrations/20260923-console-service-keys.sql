-- R1 Console steady service identity (docs/Console-Runtime-Steady-Identity-Proposal-R1-20260922.md).
-- Additive only; no rows seeded. Console registers its own public key; Platform
-- signs active keys into that deployment's policy envelope. Revocation is a
-- status change, and a revoked kid can never be registered again.
CREATE TABLE IF NOT EXISTS console_service_keys (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(32) NOT NULL,
 deployment_code VARCHAR(128) NOT NULL,
 kid CHAR(20) NOT NULL,
 public_key CHAR(43) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'active',
 not_after BIGINT NOT NULL,
 registered_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 revoked_at DATETIME(6) NULL,
 PRIMARY KEY(tenant_code, environment, deployment_code, kid),
 KEY idx_console_service_keys_active (tenant_code, environment, deployment_code, status, not_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
