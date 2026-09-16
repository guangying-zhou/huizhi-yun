-- Console SQL Migration v1.70: one-time, browser-bound external login transactions.
-- Date: 2026-07-14
-- Safe to run repeatedly. Stores only hashes of OAuth state and browser binding.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_external_login_transactions` (
  `transaction_id` CHAR(36) NOT NULL,
  `provider_code` VARCHAR(64) NOT NULL,
  `state_sha256` CHAR(64) NOT NULL,
  `browser_binding_sha256` CHAR(64) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `deployment_code` VARCHAR(128) NOT NULL,
  `target_app_code` VARCHAR(64) NOT NULL,
  `redirect_path` VARCHAR(2048) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'issued',
  `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`transaction_id`),
  UNIQUE KEY `uk_auth_external_login_state` (`state_sha256`),
  KEY `idx_auth_external_login_expiry` (`provider_code`, `status`, `expires_at`),
  CONSTRAINT `ck_auth_external_login_status`
    CHECK (`status` IN ('issued', 'consumed', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
