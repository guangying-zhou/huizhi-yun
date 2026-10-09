-- HZY Platform Migration v2.4: Platform signing keys
-- Date: 2026-04-26
-- Purpose:
-- 1) Add platform root signing keys for bundle/license/revocation signatures.
-- 2) Keep deployment signing keys out of platform-core; deployment keys remain customer-side.

CREATE TABLE IF NOT EXISTS `platform_signing_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kid` VARCHAR(64) NOT NULL,
  `alg` VARCHAR(32) NOT NULL DEFAULT 'Ed25519',
  `public_key` TEXT NOT NULL COMMENT 'PEM/SPKI public key',
  `private_key_ref` VARCHAR(500) NOT NULL COMMENT 'file://... / env:... / kms:...',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `activated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rotated_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_signing_keys_kid` (`kid`),
  KEY `idx_platform_signing_keys_status` (`status`, `activated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
