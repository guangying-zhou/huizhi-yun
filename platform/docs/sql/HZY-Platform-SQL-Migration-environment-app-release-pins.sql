-- Candidate only. Platform DDL and prod39 initialization need separate approval.
CREATE TABLE IF NOT EXISTS tenant_environment_app_release_sets (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(16) NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 source_bundle_id BIGINT UNSIGNED NULL,
 source_bundle_hash VARCHAR(128) NULL,
 updated_by VARCHAR(128) NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(tenant_code,environment),
 CONSTRAINT ck_app_pin_environment CHECK(environment IN ('prod','test','dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tenant_environment_app_releases (
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(16) NOT NULL,
 app_code VARCHAR(64) NOT NULL,
 release_id BIGINT UNSIGNED NULL COMMENT 'NULL follows latest released; non-NULL is exact pin',
 PRIMARY KEY(tenant_code,environment,app_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS platform_environment_app_release_audits (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tenant_code VARCHAR(64) NOT NULL,
 environment VARCHAR(16) NOT NULL,
 actor_uid VARCHAR(128) NOT NULL,
 reason VARCHAR(500) NOT NULL,
 old_selection_json JSON NOT NULL,
 new_selection_json JSON NOT NULL,
 review_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_app_pin_audit(tenant_code,environment,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
