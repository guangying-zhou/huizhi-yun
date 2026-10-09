-- Platform-managed Data Runtime release registry and stable-channel approval.
-- Safe to rerun: all objects use CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `platform_runtime_releases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `runtime_code` VARCHAR(64) NOT NULL DEFAULT 'hzy-data-runtime',
  `release_version` VARCHAR(64) NOT NULL,
  `commit_sha` VARCHAR(128) NOT NULL,
  `built_at` DATETIME NOT NULL,
  `manifest_hash` VARCHAR(64) NOT NULL,
  `manifest_json` JSON NOT NULL,
  `release_signing_key_id` VARCHAR(64) NOT NULL,
  `package_base_url` VARCHAR(500) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'available'
    COMMENT 'available / withdrawn',
  `discovered_by_account_id` BIGINT UNSIGNED NULL,
  `discovered_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_runtime_releases_version` (`runtime_code`, `release_version`),
  KEY `idx_platform_runtime_releases_built` (`runtime_code`, `built_at`),
  KEY `idx_platform_runtime_releases_status` (`runtime_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_runtime_release_channels` (
  `runtime_code` VARCHAR(64) NOT NULL DEFAULT 'hzy-data-runtime',
  `channel_code` VARCHAR(32) NOT NULL DEFAULT 'stable',
  `approved_release_id` BIGINT UNSIGNED NOT NULL,
  `approval_kind` VARCHAR(32) NOT NULL DEFAULT 'promotion'
    COMMENT 'promotion / rollback',
  `approved_by_account_id` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approval_note` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`runtime_code`, `channel_code`),
  KEY `idx_platform_runtime_release_channels_release` (`approved_release_id`),
  CONSTRAINT `fk_platform_runtime_release_channels_release`
    FOREIGN KEY (`approved_release_id`) REFERENCES `platform_runtime_releases` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
