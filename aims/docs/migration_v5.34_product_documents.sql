-- Product/document index only. This relation never grants Codocs ACL or stores content.
CREATE TABLE IF NOT EXISTS product_documents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 purpose VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 removed_at DATETIME(3) NULL,
 removed_by VARCHAR(64) NULL,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_document_biz(biz_id),
 UNIQUE KEY uk_pc_document_uuid(product_code,document_uuid),
 KEY idx_pc_document_list(product_code,removed_at,purpose,id),
 CONSTRAINT fk_pc_document_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_document_purpose CHECK(purpose IN ('product-overview','requirements','design','release-notes','user-guide','other')),
 CONSTRAINT ck_pc_document_revision CHECK(revision>0),
 CONSTRAINT ck_pc_document_removed CHECK((removed_at IS NULL AND removed_by IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND CHAR_LENGTH(TRIM(removed_by))>0)),
 CONSTRAINT ck_pc_document_actors CHECK(CHAR_LENGTH(TRIM(created_by))>0 AND CHAR_LENGTH(TRIM(updated_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
