-- Console migration v1.2: local auth login events
--
-- Purpose:
--   Console login callbacks now write login audit events into the local
--   auth-runtime instead of reporting them to the legacy Account API.
--
-- Preconditions:
--   1. Run this against the Console database, not the Platform database.
--      Typical dev DB: hzy_console.
--   2. directory_users and directory_identities already exist.

CREATE TABLE IF NOT EXISTS `auth_login_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NULL,
  `identity_id` BIGINT UNSIGNED NULL,
  `target_app` VARCHAR(64) NULL,
  `auth_provider` VARCHAR(64) NOT NULL DEFAULT 'local',
  `login_type` VARCHAR(32) NOT NULL DEFAULT 'sso' COMMENT 'password / sso / oauth / oidc / wecom / dingtalk',
  `login_result` VARCHAR(32) NOT NULL COMMENT 'success / failed',
  `failure_reason` VARCHAR(500) NULL,
  `ip_address` VARCHAR(64) NULL,
  `location` VARCHAR(128) NULL,
  `device_summary` VARCHAR(255) NULL,
  `browser` VARCHAR(128) NULL,
  `os` VARCHAR(128) NULL,
  `session_id` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auth_login_events_uid_time` (`uid`, `created_at`),
  KEY `idx_auth_login_events_identity` (`identity_id`, `created_at`),
  KEY `idx_auth_login_events_result` (`login_result`, `created_at`),
  KEY `idx_auth_login_events_target` (`target_app`, `created_at`),
  KEY `idx_auth_login_events_session` (`session_id`),
  CONSTRAINT `fk_auth_login_events_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_auth_login_events_identity`
    FOREIGN KEY (`identity_id`) REFERENCES `directory_identities` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_auth_login_events_result`
    CHECK (`login_result` IN ('success', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
