-- Lightweight product planning. This migration is additive and repeatable.
SET @pc_v538_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_requests' AND column_name='component_id'), 'SELECT 1', 'ALTER TABLE product_requests ADD COLUMN component_id BIGINT UNSIGNED NULL AFTER product_code');
PREPARE pc_v538_stmt FROM @pc_v538_sql;
EXECUTE pc_v538_stmt;
DEALLOCATE PREPARE pc_v538_stmt;
SET @pc_v538_sql = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='product_requests' AND index_name='idx_pc_request_component'), 'SELECT 1', 'ALTER TABLE product_requests ADD KEY idx_pc_request_component(product_code,component_id,id)');
PREPARE pc_v538_stmt FROM @pc_v538_sql;
EXECUTE pc_v538_stmt;
DEALLOCATE PREPARE pc_v538_stmt;
SET @pc_v538_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_requests' AND constraint_name='fk_pc_request_component'), 'SELECT 1', 'ALTER TABLE product_requests ADD CONSTRAINT fk_pc_request_component FOREIGN KEY(component_id,product_code) REFERENCES product_components(id,product_code)');
PREPARE pc_v538_stmt FROM @pc_v538_sql;
EXECUTE pc_v538_stmt;
DEALLOCATE PREPARE pc_v538_stmt;

SET @pc_v538_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_versions' AND column_name='planning_mode'), 'SELECT 1', "ALTER TABLE product_versions ADD COLUMN planning_mode ENUM('cycle','simple') NOT NULL DEFAULT 'cycle' AFTER scope_revision");
PREPARE pc_v538_stmt FROM @pc_v538_sql;
EXECUTE pc_v538_stmt;
DEALLOCATE PREPARE pc_v538_stmt;

CREATE TABLE IF NOT EXISTS product_version_plans (
  version_id BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  goal TEXT NULL,
  starts_on DATE NULL,
  available_person_days DECIMAL(12,2) NULL,
  reserve_person_days DECIMAL(12,2) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  scope_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY(version_id), KEY idx_pc_plan_product(product_code,version_id),
  CONSTRAINT fk_pc_plan_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_plan_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT ck_pc_plan_capacity CHECK (available_person_days IS NULL OR available_person_days >= 0),
  CONSTRAINT ck_pc_plan_reserve CHECK (reserve_person_days IS NULL OR reserve_person_days >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_version_plan_scopes (
  version_feature_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  scope_summary TEXT NOT NULL,
  estimate_person_days DECIMAL(12,2) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY(version_feature_id), UNIQUE KEY uk_pc_plan_scope_request(version_id,request_id), UNIQUE KEY uk_pc_plan_scope_item(planning_item_id),
  KEY idx_pc_plan_scope_version(version_id,version_feature_id),
  CONSTRAINT fk_pc_plan_scope_feature FOREIGN KEY(version_feature_id) REFERENCES product_version_features(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_plan_scope_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_plan_scope_request FOREIGN KEY(request_id,product_code) REFERENCES product_requests(id,product_code),
  CONSTRAINT fk_pc_plan_scope_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT ck_pc_plan_scope_estimate CHECK (estimate_person_days IS NULL OR estimate_person_days > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_version_plan_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version_id BIGINT UNSIGNED NOT NULL,
  plan_revision BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  snapshot JSON NOT NULL,
  confirmed_by VARCHAR(64) NOT NULL,
  confirmed_at DATETIME(3) NOT NULL,
  invalidated_by VARCHAR(64) NULL,
  invalidated_at DATETIME(3) NULL,
  invalidation_reason TEXT NULL,
  PRIMARY KEY(id), KEY idx_pc_plan_confirmation(version_id,id),
  CONSTRAINT fk_pc_plan_confirmation_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
  CONSTRAINT ck_pc_plan_confirmation_invalidation CHECK ((invalidated_at IS NULL AND invalidated_by IS NULL) OR (invalidated_at IS NOT NULL AND invalidated_by IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
