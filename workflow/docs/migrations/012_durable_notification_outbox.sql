-- Workflow 待办创建通知可靠 outbox：实例发起、节点推进、委托、重提时
-- 在同一业务事务写入创建通知，定时 drain 重发直至 Console 确认；
-- 同一 actionable_key 的生命周期 CAS 须等创建通知投递后再发送。
-- 须先于包含该表必需检查的 Runtime 版本执行。

CREATE TABLE IF NOT EXISTS `flow_notification_outbox` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `instance_id` BIGINT UNSIGNED NOT NULL,
    `action_id` BIGINT UNSIGNED NULL,
    `actionable_key` VARCHAR(191) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `notification` JSON NOT NULL,
    `delivery_status` ENUM('pending','delivered') NOT NULL DEFAULT 'pending',
    `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME NULL,
    `delivered_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_notification_outbox_idempotency` (`idempotency_key`),
    INDEX `idx_notification_outbox_delivery` (`delivery_status`, `id`),
    INDEX `idx_notification_outbox_actionable` (`actionable_key`, `delivery_status`),
    CONSTRAINT `fk_notification_outbox_instance` FOREIGN KEY (`instance_id`) REFERENCES `flow_instances`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Workflow 待办创建通知事务 outbox';
