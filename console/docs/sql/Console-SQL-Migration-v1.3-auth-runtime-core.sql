-- Console migration v1.3: auth-runtime local sessions and OIDC core tables
--
-- Purpose:
--   Phase 1 of Console Auth Runtime / IdP implementation.
--   Adds local session support as the authoritative Console login state and
--   prepares the OIDC provider tables used by later phases.
--
-- Preconditions:
--   1. Run this against the Console database, not the Platform database.
--      Typical dev DB: hzy_console.
--   2. directory_users and directory_identities already exist.
--   3. auth_login_events may already exist from v1.2.

CREATE TABLE IF NOT EXISTS `local_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL COMMENT 'Stored session verifier. Implementations may store a hash instead of the raw cookie value.',
  `uid` VARCHAR(64) NOT NULL,
  `identity_id` BIGINT UNSIGNED NULL,
  `auth_provider` VARCHAR(64) NOT NULL DEFAULT 'local',
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `device_summary` VARCHAR(255) NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_local_sessions_session` (`session_id`),
  KEY `idx_local_sessions_uid` (`uid`, `status`, `expires_at`),
  KEY `idx_local_sessions_identity` (`identity_id`),
  KEY `idx_local_sessions_expires` (`status`, `expires_at`),
  CONSTRAINT `fk_local_sessions_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_local_sessions_identity`
    FOREIGN KEY (`identity_id`) REFERENCES `directory_identities` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_local_sessions_status`
    CHECK (`status` IN ('active', 'expired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_identity_providers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider_code` VARCHAR(64) NOT NULL,
  `provider_name` VARCHAR(255) NOT NULL,
  `provider_type` VARCHAR(32) NOT NULL COMMENT 'local / ldap / cas / oidc / wecom / dingtalk',
  `integration_code` VARCHAR(128) NULL,
  `issuer_url` VARCHAR(500) NULL,
  `client_id` VARCHAR(255) NULL,
  `credential_ref` VARCHAR(255) NULL,
  `config_json` JSON NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_identity_providers_code` (`provider_code`),
  KEY `idx_auth_identity_providers_type` (`provider_type`, `status`),
  CONSTRAINT `ck_auth_identity_providers_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_clients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` VARCHAR(128) NOT NULL COMMENT 'Default is app_code from Platform bundle applications projection.',
  `client_name` VARCHAR(255) NOT NULL,
  `app_code` VARCHAR(64) NULL,
  `client_type` VARCHAR(32) NOT NULL DEFAULT 'public' COMMENT 'public / confidential',
  `auth_mode` VARCHAR(32) NOT NULL DEFAULT 'oidc',
  `home_url` VARCHAR(500) NULL,
  `logout_url` VARCHAR(500) NULL,
  `icon` VARCHAR(255) NULL,
  `description` VARCHAR(500) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'bundle' COMMENT 'bundle / bundle_test / local',
  `source_hash` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_clients_client` (`client_id`),
  KEY `idx_auth_clients_app` (`app_code`, `status`),
  CONSTRAINT `ck_auth_clients_type`
    CHECK (`client_type` IN ('public', 'confidential')),
  CONSTRAINT `ck_auth_clients_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_client_redirect_uris` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `uri_type` VARCHAR(32) NOT NULL DEFAULT 'redirect' COMMENT 'redirect / post_logout',
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `redirect_uri_hash` CHAR(64)
    GENERATED ALWAYS AS (SHA2(`redirect_uri`, 256)) STORED
    COMMENT 'Avoids overlong utf8mb4 unique indexes on redirect_uri.',
  `source` VARCHAR(32) NOT NULL DEFAULT 'bundle' COMMENT 'bundle / bundle_test / local',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_client_redirect_uris` (`client_id`, `uri_type`, `redirect_uri_hash`),
  KEY `idx_auth_client_redirect_uris_status` (`status`),
  CONSTRAINT `fk_auth_client_redirect_uris_client`
    FOREIGN KEY (`client_id`) REFERENCES `auth_clients` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_auth_client_redirect_uris_type`
    CHECK (`uri_type` IN ('redirect', 'post_logout')),
  CONSTRAINT `ck_auth_client_redirect_uris_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_authorization_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` VARCHAR(128) NOT NULL,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `scope` VARCHAR(500) NOT NULL,
  `state_hash` VARCHAR(128) NULL,
  `nonce_hash` VARCHAR(128) NULL,
  `nonce` VARCHAR(255) NULL COMMENT 'OIDC nonce echoed into the ID token. Not a credential; retained only for short-lived auth code exchange.',
  `code_challenge` VARCHAR(255) NOT NULL,
  `code_challenge_method` VARCHAR(16) NOT NULL DEFAULT 'S256',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_authorization_codes_hash` (`code_hash`),
  KEY `idx_auth_authorization_codes_client` (`client_id`, `status`, `expires_at`),
  KEY `idx_auth_authorization_codes_session` (`session_id`),
  CONSTRAINT `fk_auth_authorization_codes_client`
    FOREIGN KEY (`client_id`) REFERENCES `auth_clients` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_authorization_codes_session`
    FOREIGN KEY (`session_id`) REFERENCES `local_sessions` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_authorization_codes_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_auth_authorization_codes_status`
    CHECK (`status` IN ('active', 'consumed', 'expired', 'revoked')),
  CONSTRAINT `ck_auth_authorization_codes_challenge_method`
    CHECK (`code_challenge_method` IN ('S256'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_refresh_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` VARCHAR(128) NOT NULL,
  `token_family` VARCHAR(128) NOT NULL,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `rotated_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `reuse_detected_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_refresh_tokens_hash` (`token_hash`),
  KEY `idx_auth_refresh_tokens_family` (`token_family`, `status`),
  KEY `idx_auth_refresh_tokens_session` (`session_id`, `status`),
  KEY `idx_auth_refresh_tokens_client` (`client_id`, `status`),
  CONSTRAINT `fk_auth_refresh_tokens_client`
    FOREIGN KEY (`client_id`) REFERENCES `auth_clients` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_refresh_tokens_session`
    FOREIGN KEY (`session_id`) REFERENCES `local_sessions` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_refresh_tokens_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_auth_refresh_tokens_status`
    CHECK (`status` IN ('active', 'rotated', 'revoked', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_token_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_type` VARCHAR(32) NOT NULL COMMENT 'issue / refresh / revoke / reuse_detected / introspect',
  `client_id` VARCHAR(128) NULL,
  `uid` VARCHAR(64) NULL,
  `session_hash` VARCHAR(128) NULL,
  `token_hash` VARCHAR(128) NULL,
  `result` VARCHAR(32) NOT NULL DEFAULT 'success',
  `failure_reason` VARCHAR(500) NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auth_token_events_uid_time` (`uid`, `created_at`),
  KEY `idx_auth_token_events_client_time` (`client_id`, `created_at`),
  KEY `idx_auth_token_events_type_time` (`event_type`, `created_at`),
  CONSTRAINT `ck_auth_token_events_result`
    CHECK (`result` IN ('success', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_signing_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kid` VARCHAR(128) NOT NULL,
  `alg` VARCHAR(32) NOT NULL DEFAULT 'EdDSA',
  `use_type` VARCHAR(32) NOT NULL DEFAULT 'sig',
  `public_jwk_json` JSON NOT NULL,
  `private_key_ref` VARCHAR(255) NULL COMMENT 'Vault or external secret reference. Plain private key must not be stored here.',
  `not_before` DATETIME NULL,
  `not_after` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'current',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_signing_keys_kid` (`kid`),
  KEY `idx_auth_signing_keys_status` (`status`, `not_before`, `not_after`),
  CONSTRAINT `ck_auth_signing_keys_status`
    CHECK (`status` IN ('current', 'next', 'retired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
