-- Product module tree foundation. Existing features stay ungrouped.
-- Apply after v5.20. Never infer hierarchy from feature titles.
CREATE TABLE IF NOT EXISTS product_components (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uk_pc_component_biz(biz_id),
  UNIQUE KEY uk_pc_component_scope(id,product_code),
  KEY idx_pc_component_tree(product_code,parent_id,sort_order,id),
  CONSTRAINT fk_pc_component_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT fk_pc_component_parent FOREIGN KEY(parent_id,product_code) REFERENCES product_components(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
SET @pc_component_sql = IF(
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_features' AND column_name='component_id'),
 'SELECT 1',
 'ALTER TABLE product_features ADD COLUMN component_id BIGINT UNSIGNED NULL AFTER product_code'
);
PREPARE pc_component_stmt FROM @pc_component_sql;
EXECUTE pc_component_stmt;
DEALLOCATE PREPARE pc_component_stmt;
SET @pc_component_sql = IF(
 EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_features' AND constraint_name='fk_pc_feature_component'),
 'SELECT 1',
 'ALTER TABLE product_features ADD CONSTRAINT fk_pc_feature_component FOREIGN KEY(component_id,product_code) REFERENCES product_components(id,product_code)'
);
PREPARE pc_component_stmt FROM @pc_component_sql;
EXECUTE pc_component_stmt;
DEALLOCATE PREPARE pc_component_stmt;
