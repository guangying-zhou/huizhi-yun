CREATE TABLE IF NOT EXISTS enterprise_drain_activity_approvals (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(32) NOT NULL,
 activity_id VARCHAR(191) NOT NULL,
 closed_revision BIGINT UNSIGNED NOT NULL,
 request_id VARCHAR(128) NOT NULL,
 approval_sha256 CHAR(64) NOT NULL,
 payload_json JSON NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(tenant_code,environment,activity_id,closed_revision),
 UNIQUE KEY uk_drain_activity_request(tenant_code,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
