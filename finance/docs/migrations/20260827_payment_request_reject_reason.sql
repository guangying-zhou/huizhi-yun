-- 补齐 payment_request.reject_reason（走查 ISSUE-B-002）。
--
-- finance_schema.sql 自建库起就声明了该列，但生产租户 C000001 的 hzy_finance
-- 建库时用的是更早版本，之后没有任何迁移补列。而 write_approval.go 的驳回分支
-- 对 invoice_request / expense_claim / project_expense_request / payment_request
-- 四张表使用同一段硬编码 SQL，统一写 reject_reason，因此付款申请一旦被驳回就会
-- 抛 MySQL 1054，经 data-runtime 的 writeError 兜底成 500 internal_error，
-- 且被 retryableHTTPStatus 判为可重试，导致 Workflow 回调持续重投。
--
-- 幂等，可重复执行。

USE hzy_finance;

DROP PROCEDURE IF EXISTS hzy_finance_add_column_if_missing;

DELIMITER $$

CREATE PROCEDURE hzy_finance_add_column_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_finance_add_column_if_missing(
  'payment_request',
  'reject_reason',
  'reject_reason VARCHAR(500) DEFAULT NULL COMMENT ''拒绝原因'' AFTER rejected_at'
);

-- 同批核对另外三张审批表，避免同类漂移在别处潜伏。
CALL hzy_finance_add_column_if_missing(
  'invoice_request',
  'reject_reason',
  'reject_reason VARCHAR(500) DEFAULT NULL COMMENT ''拒绝原因'' AFTER rejected_at'
);
CALL hzy_finance_add_column_if_missing(
  'expense_claim',
  'reject_reason',
  'reject_reason VARCHAR(500) DEFAULT NULL COMMENT ''拒绝原因'' AFTER rejected_at'
);
CALL hzy_finance_add_column_if_missing(
  'project_expense_request',
  'reject_reason',
  'reject_reason VARCHAR(500) DEFAULT NULL COMMENT ''拒绝原因'' AFTER rejected_at'
);

DROP PROCEDURE IF EXISTS hzy_finance_add_column_if_missing;

-- 核验：四张表都应返回 1。
-- SELECT t.n AS table_name,
--        MAX(c.COLUMN_NAME = 'reject_reason') AS has_reject_reason
-- FROM (SELECT 'invoice_request' n UNION SELECT 'expense_claim'
--       UNION SELECT 'project_expense_request' UNION SELECT 'payment_request') t
-- LEFT JOIN information_schema.COLUMNS c
--   ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = t.n
-- GROUP BY t.n;
