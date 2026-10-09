USE `hzy_console`;

CREATE TABLE IF NOT EXISTS `console_runtime_cache` (
  `cache_key` VARCHAR(128) NOT NULL COMMENT '带 scope 的 Console 运行时缓存键，例如 deploymentCode:policy_bundle',
  `payload_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`cache_key`),
  KEY `idx_console_runtime_cache_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
