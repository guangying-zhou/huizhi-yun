-- Additive control-plane contract; no tenants or routes are seeded.
CREATE TABLE IF NOT EXISTS enterprise_recovery_routes (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(32) NOT NULL,
 recovery_key VARCHAR(191) NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 state VARCHAR(32) NOT NULL,
 payload_json JSON NOT NULL,
 payload_sha256 CHAR(64) NOT NULL,
 activation_sha256 CHAR(64) NULL,
 actor_uid VARCHAR(128) NOT NULL,
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(tenant_code,environment),
 UNIQUE KEY recovery_key_unique(tenant_code,recovery_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS enterprise_recovery_route_receipts (
 tenant_code VARCHAR(64) NOT NULL,
 request_id VARCHAR(191) NOT NULL,
 payload_sha256 CHAR(64) NOT NULL,
 payload_json JSON NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(tenant_code,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
