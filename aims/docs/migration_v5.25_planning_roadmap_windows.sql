-- Exploration time windows on existing planning items, not delivery commitments.
-- Quarters are derived from dates. Existing decision ranks and deadlines are preserved.
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_planning_items' AND column_name='roadmap_starts_on'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD COLUMN roadmap_starts_on DATE NULL');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_planning_items' AND column_name='roadmap_ends_on'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD COLUMN roadmap_ends_on DATE NULL');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_planning_items' AND constraint_name='ck_pc_planning_roadmap_window'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD CONSTRAINT ck_pc_planning_roadmap_window CHECK((roadmap_starts_on IS NULL AND roadmap_ends_on IS NULL) OR (roadmap_starts_on IS NOT NULL AND roadmap_ends_on IS NOT NULL AND roadmap_ends_on>=roadmap_starts_on))');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
SET @pc_roadmap_window_sql = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='product_planning_items' AND index_name='idx_pc_planning_roadmap_window'), 'SELECT 1', 'ALTER TABLE product_planning_items ADD INDEX idx_pc_planning_roadmap_window(product_code,roadmap_starts_on,roadmap_ends_on,id)');
PREPARE pc_roadmap_window_stmt FROM @pc_roadmap_window_sql;
EXECUTE pc_roadmap_window_stmt;
DEALLOCATE PREPARE pc_roadmap_window_stmt;
