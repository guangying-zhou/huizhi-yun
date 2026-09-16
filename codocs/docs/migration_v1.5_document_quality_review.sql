-- v1.5: deterministic document-version hashes and Aims quality-review grants.
-- Existing rows remain nullable until an operator backfills hashes from OSS.
-- Runtime rejects every new version write that does not carry a valid SHA-256.

SET @has_content_sha256 := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'document_versions'
    AND COLUMN_NAME = 'content_sha256'
);
SET @ddl := IF(
  @has_content_sha256 = 0,
  'ALTER TABLE `document_versions` ADD COLUMN `content_sha256` CHAR(64) NULL COMMENT ''确定版本 Markdown 内容 SHA-256；历史版本补算前可为空'' AFTER `content_size`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `document_review_grants` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `document_id` BIGINT UNSIGNED NOT NULL,
  `document_version_id` BIGINT UNSIGNED NOT NULL,
  `document_uuid` CHAR(36) NOT NULL,
  `submission_no` VARCHAR(100) NOT NULL,
  `grantee_role_code` VARCHAR(64) NOT NULL,
  `source_app` VARCHAR(32) NOT NULL DEFAULT 'aims',
  `granted_by` VARCHAR(64) NOT NULL,
  `granted_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `revoked_at` DATETIME(6) NULL,
  `revoked_by` VARCHAR(64) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uk_document_review_grant` (`submission_no`, `document_version_id`, `grantee_role_code`),
  KEY `idx_document_review_grant_active` (`document_uuid`, `document_version_id`, `grantee_role_code`, `revoked_at`),
  CONSTRAINT `fk_document_review_grant_document`
    FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_document_review_grant_version`
    FOREIGN KEY (`document_version_id`) REFERENCES `document_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Aims 确定文档版本只读评审授权';
