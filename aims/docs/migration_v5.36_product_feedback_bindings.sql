-- Formal feedback identity is separate from unrestricted manual source notes.
CREATE TABLE IF NOT EXISTS product_feedback_bindings (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 source_app VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_biz_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 request_id BIGINT UNSIGNED NOT NULL,
 source_id BIGINT UNSIGNED NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_feedback_origin(source_app,source_type,source_biz_id),
 UNIQUE KEY uk_pc_feedback_source(source_id),
 KEY idx_pc_feedback_product(product_code,id),
 CONSTRAINT fk_pc_feedback_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT fk_pc_feedback_request FOREIGN KEY(request_id) REFERENCES product_requests(id),
 CONSTRAINT fk_pc_feedback_source FOREIGN KEY(source_id) REFERENCES product_request_sources(id),
 CONSTRAINT ck_pc_feedback_origin CHECK(source_app='altoc' AND source_type='service_ticket' AND CHAR_LENGTH(TRIM(source_biz_id))>0),
 CONSTRAINT ck_pc_feedback_actor CHECK(CHAR_LENGTH(TRIM(created_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
