-- Product-owned creation requests reference the existing caller operation.
-- Frozen title/template/actor and target receipt stay in integration_operation;
-- this table only records the product purpose and resulting relation.
CREATE TABLE IF NOT EXISTS product_document_creation_requests (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 operation_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
 document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 purpose VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 relation_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 linked_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_doc_creation_request(biz_id),
 UNIQUE KEY uk_pc_doc_creation_operation(operation_id),
 UNIQUE KEY uk_pc_doc_creation_target(document_uuid),
 UNIQUE KEY uk_pc_doc_creation_relation(relation_biz_id),
 KEY idx_pc_doc_creation_product(product_code,id),
 CONSTRAINT fk_pc_doc_creation_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT fk_pc_doc_creation_operation FOREIGN KEY(operation_id) REFERENCES integration_operation(operation_id),
 CONSTRAINT fk_pc_doc_creation_relation FOREIGN KEY(relation_biz_id) REFERENCES product_documents(biz_id),
 CONSTRAINT ck_pc_doc_creation_purpose CHECK(purpose IN ('product-overview','requirements','design','release-notes','user-guide','other')),
 CONSTRAINT ck_pc_doc_creation_actor CHECK(CHAR_LENGTH(TRIM(created_by))>0),
 CONSTRAINT ck_pc_doc_creation_link CHECK((relation_biz_id IS NULL AND linked_at IS NULL) OR (relation_biz_id IS NOT NULL AND linked_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
