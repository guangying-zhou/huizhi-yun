-- Additive only. Review unified physical mapping before applying; never auto-run.
CREATE TABLE IF NOT EXISTS `work_item_completion_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `requested_by` VARCHAR(64) NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `snapshot_sha256` CHAR(64) NOT NULL,
  `review_version` CHAR(64) NOT NULL,
  `status` ENUM('queued','running','approved','rejected','cancelled') NOT NULL,
  `workflow_instance_id` BIGINT UNSIGNED DEFAULT NULL,
  `workflow_instance_no` VARCHAR(64) DEFAULT NULL,
  `target_receipt_id` VARCHAR(64) DEFAULT NULL,
  `operation_key` VARCHAR(191) NOT NULL,
  `active_work_item_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` IN ('queued','running') THEN `work_item_id` ELSE NULL END) STORED,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_completion_active_item` (`active_work_item_id`),
  UNIQUE KEY `uk_completion_operation` (`operation_key`),
  KEY `idx_completion_project` (`project_id`,`id`),
  CONSTRAINT `fk_completion_work_item` FOREIGN KEY (`project_id`,`work_item_id`) REFERENCES `work_items` (`project_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='冻结工作项完成审批请求及可靠回执';
