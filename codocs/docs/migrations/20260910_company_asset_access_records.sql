-- Codocs tenant-runtime database, MySQL 8.0+.
-- Apply before deploying the runtime and Codocs preview audit code.
-- No historical reads are inferred or backfilled.
CREATE TABLE IF NOT EXISTS `company_asset_access_records` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'BFF-generated event UUID; retry key',
  `oss_path_hash` BINARY(32) NOT NULL COMMENT 'SHA-256 of exact OSS path',
  `oss_path` VARCHAR(800) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `viewer_uid` VARCHAR(100) NOT NULL COMMENT 'Verified delegated user UID',
  `viewed_at` DATETIME(3) NOT NULL COMMENT 'Runtime UTC; content response prepared successfully',
  PRIMARY KEY (`id`),
  KEY `idx_asset_access_path_time` (`oss_path_hash`, `viewed_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
