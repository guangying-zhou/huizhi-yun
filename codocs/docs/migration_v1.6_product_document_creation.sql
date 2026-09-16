-- Product template creation preparation. No document is published by this table.
-- Freeze one template snapshot before uploading; finalize document + owner ACL +
-- succeeded service_command_receipt in one transaction after upload succeeds.
CREATE TABLE IF NOT EXISTS product_document_creation (
  operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  identity_sha256 BINARY(32) NOT NULL,
  command_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(200) NOT NULL,
  template_content MEDIUMTEXT NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_size INT UNSIGNED NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'prepared',
  published_oss_path VARCHAR(1000) DEFAULT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_product_document_creation_identity (identity_sha256),
  UNIQUE KEY uk_product_document_creation_target (document_uuid),
  CONSTRAINT chk_product_document_creation_state CHECK (
    (state = 'prepared' AND published_oss_path IS NULL AND completed_at IS NULL)
    OR (state = 'completed' AND published_oss_path IS NOT NULL AND CHAR_LENGTH(published_oss_path) > 0 AND completed_at IS NOT NULL)
  ),
  CONSTRAINT chk_product_document_creation_distinct CHECK (document_uuid <> template_uuid),
  CONSTRAINT chk_product_document_creation_snapshot CHECK (
    content_size = OCTET_LENGTH(template_content)
    AND content_sha256 = SHA2(template_content, 256)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品模板创建冻结快照；不是文档或ACL事实源';
