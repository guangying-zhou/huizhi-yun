-- Assets resource/IP expiry notification checkpoint (repeatable incremental migration).
-- Safe to run repeatedly against hzy_assets; it does not backfill or dispatch notifications.
USE `hzy_assets`;

CREATE TABLE IF NOT EXISTS `assets_notification_checkpoint` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_stream` ENUM('resource_expiry', 'ip_expiry') NOT NULL,
  `source_type` ENUM('asset_item', 'ip_asset') NOT NULL,
  `source_id` BIGINT UNSIGNED NOT NULL,
  `condition_generation` BIGINT UNSIGNED NOT NULL,
  `phase` ENUM('D30', 'D7', 'D1', 'expired') NOT NULL,
  `source_version` CHAR(64) NOT NULL,
  `event_version` VARCHAR(96) NOT NULL,
  `previous_event_version` VARCHAR(96) DEFAULT NULL,
  `previous_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `due_at` DATETIME NOT NULL,
  `source_code` VARCHAR(64) NOT NULL,
  `source_name` VARCHAR(255) NOT NULL,
  `recipient_candidates_json` JSON NOT NULL,
  `state` ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  `close_reason` ENUM('superseded', 'condition_resolved', 'condition_cancelled') DEFAULT NULL,
  `closed_at` DATETIME DEFAULT NULL,
  `notification_id` VARCHAR(191) DEFAULT NULL,
  `notified_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `acknowledged_at` DATETIME DEFAULT NULL,
  `lifecycle_next_version` VARCHAR(191) DEFAULT NULL,
  `lifecycle_closed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_assets_notification_event_version` (`event_version`),
  UNIQUE KEY `uk_assets_notification_idempotency` (`idempotency_key`),
  UNIQUE KEY `uk_assets_notification_phase` (`event_stream`, `source_type`, `source_id`, `condition_generation`, `phase`),
  KEY `idx_assets_notification_source_state` (`event_stream`, `source_type`, `source_id`, `state`, `condition_generation`),
  KEY `idx_assets_notification_closure` (`event_stream`, `state`, `close_reason`, `lifecycle_closed_at`, `closed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Assets 到期通知检查点与投递确认事实';

SET @has_resource_cursor_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_resource_details'
    AND INDEX_NAME = 'idx_resource_expire_cursor'
);
SET @resource_cursor_sql := IF(
  @has_resource_cursor_index = 0,
  'ALTER TABLE `asset_resource_details` ADD KEY `idx_resource_expire_cursor` (`expires_at`, `asset_id`)',
  'SELECT 1'
);
PREPARE resource_cursor_stmt FROM @resource_cursor_sql;
EXECUTE resource_cursor_stmt;
DEALLOCATE PREPARE resource_cursor_stmt;

SET @has_ip_cursor_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_assets'
    AND INDEX_NAME = 'idx_ip_status_expire_cursor'
);
SET @ip_cursor_sql := IF(
  @has_ip_cursor_index = 0,
  'ALTER TABLE `ip_assets` ADD KEY `idx_ip_status_expire_cursor` (`status`, `expires_at`, `id`)',
  'SELECT 1'
);
PREPARE ip_cursor_stmt FROM @ip_cursor_sql;
EXECUTE ip_cursor_stmt;
DEALLOCATE PREPARE ip_cursor_stmt;
