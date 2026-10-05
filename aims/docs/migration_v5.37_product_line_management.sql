-- AIMS management subjects; Assets remains the product/catalog authority.
CREATE TABLE IF NOT EXISTS product_line_workspaces (
  line_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  line_label VARCHAR(255) NOT NULL,
  source_watermark VARCHAR(191) NOT NULL,
  PRIMARY KEY (line_code),
  UNIQUE KEY uk_pc_line_workspace (product_code),
  CONSTRAINT fk_pc_line_workspace FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS product_component_sources (
  source_product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  component_id BIGINT UNSIGNED NOT NULL,
  source_product_name VARCHAR(255) NOT NULL,
  PRIMARY KEY (source_product_code),
  UNIQUE KEY uk_pc_source_component (component_id),
  CONSTRAINT fk_pc_source_workspace FOREIGN KEY (product_code) REFERENCES product_line_workspaces(product_code),
  CONSTRAINT fk_pc_source_component FOREIGN KEY (component_id,product_code) REFERENCES product_components(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
