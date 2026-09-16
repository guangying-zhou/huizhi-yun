-- ============================================================
-- Migration 028: P0B contract status machine hardening
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 027.
--
-- P0B scope:
-- - split the legacy contract.status into legal, fulfillment, financial and
--   activation statuses
-- - keep contract.status as a compatibility field maintained by domain commands
-- - add indexes needed by the P0B workbench

DROP PROCEDURE IF EXISTS hzy_contract_status_machine_add_column;
DROP PROCEDURE IF EXISTS hzy_contract_status_machine_add_index;

DELIMITER //

CREATE PROCEDURE hzy_contract_status_machine_add_column(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_alter_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    SET @ddl = p_alter_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

CREATE PROCEDURE hzy_contract_status_machine_add_index(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_alter_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND index_name = p_index_name
  ) THEN
    SET @ddl = p_alter_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

CALL hzy_contract_status_machine_add_column('contract', 'legal_status', 'ALTER TABLE contract ADD COLUMN legal_status VARCHAR(30) NOT NULL DEFAULT ''draft'' COMMENT ''法律生命周期状态'' AFTER status');
CALL hzy_contract_status_machine_add_column('contract', 'fulfillment_status', 'ALTER TABLE contract ADD COLUMN fulfillment_status VARCHAR(30) NOT NULL DEFAULT ''not_started'' COMMENT ''履约状态'' AFTER legal_status');
CALL hzy_contract_status_machine_add_column('contract', 'financial_status', 'ALTER TABLE contract ADD COLUMN financial_status VARCHAR(30) NOT NULL DEFAULT ''unplanned'' COMMENT ''财务状态，由应收/应付/Finance事件维护'' AFTER fulfillment_status');
CALL hzy_contract_status_machine_add_column('contract', 'activation_status', 'ALTER TABLE contract ADD COLUMN activation_status VARCHAR(30) NOT NULL DEFAULT ''not_planned'' COMMENT ''履约启动状态'' AFTER financial_status');

CALL hzy_contract_status_machine_add_index('contract', 'idx_contract_legal_status', 'ALTER TABLE contract ADD INDEX idx_contract_legal_status (legal_status)');
CALL hzy_contract_status_machine_add_index('contract', 'idx_contract_fulfillment_status', 'ALTER TABLE contract ADD INDEX idx_contract_fulfillment_status (fulfillment_status)');
CALL hzy_contract_status_machine_add_index('contract', 'idx_contract_financial_status', 'ALTER TABLE contract ADD INDEX idx_contract_financial_status (financial_status)');
CALL hzy_contract_status_machine_add_index('contract', 'idx_contract_activation_status', 'ALTER TABLE contract ADD INDEX idx_contract_activation_status (activation_status)');

UPDATE contract ct
SET legal_status = CASE ct.status
    WHEN 'draft' THEN 'draft'
    WHEN 'pending_approval' THEN 'pending_approval'
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'draft'
    WHEN 'effective' THEN 'effective'
    WHEN 'executing' THEN 'effective'
    WHEN 'delivering' THEN 'effective'
    WHEN 'accepted' THEN 'effective'
    WHEN 'service_ended' THEN 'effective'
    WHEN 'expired' THEN 'expired'
    WHEN 'completed' THEN 'closed'
    WHEN 'terminated' THEN 'terminated'
    WHEN 'invalid' THEN 'invalid'
    ELSE COALESCE(NULLIF(ct.legal_status, ''), 'draft')
  END,
  fulfillment_status = CASE ct.status
    WHEN 'draft' THEN 'not_started'
    WHEN 'pending_approval' THEN 'not_started'
    WHEN 'approved' THEN 'not_started'
    WHEN 'rejected' THEN 'not_started'
    WHEN 'effective' THEN
      CASE
        WHEN EXISTS (
          SELECT 1 FROM contract_obligation ob
          WHERE ob.contract_id = ct.id
            AND ob.deleted_at IS NULL
            AND ob.status IN ('accepted', 'completed', 'waived')
        ) THEN 'partially_fulfilled'
        ELSE 'in_progress'
      END
    WHEN 'executing' THEN 'in_progress'
    WHEN 'delivering' THEN 'in_progress'
    WHEN 'accepted' THEN 'partially_fulfilled'
    WHEN 'service_ended' THEN 'fulfilled'
    WHEN 'expired' THEN 'fulfilled'
    WHEN 'completed' THEN 'fulfilled'
    WHEN 'terminated' THEN
      CASE
        WHEN EXISTS (
          SELECT 1 FROM contract_obligation ob
          WHERE ob.contract_id = ct.id
            AND ob.deleted_at IS NULL
            AND ob.status IN ('accepted', 'completed', 'waived')
        ) THEN 'partially_fulfilled'
        ELSE 'cancelled'
      END
    WHEN 'invalid' THEN 'cancelled'
    ELSE COALESCE(NULLIF(ct.fulfillment_status, ''), 'not_started')
  END,
  activation_status = CASE ct.status
    WHEN 'draft' THEN 'not_planned'
    WHEN 'pending_approval' THEN 'not_planned'
    WHEN 'approved' THEN 'ready'
    WHEN 'rejected' THEN 'not_planned'
    WHEN 'effective' THEN 'ready'
    WHEN 'executing' THEN 'running'
    WHEN 'delivering' THEN 'running'
    WHEN 'accepted' THEN 'running'
    WHEN 'service_ended' THEN 'completed'
    WHEN 'expired' THEN 'completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'terminated' THEN 'completed'
    WHEN 'invalid' THEN 'not_planned'
    ELSE COALESCE(NULLIF(ct.activation_status, ''), 'not_planned')
  END;

SET @hzy_has_receivable_plan = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
);
SET @hzy_has_receivable_plan_contract_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
    AND column_name = 'contract_id'
);
SET @hzy_has_receivable_plan_status = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
    AND column_name = 'status'
);
SET @hzy_has_receivable_plan_deleted_at = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'receivable_plan'
    AND column_name = 'deleted_at'
);
SET @hzy_has_contract_billing_schedule = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
    AND table_name = 'contract_billing_schedule'
);
SET @hzy_has_contract_billing_deleted_at = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'contract_billing_schedule'
    AND column_name = 'deleted_at'
);
SET @hzy_receivable_status_available = @hzy_has_receivable_plan > 0
  AND @hzy_has_receivable_plan_contract_id > 0
  AND @hzy_has_receivable_plan_status > 0;
