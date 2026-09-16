-- G4-2 Console Directory -> Platform lifecycle actionable outbox.
-- Run only through the approved tenant migration procedure. This migration is
-- repeatable and deliberately does not infer or rewrite historical portal
-- projections; only future Console-owned dead-letter operations are enrolled.

CREATE TABLE IF NOT EXISTS `console_platform_lifecycle_actionables` (
  `operation_id` CHAR(36) NOT NULL,
  `generation` INT UNSIGNED NOT NULL DEFAULT 1,
  `actionable_key` VARCHAR(191) NOT NULL,
  `object_version` VARCHAR(191) NOT NULL,
  `recipient_uids_json` JSON NULL,
  `notification_id` VARCHAR(64) NULL,
  `published_at` DATETIME(3) NULL,
  `closure_state` VARCHAR(16) NULL,
  `closure_acknowledged_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operation_id`, `generation`),
  KEY `idx_console_platform_lifecycle_actionable_pending` (`notification_id`, `closure_acknowledged_at`, `updated_at`),
  CONSTRAINT `fk_console_platform_lifecycle_actionable_operation`
    FOREIGN KEY (`operation_id`) REFERENCES `integration_operation` (`operation_id`) ON DELETE CASCADE,
  CONSTRAINT `ck_console_platform_lifecycle_actionable_closure`
    CHECK (`closure_state` IS NULL OR `closure_state` IN ('resolved', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
