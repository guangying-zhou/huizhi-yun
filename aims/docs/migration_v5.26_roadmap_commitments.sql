-- Immutable roadmap commitment history. A changed commitment appends a successor.
-- Prerequisites: v5.19 planning entities and v5.25 exploration windows.
CREATE TABLE IF NOT EXISTS product_roadmap_commitments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 cycle_id BIGINT UNSIGNED NOT NULL,
 item_revision BIGINT UNSIGNED NOT NULL,
 scope_revision BIGINT UNSIGNED NOT NULL,
 evidence_revision BIGINT UNSIGNED NOT NULL,
 cycle_revision BIGINT UNSIGNED NOT NULL,
 queue_revision BIGINT UNSIGNED NOT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 item_snapshot JSON NOT NULL,
 decision_snapshot JSON NOT NULL,
 model_snapshot JSON NOT NULL,
 reason TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_roadmap_commitment_biz(biz_id),
 KEY idx_pc_roadmap_commitment_item(planning_item_id,product_code,id),
 KEY idx_pc_roadmap_commitment_cycle(cycle_id,product_code,id),
 CONSTRAINT fk_pc_roadmap_commitment_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT fk_pc_roadmap_commitment_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
 CONSTRAINT ck_pc_roadmap_commitment_revisions CHECK(item_revision>0 AND scope_revision>0 AND evidence_revision>0 AND cycle_revision>0 AND queue_revision>0),
 CONSTRAINT ck_pc_roadmap_commitment_dates CHECK(ends_on>=starts_on),
 CONSTRAINT ck_pc_roadmap_commitment_reason CHECK(CHAR_LENGTH(TRIM(reason))>0 AND CHAR_LENGTH(TRIM(created_by))>0),
 CONSTRAINT ck_pc_roadmap_commitment_snapshots CHECK(JSON_TYPE(item_snapshot)='OBJECT' AND JSON_TYPE(decision_snapshot)='OBJECT' AND JSON_TYPE(model_snapshot)='OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_roadmap_commitment_no_update;
CREATE TRIGGER trg_pc_roadmap_commitment_no_update BEFORE UPDATE ON product_roadmap_commitments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap commitments are immutable';
DROP TRIGGER IF EXISTS trg_pc_roadmap_commitment_no_delete;
CREATE TRIGGER trg_pc_roadmap_commitment_no_delete BEFORE DELETE ON product_roadmap_commitments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap commitment history cannot be deleted';
