-- ADR-018 immutable operator approval of exact external evidence; no business writes.
CREATE TABLE IF NOT EXISTS enterprise_external_drain_approvals (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(32) NOT NULL,
 cutover_key VARCHAR(191) NOT NULL,
 seal_revision BIGINT UNSIGNED NOT NULL,
 seal_payload_sha256 CHAR(64) NOT NULL,
 request_id VARCHAR(128) NOT NULL,
 payload_sha256 CHAR(64) NOT NULL,
 payload_json JSON NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 approval_reference VARCHAR(500) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(tenant_code,environment,cutover_key,seal_revision),
 UNIQUE KEY uk_external_drain_request(tenant_code,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
