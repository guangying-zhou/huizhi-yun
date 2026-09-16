-- Private immutable predecessor evidence. Read only after authorization of the
-- commitment's source product and each predecessor product; never raw-forward
-- this table through the general commitment history endpoint.
CREATE TABLE IF NOT EXISTS product_roadmap_cross_dependency_snapshots (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 commitment_id BIGINT UNSIGNED NOT NULL,
 dependency_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 dependency_revision BIGINT UNSIGNED NOT NULL,
 predecessor_product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 predecessor_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 predecessor_revision BIGINT UNSIGNED NOT NULL,
 snapshot JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_roadmap_cross_snapshot_edge(commitment_id,dependency_biz_id),
 KEY idx_pc_roadmap_cross_snapshot_scope(commitment_id,predecessor_product_code,id),
 CONSTRAINT fk_pc_roadmap_cross_snapshot_commitment FOREIGN KEY(commitment_id) REFERENCES product_roadmap_commitments(id),
 CONSTRAINT fk_pc_roadmap_cross_snapshot_product FOREIGN KEY(predecessor_product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_roadmap_cross_snapshot_revisions CHECK(dependency_revision>0 AND predecessor_revision>0),
 CONSTRAINT ck_pc_roadmap_cross_snapshot_json CHECK(JSON_TYPE(snapshot)='OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_roadmap_cross_snapshot_no_update;
CREATE TRIGGER trg_pc_roadmap_cross_snapshot_no_update BEFORE UPDATE ON product_roadmap_cross_dependency_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap predecessor snapshots are immutable';
DROP TRIGGER IF EXISTS trg_pc_roadmap_cross_snapshot_no_delete;
CREATE TRIGGER trg_pc_roadmap_cross_snapshot_no_delete BEFORE DELETE ON product_roadmap_cross_dependency_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Roadmap predecessor history cannot be deleted';
