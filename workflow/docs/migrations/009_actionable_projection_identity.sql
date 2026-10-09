ALTER TABLE `flow_tasks`
	ADD COLUMN `generation_key` VARCHAR(191) NULL COMMENT '同一次节点进入创建的 task generation 身份' AFTER `status`,
	ADD COLUMN `actionable_key` VARCHAR(191) NULL COMMENT 'Console 待办投影的精确 task generation 身份' AFTER `generation_key`,
    ADD COLUMN `actionable_version` VARCHAR(191) NULL COMMENT 'Console 待办投影 CAS 版本' AFTER `actionable_key`,
	ADD INDEX `idx_task_generation` (`instance_id`, `generation_key`),
    ADD INDEX `idx_actionable_identity` (`actionable_key`, `actionable_version`);

UPDATE `flow_tasks` AS task
JOIN (
    SELECT instance_id,
           node_index,
           SHA2(GROUP_CONCAT(id ORDER BY id SEPARATOR ','), 256) AS generation_hash
    FROM `flow_tasks`
    WHERE status = 'pending'
    GROUP BY instance_id, node_index
) AS generation
  ON generation.instance_id = task.instance_id
 AND generation.node_index = task.node_index
SET task.actionable_key = CONCAT('workflow:tasks:sha256:', generation.generation_hash),
	task.actionable_version = CONCAT('flow_tasks:sha256:', generation.generation_hash),
	task.generation_key = CONCAT('workflow:tasks:sha256:', generation.generation_hash)
WHERE task.status = 'pending';

UPDATE `flow_tasks` AS task
JOIN (
    SELECT task_id, MAX(id) AS action_id
    FROM `flow_actions`
    WHERE action = 'delegate' AND task_id IS NOT NULL
    GROUP BY task_id
) AS delegated
  ON delegated.task_id = task.id
SET task.actionable_key = CONCAT(
        'workflow:tasks:sha256:',
        SHA2(CAST(task.id AS CHAR), 256)
    ),
    task.actionable_version = CONCAT('flow_actions:', delegated.action_id)
WHERE task.status = 'pending';

CREATE TABLE `flow_actionable_outbox` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `instance_id` BIGINT UNSIGNED NOT NULL,
    `action_id` BIGINT UNSIGNED NULL,
    `actionable_key` VARCHAR(191) NOT NULL,
    `expected_version` VARCHAR(191) NOT NULL,
    `next_version` VARCHAR(191) NOT NULL,
    `next_state` ENUM('resolved','cancelled') NOT NULL,
    `recipients` JSON NOT NULL,
	`prerequisite_notifications` JSON NOT NULL,
    `delivery_status` ENUM('pending','delivered') NOT NULL DEFAULT 'pending',
    `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME NULL,
    `delivered_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_actionable_outbox_delivery` (`delivery_status`, `id`),
    INDEX `idx_actionable_outbox_instance` (`instance_id`, `id`),
    CONSTRAINT `fk_actionable_outbox_instance` FOREIGN KEY (`instance_id`) REFERENCES `flow_instances`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_actionable_outbox_action` FOREIGN KEY (`action_id`) REFERENCES `flow_actions`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Workflow 到 Console 待办生命周期事务 outbox';
