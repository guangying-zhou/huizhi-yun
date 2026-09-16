-- HZY Platform Migration v2.6: Email password auth and activation links
-- Date: 2026-04-27
-- Purpose:
-- 1) Track verified email state on platform control-plane accounts.
-- 2) Store one-time email activation tokens as hashes only.

START TRANSACTION;

ALTER TABLE `platform_accounts`
  ADD COLUMN `email_verified_at` DATETIME NULL AFTER `email`;

CREATE TABLE IF NOT EXISTS `platform_email_activation_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `token_hash` CHAR(64) NOT NULL COMMENT 'sha256(token)，明文只通过邮件发送',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_email_activation_tokens_hash` (`token_hash`),
  KEY `idx_platform_email_activation_tokens_account_status` (`account_id`, `status`, `expires_at`),
  KEY `idx_platform_email_activation_tokens_email_status` (`email`, `status`, `expires_at`),
  CONSTRAINT `fk_platform_email_activation_tokens_account`
    FOREIGN KEY (`account_id`) REFERENCES `platform_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