SET @hzy_receivable_plan_available = @hzy_has_receivable_plan > 0
  AND @hzy_has_receivable_plan_contract_id > 0;
SET @hzy_receivable_deleted_filter = IF(@hzy_has_receivable_plan_deleted_at > 0, ' AND rp.deleted_at IS NULL', '');
SET @hzy_billing_deleted_filter = IF(@hzy_has_contract_billing_deleted_at > 0, ' AND bs.deleted_at IS NULL', '');
SET @hzy_financial_status_sql = CONCAT(
  'UPDATE contract ct SET financial_status = CASE ',
  IF(
    @hzy_receivable_status_available,
    CONCAT(
      'WHEN EXISTS (SELECT 1 FROM receivable_plan rp WHERE rp.contract_id = ct.id',
      @hzy_receivable_deleted_filter,
      ' AND rp.status IN (''received'', ''closed'')) THEN ''received'' ',
      'WHEN EXISTS (SELECT 1 FROM receivable_plan rp WHERE rp.contract_id = ct.id',
      @hzy_receivable_deleted_filter,
      ' AND rp.status IN (''to_invoice'', ''invoicing'', ''invoiced'', ''partially_received'')) THEN ''partially_received'' '
    ),
    ''
  ),
  IF(
    @hzy_has_contract_billing_schedule > 0,
    CONCAT(
      'WHEN EXISTS (SELECT 1 FROM contract_billing_schedule bs WHERE bs.contract_id = ct.id',
      @hzy_billing_deleted_filter,
      ') THEN ''planned'' '
    ),
    ''
  ),
  IF(
    @hzy_receivable_plan_available,
    CONCAT(
      'WHEN EXISTS (SELECT 1 FROM receivable_plan rp WHERE rp.contract_id = ct.id',
      @hzy_receivable_deleted_filter,
      ') THEN ''planned'' '
    ),
    ''
  ),
  'ELSE ''unplanned'' END'
);
PREPARE stmt FROM @hzy_financial_status_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT
  legal_status,
  fulfillment_status,
  financial_status,
  activation_status,
  COUNT(*) AS contract_count
FROM contract
GROUP BY legal_status, fulfillment_status, financial_status, activation_status
ORDER BY legal_status, fulfillment_status, financial_status, activation_status;

DROP PROCEDURE IF EXISTS hzy_contract_status_machine_add_column;
DROP PROCEDURE IF EXISTS hzy_contract_status_machine_add_index;
