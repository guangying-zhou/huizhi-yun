-- Aims v4.8 - 周期性里程碑 rollover 快照
-- 目标：
-- 1. 保存 periodic 里程碑关期时的统计快照；
-- 2. 用 project_id + template_key + period_start 和 idempotency_key 兜底重复触发。

CREATE TABLE IF NOT EXISTS `milestone_cycle_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `source_milestone_id` BIGINT UNSIGNED NOT NULL COMMENT '关期来源里程碑',
  `next_milestone_id` BIGINT UNSIGNED NOT NULL COMMENT '新周期里程碑',
  `template_key` VARCHAR(100) NOT NULL COMMENT '周期模板键',
  `period_start` DATE NOT NULL COMMENT '新周期开始日期',
  `period_end` DATE NOT NULL COMMENT '新周期结束日期',
  `carryover_mode` ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  `completed_count` INT NOT NULL DEFAULT 0,
  `carryover_count` INT NOT NULL DEFAULT 0,
  `total_work_items` INT NOT NULL DEFAULT 0,
  `total_hours` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `idempotency_key` VARCHAR(180) NOT NULL,
  `source_app` VARCHAR(32) NOT NULL DEFAULT 'aims',
  `source_biz_type` VARCHAR(64) NOT NULL DEFAULT 'milestone_rollover',
  `source_biz_code` VARCHAR(180) NOT NULL,
  `request_id` VARCHAR(100) DEFAULT NULL,
  `actor_uid` VARCHAR(64) DEFAULT NULL,
  `service_client_id` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cycle_project_template_period` (`project_id`, `template_key`, `period_start`),
  UNIQUE KEY `uk_cycle_idempotency` (`idempotency_key`),
  KEY `idx_cycle_source_milestone` (`source_milestone_id`),
  KEY `idx_cycle_next_milestone` (`next_milestone_id`),
  CONSTRAINT `fk_cycle_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cycle_source_milestone` FOREIGN KEY (`source_milestone_id`) REFERENCES `milestones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cycle_next_milestone` FOREIGN KEY (`next_milestone_id`) REFERENCES `milestones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周期性里程碑关期快照';
