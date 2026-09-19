-- Additive only. No rows, grants or scheduler activation are seeded.
CREATE TABLE IF NOT EXISTS tenant_scheduler_ownership (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(32) NOT NULL,
 source_app VARCHAR(32) NOT NULL,
 storage_mode VARCHAR(16) NOT NULL,
 runtime_code VARCHAR(128) NOT NULL,
 worker_deployment VARCHAR(128) NOT NULL,
 worker_client VARCHAR(128) NOT NULL,
 generation DECIMAL(20,0) NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 verification_reference VARCHAR(500) NOT NULL,
 verification_sha256 CHAR(64) NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 request_id VARCHAR(128) NOT NULL,
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(tenant_code,environment,source_app)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tenant_scheduler_ownership_receipts (
 tenant_code VARCHAR(64) NOT NULL,
 request_id VARCHAR(128) NOT NULL,
 payload_sha256 CHAR(64) NOT NULL,
 payload_json JSON NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(tenant_code,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
