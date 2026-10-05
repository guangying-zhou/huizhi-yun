-- Additive migration; apply only after review to the intended Aims schema.
CREATE TABLE IF NOT EXISTS `project_activity_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `object_type` VARCHAR(32) NOT NULL,
  `object_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `actor_uid` VARCHAR(64) NOT NULL,
  `changes` JSON NOT NULL,
  `request_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_project_activity` (`project_id`, `id`),
  CONSTRAINT `fk_project_activity_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目及成员追加式业务审计';
