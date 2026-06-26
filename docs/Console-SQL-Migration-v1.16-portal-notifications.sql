-- Console SQL Migration v1.16: portal notifications / unified message center.
-- Date: 2026-06-13
-- Purpose:
--   Add Console employee-portal notification inbox tables and authorize
--   active app service clients to publish notifications.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portal_notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notification_id` VARCHAR(64) NOT NULL,
  `source_app_code` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(128) NULL,
  `category` VARCHAR(64) NOT NULL DEFAULT 'general',
  `severity` VARCHAR(32) NOT NULL DEFAULT 'info',
  `title` VARCHAR(255) NOT NULL,
  `summary` VARCHAR(1000) NULL,
  `body` TEXT NULL,
  `action_url` VARCHAR(1000) NULL,
  `biz_type` VARCHAR(64) NULL,
  `biz_id` VARCHAR(128) NULL,
  `idempotency_key` VARCHAR(191) NULL,
  `metadata_json` JSON NULL,
  `created_by` VARCHAR(128) NULL,
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portal_notifications_id` (`notification_id`),
  UNIQUE KEY `uk_portal_notifications_idempotency` (`source_app_code`, `idempotency_key`),
  KEY `idx_portal_notifications_source_time` (`source_app_code`, `created_at`),
  KEY `idx_portal_notifications_category_time` (`category`, `created_at`),
  KEY `idx_portal_notifications_biz` (`biz_type`, `biz_id`),
  CONSTRAINT `ck_portal_notifications_severity`
    CHECK (`severity` IN ('info', 'success', 'warning', 'error'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portal_notification_recipients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notification_id` VARCHAR(64) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `delivery_state` VARCHAR(32) NOT NULL DEFAULT 'unread',
  `read_at` DATETIME NULL,
  `archived_at` DATETIME NULL,
  `pinned_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portal_notification_recipients_uid` (`notification_id`, `uid`),
  KEY `idx_portal_notification_recipients_uid_read` (`uid`, `read_at`, `archived_at`, `id`),
  KEY `idx_portal_notification_recipients_uid_archive` (`uid`, `archived_at`, `id`),
  CONSTRAINT `fk_portal_notification_recipients_notification`
    FOREIGN KEY (`notification_id`) REFERENCES `portal_notifications` (`notification_id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_portal_notification_recipients_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_portal_notification_recipients_state`
    CHECK (`delivery_state` IN ('unread', 'read', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portal_notification_deliveries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notification_id` VARCHAR(64) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `channel` VARCHAR(32) NOT NULL,
  `provider` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempt_count` INT NOT NULL DEFAULT 0,
  `last_error` VARCHAR(1000) NULL,
  `sent_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_portal_notification_deliveries_notification` (`notification_id`, `channel`, `status`),
  KEY `idx_portal_notification_deliveries_uid` (`uid`, `created_at`),
  CONSTRAINT `fk_portal_notification_deliveries_notification`
    FOREIGN KEY (`notification_id`) REFERENCES `portal_notifications` (`notification_id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_portal_notification_deliveries_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_portal_notification_deliveries_status`
    CHECK (`status` IN ('pending', 'success', 'failed', 'skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  'notifications',
  'publish',
  JSON_OBJECT('source', 'migration:v1.16'),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients`
WHERE `status` = 'active'
  AND (`client_type` = 'app' OR `app_code` IS NOT NULL)
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
