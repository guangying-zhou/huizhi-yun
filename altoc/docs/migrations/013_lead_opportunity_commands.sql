-- ============================================================
-- Migration 013: Lead conversion command support
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

CREATE TABLE IF NOT EXISTS lead_conversion (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    lead_id                     BIGINT NOT NULL COMMENT '线索ID',
    customer_id                 BIGINT NOT NULL COMMENT '转化客户ID',
    contact_id                  BIGINT DEFAULT NULL COMMENT '转化联系人ID',
    opportunity_id              BIGINT NOT NULL COMMENT '转化商机ID',
    converted_by                VARCHAR(50) DEFAULT NULL COMMENT '转化人',
    converted_at                DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '转化时间',
    idempotency_key             VARCHAR(100) DEFAULT NULL COMMENT '幂等键',
    conversion_snapshot_json    JSON DEFAULT NULL COMMENT '转化请求与结果快照',

    UNIQUE KEY uk_lead_conversion_lead (lead_id),
    UNIQUE KEY uk_lead_conversion_idempotency (idempotency_key),
    INDEX idx_customer_id (customer_id),
    INDEX idx_contact_id (contact_id),
    INDEX idx_opportunity_id (opportunity_id),
    CONSTRAINT fk_lc_lead FOREIGN KEY (lead_id) REFERENCES `lead`(id),
    CONSTRAINT fk_lc_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_lc_contact FOREIGN KEY (contact_id) REFERENCES contact(id),
    CONSTRAINT fk_lc_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线索转化记录表';

DROP PROCEDURE IF EXISTS hzy_add_opportunity_lead_unique_if_safe;

DELIMITER $$

CREATE PROCEDURE hzy_add_opportunity_lead_unique_if_safe()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity'
      AND index_name = 'uk_opportunity_lead_id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM opportunity
    WHERE lead_id IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY lead_id
    HAVING COUNT(*) > 1
  ) THEN
    ALTER TABLE opportunity ADD UNIQUE KEY uk_opportunity_lead_id (lead_id);
  END IF;
END$$

DELIMITER ;

CALL hzy_add_opportunity_lead_unique_if_safe();

DROP PROCEDURE IF EXISTS hzy_add_opportunity_lead_unique_if_safe;
