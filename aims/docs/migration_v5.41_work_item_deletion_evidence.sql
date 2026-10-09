-- Work-item deletion evidence retains frozen facts after the owning row is removed.
-- Unified installers map this logical table to aims_work_item_deletion_evidence.
CREATE TABLE IF NOT EXISTS `work_item_deletion_evidence` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL,
  `expected_version` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `snapshot_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `detached_children_json` JSON NOT NULL,
  `actor_uid` VARCHAR(100) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `operation_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `command_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wide_operation` (`operation_id`),
  KEY `idx_wide_project_created` (`project_id`,`created_at`),
  KEY `idx_wide_item` (`work_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项删除冻结证据；不随工作项/项目物理删除级联清除';
