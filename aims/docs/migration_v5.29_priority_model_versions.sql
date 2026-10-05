-- Product-owned immutable scoring versions. Existing cycle/assessment snapshots
-- remain authoritative; this migration does not recompute or reorder anything.
CREATE TABLE IF NOT EXISTS product_priority_model_versions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 version VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 title VARCHAR(200) NOT NULL,
 method VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
 configuration JSON NOT NULL,
 reason TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_priority_model_biz(biz_id),
 UNIQUE KEY uk_pc_priority_model_version(product_code,version),
 KEY idx_pc_priority_model_list(product_code,id),
 CONSTRAINT fk_pc_priority_model_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_priority_model_text CHECK(CHAR_LENGTH(TRIM(version))>0 AND CHAR_LENGTH(TRIM(title))>0 AND CHAR_LENGTH(TRIM(reason))>0 AND CHAR_LENGTH(TRIM(created_by))>0),
 CONSTRAINT ck_pc_priority_model_method CHECK(method IN ('weighted-value-effort','rice')),
 CONSTRAINT ck_pc_priority_model_config CHECK(JSON_TYPE(configuration)='OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_priority_model_no_update;
CREATE TRIGGER trg_pc_priority_model_no_update BEFORE UPDATE ON product_priority_model_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Priority model versions are immutable';
DROP TRIGGER IF EXISTS trg_pc_priority_model_no_delete;
CREATE TRIGGER trg_pc_priority_model_no_delete BEFORE DELETE ON product_priority_model_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Priority model history cannot be deleted';
