-- Additive after enterprise entitlement base schema. No legacy order/subscription updates.
CREATE TABLE IF NOT EXISTS tenant_enterprise_order_fulfillments (
 tenant_code VARCHAR(64) NOT NULL,
 order_id BIGINT UNSIGNED NOT NULL,
 source_hash VARCHAR(80) NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 previous_revision BIGINT UNSIGNED NOT NULL,
 result_revision BIGINT UNSIGNED NOT NULL,
 order_from DATETIME(3) NOT NULL,
 order_until DATETIME(3) NOT NULL,
 result_json JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (tenant_code, order_id),
 CONSTRAINT fk_enterprise_order_qualification FOREIGN KEY (tenant_code, result_revision) REFERENCES tenant_enterprise_entitlements(tenant_code, revision),
 CONSTRAINT chk_enterprise_order_period CHECK (order_until > order_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
