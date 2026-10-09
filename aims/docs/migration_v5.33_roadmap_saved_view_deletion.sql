-- Retain view identity and ownership for authorized idempotent deletion replay.
SET @pc_saved_view_sql = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_roadmap_saved_views' AND column_name='deleted_at'), 'SELECT 1', 'ALTER TABLE product_roadmap_saved_views ADD COLUMN deleted_at DATETIME(3) NULL');
PREPARE pc_saved_view_stmt FROM @pc_saved_view_sql;
EXECUTE pc_saved_view_stmt;
DEALLOCATE PREPARE pc_saved_view_stmt;
