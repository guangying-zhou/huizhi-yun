-- People G4-2: explicit offboarding cases/tasks and reliable notification checkpoints.
-- Repeatable migration. It intentionally does not backfill historical leave assignments.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `people_offboarding_cases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_code` VARCHAR(64) NOT NULL COMMENT '离职事项稳定业务键',
  `leave_assignment_code` VARCHAR(64) NOT NULL COMMENT '唯一绑定已生效或无需审批的离职任职记录',
  `employee_uid` VARCHAR(64) NOT NULL COMMENT '离职员工稳定 UID',
  `status` ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  `object_version` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户动作 CAS 版本，API 表达为 vN',
  `completed_at` DATETIME DEFAULT NULL,
  `completed_by` VARCHAR(64) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancelled_by` VARCHAR(64) DEFAULT NULL,
  `cancellation_reason` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_offboarding_case_code` (`case_code`),
  UNIQUE KEY `uk_people_offboarding_leave_assignment` (`leave_assignment_code`),
  KEY `idx_people_offboarding_employee_status` (`employee_uid`, `status`, `updated_at`),
  KEY `idx_people_offboarding_status` (`status`, `updated_at`, `id`),
  CONSTRAINT `fk_people_offboarding_assignment` FOREIGN KEY (`leave_assignment_code`) REFERENCES `people_assignments` (`assignment_code`),
  CONSTRAINT `fk_people_offboarding_employee` FOREIGN KEY (`employee_uid`) REFERENCES `people_employees` (`employee_uid`),
  CONSTRAINT `ck_people_offboarding_case_code` CHECK (
    `case_code` = TRIM(`case_code`) AND `case_code` <> '' AND LOWER(`case_code`) <> '@all'
    AND `leave_assignment_code` = TRIM(`leave_assignment_code`) AND `leave_assignment_code` <> ''
    AND `employee_uid` = TRIM(`employee_uid`) AND `employee_uid` <> '' AND LOWER(`employee_uid`) <> '@all'
    AND `object_version` > 0
  ),
  CONSTRAINT `ck_people_offboarding_case_actor` CHECK (
    `created_by` = TRIM(`created_by`) AND `created_by` <> '' AND LOWER(`created_by`) <> '@all'
    AND `updated_by` = TRIM(`updated_by`) AND `updated_by` <> '' AND LOWER(`updated_by`) <> '@all'
  ),
  CONSTRAINT `ck_people_offboarding_case_terminal_audit` CHECK (
    (`status` = 'active'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'completed'
      AND `completed_at` IS NOT NULL
      AND `completed_by` IS NOT NULL AND `completed_by` = TRIM(`completed_by`)
      AND `completed_by` <> '' AND LOWER(`completed_by`) <> '@all'
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'cancelled'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NOT NULL
      AND `cancelled_by` IS NOT NULL AND `cancelled_by` = TRIM(`cancelled_by`)
      AND `cancelled_by` <> '' AND LOWER(`cancelled_by`) <> '@all'
      AND `cancellation_reason` IS NOT NULL AND TRIM(`cancellation_reason`) <> '')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 离职事项；不复制 Console 账号或 Assets 资产事实';

CREATE TABLE IF NOT EXISTS `people_offboarding_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_code` VARCHAR(64) NOT NULL COMMENT '离职任务稳定业务键与通知授权 descriptor ID',
  `case_code` VARCHAR(64) NOT NULL,
  `task_type` ENUM('handover', 'asset_recovery_coordination') NOT NULL COMMENT '资产回收仅表示协调确认，不声明资产实际已回收',
  `responsible_uid` VARCHAR(64) NOT NULL COMMENT '唯一直接责任人；禁止部门或全员展开',
  `due_at` DATETIME NOT NULL,
  `status` ENUM('pending', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  `object_version` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户动作 CAS 版本，API 表达为 vN',
  `completed_at` DATETIME DEFAULT NULL,
  `completed_by` VARCHAR(64) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancelled_by` VARCHAR(64) DEFAULT NULL,
  `cancellation_reason` VARCHAR(500) DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `updated_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_offboarding_task_code` (`task_code`),
  UNIQUE KEY `uk_people_offboarding_case_type` (`case_code`, `task_type`),
  KEY `idx_people_offboarding_task_responsible` (`responsible_uid`, `status`, `due_at`, `id`),
  KEY `idx_people_offboarding_task_due_cursor` (`status`, `due_at`, `id`),
  CONSTRAINT `fk_people_offboarding_task_case` FOREIGN KEY (`case_code`) REFERENCES `people_offboarding_cases` (`case_code`) ON DELETE CASCADE,
  CONSTRAINT `ck_people_offboarding_task_code` CHECK (
    `task_code` = TRIM(`task_code`) AND `task_code` <> '' AND LOWER(`task_code`) <> '@all'
    AND `case_code` = TRIM(`case_code`) AND `case_code` <> ''
    AND `object_version` > 0
  ),
  CONSTRAINT `ck_people_offboarding_task_responsible` CHECK (
    `responsible_uid` = TRIM(`responsible_uid`)
    AND `responsible_uid` <> ''
    AND LOWER(`responsible_uid`) <> '@all'
  ),
  CONSTRAINT `ck_people_offboarding_task_actor` CHECK (
    `created_by` = TRIM(`created_by`) AND `created_by` <> '' AND LOWER(`created_by`) <> '@all'
    AND `updated_by` = TRIM(`updated_by`) AND `updated_by` <> '' AND LOWER(`updated_by`) <> '@all'
  ),
  CONSTRAINT `ck_people_offboarding_task_terminal_audit` CHECK (
    (`status` = 'pending'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'completed'
      AND `completed_at` IS NOT NULL
      AND `completed_by` IS NOT NULL AND `completed_by` = TRIM(`completed_by`)
      AND `completed_by` <> '' AND LOWER(`completed_by`) <> '@all'
      AND `cancelled_at` IS NULL AND `cancelled_by` IS NULL AND `cancellation_reason` IS NULL)
    OR
    (`status` = 'cancelled'
      AND `completed_at` IS NULL AND `completed_by` IS NULL
      AND `cancelled_at` IS NOT NULL
      AND `cancelled_by` IS NOT NULL AND `cancelled_by` = TRIM(`cancelled_by`)
      AND `cancelled_by` <> '' AND LOWER(`cancelled_by`) <> '@all'
      AND `cancellation_reason` IS NOT NULL AND TRIM(`cancellation_reason`) <> '')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 离职交接与资产回收协调任务';

CREATE TABLE IF NOT EXISTS `people_offboarding_notification_checkpoint` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_stream` ENUM('offboarding_handover_due', 'offboarding_asset_recovery_due') NOT NULL,
  `source_type` ENUM('offboarding_task') NOT NULL DEFAULT 'offboarding_task',
  `source_id` BIGINT UNSIGNED NOT NULL COMMENT 'people_offboarding_tasks.id',
  `condition_generation` BIGINT UNSIGNED NOT NULL,
  `phase` ENUM('D30', 'D7', 'D1', 'expired') NOT NULL,
  `source_version` CHAR(64) NOT NULL,
  `event_version` VARCHAR(191) NOT NULL,
  `previous_event_version` VARCHAR(191) DEFAULT NULL,
  `previous_recipient_uid` VARCHAR(64) DEFAULT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `due_at` DATETIME NOT NULL,
  `case_code` VARCHAR(64) NOT NULL,
  `task_code` VARCHAR(64) NOT NULL,
  `task_type` ENUM('handover', 'asset_recovery_coordination') NOT NULL,
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
  UNIQUE KEY `uk_people_offboarding_notification_event` (`event_version`),
  UNIQUE KEY `uk_people_offboarding_notification_idempotency` (`idempotency_key`),
  UNIQUE KEY `uk_people_offboarding_notification_phase` (`event_stream`, `source_type`, `source_id`, `condition_generation`, `phase`),
  KEY `idx_people_offboarding_notification_source` (`event_stream`, `source_type`, `source_id`, `state`, `condition_generation`),
  KEY `idx_people_offboarding_notification_closure` (`event_stream`, `state`, `close_reason`, `lifecycle_closed_at`, `closed_at`),
  KEY `idx_people_offboarding_notification_task` (`task_code`, `state`, `condition_generation`),
  CONSTRAINT `fk_people_offboarding_notification_task` FOREIGN KEY (`source_id`) REFERENCES `people_offboarding_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_people_offboarding_notification_identity` CHECK (
    `condition_generation` > 0
    AND `source_version` = TRIM(`source_version`) AND `source_version` <> ''
    AND `event_version` = TRIM(`event_version`) AND `event_version` <> ''
    AND `idempotency_key` = TRIM(`idempotency_key`) AND `idempotency_key` <> ''
    AND `actionable_key` = TRIM(`actionable_key`) AND `actionable_key` <> ''
    AND `case_code` = TRIM(`case_code`) AND `case_code` <> ''
    AND `task_code` = TRIM(`task_code`) AND `task_code` <> ''
    AND ((`event_stream` = 'offboarding_handover_due' AND `task_type` = 'handover')
      OR (`event_stream` = 'offboarding_asset_recovery_due' AND `task_type` = 'asset_recovery_coordination'))
  ),
  CONSTRAINT `ck_people_offboarding_notification_state` CHECK (
    (`state` = 'open' AND `close_reason` IS NULL AND `closed_at` IS NULL)
    OR (`state` = 'closed' AND `close_reason` IS NOT NULL AND `closed_at` IS NOT NULL)
  ),
  CONSTRAINT `ck_people_offboarding_notification_ack` CHECK (
    (`notification_id` IS NULL AND `notified_recipient_uid` IS NULL AND `acknowledged_at` IS NULL)
    OR (`notification_id` IS NOT NULL AND `notified_recipient_uid` IS NOT NULL AND `acknowledged_at` IS NOT NULL)
  ),
  CONSTRAINT `ck_people_offboarding_notification_lifecycle_ack` CHECK (
    (`lifecycle_next_version` IS NULL AND `lifecycle_closed_at` IS NULL)
    OR (`lifecycle_next_version` IS NOT NULL AND `lifecycle_closed_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 离职任务通知可靠检查点与投递确认事实';
