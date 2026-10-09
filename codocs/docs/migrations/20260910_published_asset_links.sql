-- Codocs tenant-runtime database, MySQL 8.0+.
-- Apply before updating runtime and enabling published asset short links.
-- Existing OSS-only assets receive mappings lazily on explicit link creation.
CREATE TABLE IF NOT EXISTS `published_asset_links` (
  `token` CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Base64url of first 12 SHA-256 path bytes; collision checked',
  `oss_path` VARCHAR(800) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `created_by` VARCHAR(100) NOT NULL COMMENT 'Verified delegated user UID',
  `created_at` DATETIME(3) NOT NULL COMMENT 'Runtime UTC',
  PRIMARY KEY (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
