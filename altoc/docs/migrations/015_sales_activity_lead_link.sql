-- ============================================================
-- Migration 015: Link sales activities to leads
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_add_sales_activity_lead_link_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_add_sales_activity_lead_link_if_missing()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_activity'
      AND column_name = 'lead_id'
  ) THEN
    ALTER TABLE sales_activity
      ADD COLUMN lead_id BIGINT DEFAULT NULL COMMENT '关联线索ID' AFTER subject;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_activity'
      AND index_name = 'idx_lead_id'
  ) THEN
    ALTER TABLE sales_activity ADD INDEX idx_lead_id (lead_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'sales_activity'
      AND constraint_name = 'fk_activity_lead'
  ) THEN
    ALTER TABLE sales_activity
      ADD CONSTRAINT fk_activity_lead FOREIGN KEY (lead_id) REFERENCES `lead`(id);
  END IF;
END$$

DELIMITER ;

CALL hzy_add_sales_activity_lead_link_if_missing();

DROP PROCEDURE IF EXISTS hzy_add_sales_activity_lead_link_if_missing;
