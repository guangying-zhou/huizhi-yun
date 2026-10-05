-- Cross-product edges supplement the existing same-product dependency graph.
-- Commands must serialize graph changes and authorize both product scopes.
CREATE TABLE IF NOT EXISTS product_cross_dependencies (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 planning_item_id BIGINT UNSIGNED NOT NULL,
 predecessor_product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 predecessor_id BIGINT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 reason TEXT NOT NULL,
 created_by VARCHAR(64) NOT NULL,
 updated_by VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uk_pc_cross_dependency_biz(biz_id),
 UNIQUE KEY uk_pc_cross_dependency_edge(planning_item_id,predecessor_id),
 KEY idx_pc_cross_dependency_source(planning_item_id,product_code),
 KEY idx_pc_cross_dependency_target(predecessor_id,predecessor_product_code),
 CONSTRAINT fk_pc_cross_dependency_source FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT fk_pc_cross_dependency_target FOREIGN KEY(predecessor_id,predecessor_product_code) REFERENCES product_planning_items(id,product_code),
 CONSTRAINT ck_pc_cross_dependency_products CHECK(BINARY product_code<>BINARY predecessor_product_code AND planning_item_id<>predecessor_id),
 CONSTRAINT ck_pc_cross_dependency_revision CHECK(revision>0),
 CONSTRAINT ck_pc_cross_dependency_reason CHECK(CHAR_LENGTH(TRIM(reason))>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- Shared lock for cross- and same-product edge changes, preventing concurrent cycles.
CREATE TABLE IF NOT EXISTS product_dependency_graph_lock (
 id TINYINT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 PRIMARY KEY(id),
 CONSTRAINT ck_pc_dependency_graph_singleton CHECK(id=1 AND revision>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT IGNORE INTO product_dependency_graph_lock(id,revision) VALUES(1,1);
