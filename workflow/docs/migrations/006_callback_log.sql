-- ============================================================
-- Migration: 006_callback_log
-- Purpose: 回调日志表，记录回调结果用于补偿和排查
-- Date: 2026-04-01
-- ============================================================

CREATE TABLE IF NOT EXISTS `flow_callback_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `instance_id` BIGINT UNSIGNED NOT NULL COMMENT '流程实例ID',
  `callback_url` VARCHAR(500) NOT NULL COMMENT '回调地址',
  `event` VARCHAR(50) NOT NULL COMMENT '事件类型',
  `status` ENUM('success', 'failed', 'pending') NOT NULL DEFAULT 'pending',
  `attempts` INT NOT NULL DEFAULT 0 COMMENT '尝试次数',
  `last_error` TEXT NULL COMMENT '最后一次错误信息',
  `payload` JSON NULL COMMENT '回调payload',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_instance` (`instance_id`),
  INDEX `idx_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
