-- Immutable Reach evidence, scoped to a product planning item and published model.
CREATE TABLE IF NOT EXISTS product_rice_reach_observations (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 model_version VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 scope_revision BIGINT UNSIGNED NOT NULL,
 evidence_revision BIGINT UNSIGNED NOT NULL,
 reach_count BIGINT UNSIGNED NOT NULL,
 snapshot JSON NOT NULL,
 recorded_by VARCHAR(64) NOT NULL,
 recorded_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_rice_observation_biz(biz_id),
 KEY idx_pc_rice_observation_list(product_code,planning_item_id,id),
 CONSTRAINT fk_pc_rice_observation_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT fk_pc_rice_observation_model FOREIGN KEY(product_code,model_version) REFERENCES product_priority_model_versions(product_code,version),
 CONSTRAINT ck_pc_rice_observation_revision CHECK(scope_revision>0 AND evidence_revision>0),
 CONSTRAINT ck_pc_rice_observation_count CHECK(reach_count<=1000000000),
 CONSTRAINT ck_pc_rice_observation_snapshot CHECK(JSON_TYPE(snapshot)='OBJECT'),
 CONSTRAINT ck_pc_rice_observation_recorder CHECK(CHAR_LENGTH(TRIM(recorded_by))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_rice_observation_no_update;
CREATE TRIGGER trg_pc_rice_observation_no_update BEFORE UPDATE ON product_rice_reach_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reach observations are immutable';
DROP TRIGGER IF EXISTS trg_pc_rice_observation_no_delete;
CREATE TRIGGER trg_pc_rice_observation_no_delete BEFORE DELETE ON product_rice_reach_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reach observation history cannot be deleted';
