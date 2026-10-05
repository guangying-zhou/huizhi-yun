-- Repeatable migration: add the current actionable projection without changing
-- immutable portal notification or recipient read/archive history.
--
-- Console uses one tenant database connection per request/deployment. The same
-- isolation boundary applies to this table; tenant/deployment are intentionally
-- not accepted from notification payloads as database partition keys.

CREATE TABLE IF NOT EXISTS `portal_actionable_projections` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NOT NULL,
  `source_app_code` VARCHAR(64) NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `target_app_code` VARCHAR(64) NULL,
  `biz_type` VARCHAR(64) NOT NULL,
  `biz_id` VARCHAR(128) NOT NULL,
  `business_key` VARCHAR(320) NOT NULL,
  `current_notification_id` VARCHAR(64) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `object_version` VARCHAR(191) NOT NULL,
  `closed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portal_actionable_projection` (`uid`, `source_app_code`, `actionable_key`),
  KEY `idx_portal_actionable_projection_uid_state` (`uid`, `state`, `updated_at`),
  KEY `idx_portal_actionable_projection_business` (`source_app_code`, `biz_type`, `biz_id`),
  CONSTRAINT `fk_portal_actionable_projection_notification`
    FOREIGN KEY (`current_notification_id`) REFERENCES `portal_notifications` (`notification_id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_portal_actionable_projection_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_portal_actionable_projection_state`
    CHECK (`state` IN ('pending', 'resolved', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
