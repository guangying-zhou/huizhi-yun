-- Aims v5.2: SLA / high-risk work-item due notification source checkpoints.
-- Repeatable: table creation and index additions are guarded by metadata checks.

CREATE TABLE IF NOT EXISTS `aims_notification_checkpoint` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_stream` ENUM('response_due','resolution_due','work_item_due') NOT NULL,
  `source_id` BIGINT UNSIGNED NOT NULL COMMENT 'work_items.id',
  `condition_generation` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同一工作项/事件流的条件代次',
  `phase` VARCHAR(16) NOT NULL COMMENT 'T-4h/T-1h/breached 或 D3/D1/overdue',
  `source_version` CHAR(64) NOT NULL,
  `event_version` VARCHAR(64) NOT NULL,
  `previous_event_version` VARCHAR(64) DEFAULT NULL COMMENT '同代次上一提醒阶段，用于 pending projection CAS supersede',
  `previous_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `due_at` DATETIME NOT NULL,
  `work_item_status` VARCHAR(32) NOT NULL,
  `priority` VARCHAR(16) NOT NULL,
  `severity` VARCHAR(16) DEFAULT NULL,
  `assignee_uid` VARCHAR(64) DEFAULT NULL,
  `project_leader_uid` VARCHAR(64) DEFAULT NULL,
  `dept_code` VARCHAR(64) DEFAULT NULL,
  `state` ENUM('open','closed') NOT NULL DEFAULT 'open',
  `close_reason` ENUM('superseded','condition_resolved','condition_cancelled') DEFAULT NULL,
  `notification_id` VARCHAR(128) DEFAULT NULL,
  `notified_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME DEFAULT NULL,
  `acknowledged_at` DATETIME DEFAULT NULL,
  `lifecycle_next_version` VARCHAR(191) DEFAULT NULL,
  `lifecycle_closed_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aims_notification_event_version` (`event_version`),
  UNIQUE KEY `uk_aims_notification_idempotency` (`idempotency_key`),
  KEY `idx_aims_notification_open_source` (`event_stream`, `state`, `source_id`),
  KEY `idx_aims_notification_generation` (`event_stream`, `source_id`, `condition_generation`, `id`),
  KEY `idx_aims_notification_due_cursor` (`event_stream`, `due_at`, `source_id`),
  KEY `idx_aims_notification_lifecycle` (`event_stream`, `state`, `lifecycle_closed_at`, `closed_at`),
  CONSTRAINT `fk_aims_notification_work_item` FOREIGN KEY (`source_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims SLA/高风险工作项通知 checkpoint';

DROP PROCEDURE IF EXISTS `aims_v52_add_index`;
DELIMITER $$
CREATE PROCEDURE `aims_v52_add_index`(
  IN table_name_value VARCHAR(64),
  IN index_name_value VARCHAR(64),
  IN ddl_value TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = table_name_value
      AND index_name = index_name_value
  ) THEN
    SET @aims_v52_ddl = ddl_value;
    PREPARE aims_v52_stmt FROM @aims_v52_ddl;
    EXECUTE aims_v52_stmt;
    DEALLOCATE PREPARE aims_v52_stmt;
  END IF;
END$$
DELIMITER ;

CALL `aims_v52_add_index`(
  'work_items',
  'idx_work_items_due_scan',
  'ALTER TABLE `work_items` ADD KEY `idx_work_items_due_scan` (`due_date`, `status`, `priority`, `severity`, `id`)'
);
CALL `aims_v52_add_index`(
  'work_item_service_ext',
  'idx_svc_ext_response_due',
  'ALTER TABLE `work_item_service_ext` ADD KEY `idx_svc_ext_response_due` (`response_due_at`, `work_item_id`)'
);
CALL `aims_v52_add_index`(
  'work_item_service_ext',
  'idx_svc_ext_resolution_due',
  'ALTER TABLE `work_item_service_ext` ADD KEY `idx_svc_ext_resolution_due` (`resolution_due_at`, `work_item_id`)'
);

DROP PROCEDURE IF EXISTS `aims_v52_add_index`;
