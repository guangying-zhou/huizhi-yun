-- People Connector Runtime sync receipts (2026-07-14). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS `people_connector_sync_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_id` VARCHAR(128) NOT NULL,
  `batch_number` INT UNSIGNED NOT NULL,
  `batch_hash` CHAR(64) NOT NULL,
  `provider_code` VARCHAR(32) NOT NULL,
  `integration_code` VARCHAR(128) NOT NULL,
  `status` ENUM('processing','success','failed') NOT NULL,
  `applied_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `skipped_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_final` TINYINT(1) NOT NULL DEFAULT 0,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_connector_sync_batch` (`job_id`,`batch_number`),
  KEY `idx_people_connector_sync_status` (`status`,`updated_at`),
  CONSTRAINT `ck_people_connector_sync_final` CHECK (`is_final` IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Connector Runtime 钉钉 People 同步批次幂等回执';
