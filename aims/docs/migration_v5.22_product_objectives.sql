-- Formal product objectives. Apply after v5.21; existing planning snapshots remain unchanged.
CREATE TABLE IF NOT EXISTS product_objectives (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 title VARCHAR(255) NOT NULL,
 description TEXT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 owner_uid VARCHAR(64) NOT NULL,
 metric_name VARCHAR(255) NOT NULL,
 metric_unit VARCHAR(64) NOT NULL,
 measurement_definition TEXT NOT NULL,
 direction VARCHAR(16) NOT NULL,
 baseline_value DECIMAL(20,6) NOT NULL,
 target_value DECIMAL(20,6) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'draft',
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_objective_biz(biz_id),
 UNIQUE KEY uk_pc_objective_scope(id,product_code),
 KEY idx_pc_objective_period(product_code,status,starts_on,ends_on,id),
 CONSTRAINT fk_pc_objective_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
 CONSTRAINT ck_pc_objective_period CHECK(ends_on>=starts_on),
 CONSTRAINT ck_pc_objective_direction CHECK(direction IN ('increase','decrease')),
 CONSTRAINT ck_pc_objective_target CHECK((direction='increase' AND target_value>baseline_value) OR (direction='decrease' AND target_value<baseline_value)),
 CONSTRAINT ck_pc_objective_status CHECK(status IN ('draft','active','closed','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_objective_items (
 objective_id BIGINT UNSIGNED NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 contribution_note TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(objective_id,planning_item_id),
 KEY idx_pc_objective_item_scope(planning_item_id,product_code),
 CONSTRAINT fk_pc_objective_item_goal FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code),
 CONSTRAINT fk_pc_objective_item_planning FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_objective_observations (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 objective_id BIGINT UNSIGNED NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 objective_revision BIGINT UNSIGNED NOT NULL,
 metric_snapshot JSON NOT NULL,
 observed_on DATE NOT NULL,
 measured_value DECIMAL(20,6) NOT NULL,
 evidence TEXT NOT NULL,
 note TEXT NULL,
 created_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_objective_observation_biz(biz_id),
 KEY idx_pc_objective_observation_date(objective_id,observed_on,id),
 CONSTRAINT fk_pc_objective_observation FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
DROP TRIGGER IF EXISTS pc_objective_observation_no_update;
CREATE TRIGGER pc_objective_observation_no_update BEFORE UPDATE ON product_objective_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='product objective observations are immutable';
DROP TRIGGER IF EXISTS pc_objective_observation_no_delete;
CREATE TRIGGER pc_objective_observation_no_delete BEFORE DELETE ON product_objective_observations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='product objective observations are immutable';
