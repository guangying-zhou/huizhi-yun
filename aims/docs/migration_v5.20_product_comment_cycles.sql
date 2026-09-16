-- Add explicit cycle ownership without guessing the cycle of historical comments.
-- Apply after v5.19. Re-running this script is safe.
SET @pc_comment_cycle_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='product_planning_comments' AND column_name='cycle_id'),
  'SELECT 1',
  'ALTER TABLE product_planning_comments ADD COLUMN cycle_id BIGINT UNSIGNED NULL AFTER planning_item_id'
);
PREPARE pc_comment_cycle_stmt FROM @pc_comment_cycle_sql;
EXECUTE pc_comment_cycle_stmt;
DEALLOCATE PREPARE pc_comment_cycle_stmt;
SET @pc_comment_cycle_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='product_planning_comments' AND constraint_name='fk_pc_comment_cycle_item'),
  'SELECT 1',
  'ALTER TABLE product_planning_comments ADD CONSTRAINT fk_pc_comment_cycle_item FOREIGN KEY (cycle_id,planning_item_id) REFERENCES product_planning_cycle_items(cycle_id,planning_item_id)'
);
PREPARE pc_comment_cycle_stmt FROM @pc_comment_cycle_sql;
EXECUTE pc_comment_cycle_stmt;
DEALLOCATE PREPARE pc_comment_cycle_stmt;
