START TRANSACTION;

CREATE TABLE IF NOT EXISTS `tenant_subject_memberships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'runtime',
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `container_subject_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` VARCHAR(32) NOT NULL DEFAULT 'member',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_subject_memberships` (`tenant_code`, `source`, `subject_id`, `container_subject_id`, `relation_type`),
  KEY `idx_tenant_subject_memberships_subject` (`tenant_code`, `subject_id`, `status`),
  KEY `idx_tenant_subject_memberships_container` (`tenant_code`, `container_subject_id`, `status`),
  CONSTRAINT `fk_tenant_subject_memberships_subject`
    FOREIGN KEY (`subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`),
  CONSTRAINT `fk_tenant_subject_memberships_container`
    FOREIGN KEY (`container_subject_id`, `tenant_code`) REFERENCES `tenant_subjects` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
