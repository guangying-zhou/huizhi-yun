-- Console SQL Migration v1.9: Account compatibility runtime tables.
-- Date: 2026-05-01
-- Purpose:
--   Support Account-compatible heartbeat/online and cross-module clipboard APIs
--   inside Console, so apps can stop depending on Account for common runtime services.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `local_presence_heartbeats` (
  `uid` VARCHAR(64) NOT NULL,
  `source_app` VARCHAR(64) NOT NULL,
  `page_path` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`, `source_app`),
  KEY `idx_local_presence_last_seen` (`last_seen_at`),
  KEY `idx_local_presence_status` (`status`),
  CONSTRAINT `fk_local_presence_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_local_presence_status`
    CHECK (`status` IN ('active', 'idle', 'offline'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `runtime_clipboards` (
  `uid` VARCHAR(64) NOT NULL,
  `content` MEDIUMTEXT NOT NULL,
  `content_type` VARCHAR(32) NOT NULL DEFAULT 'markdown',
  `source_app` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`uid`),
  KEY `idx_runtime_clipboards_expires` (`expires_at`),
  CONSTRAINT `fk_runtime_clipboards_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
