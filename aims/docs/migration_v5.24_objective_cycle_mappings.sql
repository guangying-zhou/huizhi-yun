-- Product objective / planning cycle mapping. Preserve both definitions at mapping time.
-- Prerequisites: v5.19 product center and v5.22 formal objectives.
CREATE TABLE IF NOT EXISTS product_objective_cycles (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 objective_id BIGINT UNSIGNED NOT NULL,
 cycle_id BIGINT UNSIGNED NOT NULL,
 objective_revision BIGINT UNSIGNED NOT NULL,
 cycle_revision BIGINT UNSIGNED NOT NULL,
 objective_snapshot JSON NOT NULL,
 cycle_snapshot JSON NOT NULL,
 mapping_note TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 revoked_by VARCHAR(64) NULL,
 revoked_at DATETIME(3) NULL,
 revocation_reason TEXT NULL,
 active_cycle_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN revoked_at IS NULL THEN cycle_id ELSE NULL END) STORED,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_objective_cycle_biz(biz_id),
 UNIQUE KEY uk_pc_objective_cycle_active(objective_id,active_cycle_id),
 KEY idx_pc_objective_cycle_scope(cycle_id,product_code),
 CONSTRAINT fk_pc_objective_cycle_goal FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code),
 CONSTRAINT fk_pc_objective_cycle_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
 CONSTRAINT ck_pc_objective_cycle_revision CHECK(objective_revision>0 AND cycle_revision>0),
 CONSTRAINT ck_pc_objective_cycle_note CHECK(CHAR_LENGTH(TRIM(mapping_note))>0),
 CONSTRAINT ck_pc_objective_cycle_revocation CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND CHAR_LENGTH(TRIM(revoked_by))>0 AND revocation_reason IS NOT NULL AND CHAR_LENGTH(TRIM(revocation_reason))>0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS trg_pc_objective_cycle_no_rewrite;
DELIMITER $$
CREATE TRIGGER trg_pc_objective_cycle_no_rewrite BEFORE UPDATE ON product_objective_cycles FOR EACH ROW
BEGIN
 IF OLD.revoked_at IS NOT NULL OR NOT (NEW.id <=> OLD.id) OR NOT (NEW.biz_id <=> OLD.biz_id) OR NOT (NEW.product_code <=> OLD.product_code) OR NOT (NEW.objective_id <=> OLD.objective_id) OR NOT (NEW.cycle_id <=> OLD.cycle_id) OR NOT (NEW.objective_revision <=> OLD.objective_revision) OR NOT (NEW.cycle_revision <=> OLD.cycle_revision) OR NOT (NEW.objective_snapshot <=> OLD.objective_snapshot) OR NOT (NEW.cycle_snapshot <=> OLD.cycle_snapshot) OR NOT (NEW.mapping_note <=> OLD.mapping_note) OR NOT (NEW.created_by <=> OLD.created_by) OR NOT (NEW.created_at <=> OLD.created_at) OR NEW.revoked_at IS NULL THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Objective cycle mapping snapshots are immutable';
 END IF;
END$$
DELIMITER ;
DROP TRIGGER IF EXISTS trg_pc_objective_cycle_no_delete;
CREATE TRIGGER trg_pc_objective_cycle_no_delete BEFORE DELETE ON product_objective_cycles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Objective cycle mapping history cannot be deleted';
