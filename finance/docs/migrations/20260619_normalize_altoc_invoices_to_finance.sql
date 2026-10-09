-- Normalize legacy Altoc invoice rows into Finance.
-- Run in hzy_finance. Source database is expected to be hzy_altoc.
--
-- This migration is additive and repeatable:
--   - Finance remains the invoice source of truth.
--   - Existing Finance invoices with the same legacy key are skipped.
--   - Existing Finance invoices with the same contract/invoice-no/amount/date are skipped.
--   - hzy_altoc.invoice is not dropped; it becomes a legacy compatibility table.

USE hzy_finance;

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET collation_connection = 'utf8mb4_unicode_ci';

DROP TEMPORARY TABLE IF EXISTS tmp_altoc_invoice_source;
DROP TEMPORARY TABLE IF EXISTS tmp_altoc_invoice_contracts;

SET @has_altoc_invoice_receiver_name = (
  SELECT COUNT(*) > 0
  FROM information_schema.columns
  WHERE table_schema = 'hzy_altoc'
    AND table_name = 'invoice'
    AND column_name = 'receiver_name'
);
SET @has_altoc_invoice_item = (
  SELECT COUNT(*) > 0
  FROM information_schema.columns
  WHERE table_schema = 'hzy_altoc'
    AND table_name = 'invoice'
    AND column_name = 'invoice_item'
);
SET @has_altoc_invoice_legacy_source = (
  SELECT COUNT(*) > 0
  FROM information_schema.columns
  WHERE table_schema = 'hzy_altoc'
    AND table_name = 'invoice'
    AND column_name = 'legacy_source'
);
SET @has_altoc_invoice_legacy_id = (
  SELECT COUNT(*) > 0
  FROM information_schema.columns
  WHERE table_schema = 'hzy_altoc'
    AND table_name = 'invoice'
    AND column_name = 'legacy_id'
);
SET @has_altoc_invoice_legacy_refs_json = (
  SELECT COUNT(*) > 0
  FROM information_schema.columns
  WHERE table_schema = 'hzy_altoc'
    AND table_name = 'invoice'
    AND column_name = 'legacy_refs_json'
);

SET @altoc_invoice_receiver_name_expr = IF(
  @has_altoc_invoice_receiver_name,
  '`receiver_name` AS `receiver_name`',
  'CAST(NULL AS CHAR(200)) AS `receiver_name`'
);
SET @altoc_invoice_item_expr = IF(
  @has_altoc_invoice_item,
  '`invoice_item` AS `invoice_item`',
  'CAST(NULL AS CHAR(500)) AS `invoice_item`'
);
SET @altoc_invoice_legacy_source_expr = IF(
  @has_altoc_invoice_legacy_source,
  '`legacy_source` AS `legacy_source`',
  'CAST(NULL AS CHAR(50)) AS `legacy_source`'
);
SET @altoc_invoice_legacy_id_expr = IF(
  @has_altoc_invoice_legacy_id,
  '`legacy_id` AS `legacy_id`',
  'CAST(NULL AS SIGNED) AS `legacy_id`'
);
SET @altoc_invoice_legacy_refs_json_expr = IF(
  @has_altoc_invoice_legacy_refs_json,
  '`legacy_refs_json` AS `legacy_refs_json`',
  'CAST(NULL AS CHAR) AS `legacy_refs_json`'
);

SET @create_altoc_invoice_source_sql = CONCAT(
  'CREATE TEMPORARY TABLE tmp_altoc_invoice_source AS ',
  'SELECT ',
    '`id`, ',
    '`code`, ',
    '`receivable_plan_id`, ',
    '`contract_id`, ',
    '`invoice_no`, ',
    '`invoice_type`, ',
    '`invoice_amount`, ',
    '`invoice_date`, ',
    '`status`, ',
    @altoc_invoice_receiver_name_expr, ', ',
    @altoc_invoice_item_expr, ', ',
    '`taxpayer_name`, ',
    '`taxpayer_no`, ',
    @altoc_invoice_legacy_source_expr, ', ',
    @altoc_invoice_legacy_id_expr, ', ',
    @altoc_invoice_legacy_refs_json_expr, ', ',
    '`remark`, ',
    '`created_by`, ',
    '`updated_by`, ',
    '`created_at`, ',
    '`updated_at`, ',
    '`deleted_at` ',
  'FROM hzy_altoc.invoice'
);

PREPARE stmt FROM @create_altoc_invoice_source_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE tmp_altoc_invoice_source
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_altoc_invoice_contracts (
  contract_code VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY
) ENGINE=Memory;

INSERT INTO tmp_altoc_invoice_contracts (contract_code)
SELECT DISTINCT c.code COLLATE utf8mb4_unicode_ci
FROM tmp_altoc_invoice_source ai
INNER JOIN hzy_altoc.contract c ON c.id = ai.contract_id
WHERE ai.deleted_at IS NULL
  AND COALESCE(ai.status, '') <> 'canceled'
  AND COALESCE(ai.invoice_amount, 0) > 0
ON DUPLICATE KEY UPDATE contract_code = VALUES(contract_code);

INSERT INTO finance_invoice (
  code,
  invoice_no,
  customer_code,
  customer_name,
  contract_code,
  receivable_plan_code,
  invoice_type,
  invoice_item,
  invoice_amount,
  invoice_date,
  status,
  taxpayer_name,
  taxpayer_no,
  receiver_name,
  source_refs_json,
  legacy_source,
  legacy_id,
  remark,
  created_by,
  updated_by,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  CONCAT('INV-ALT-', ai.id) AS code,
  NULLIF(TRIM(ai.invoice_no), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS invoice_no,
  cu.code COLLATE utf8mb4_unicode_ci AS customer_code,
  cu.name COLLATE utf8mb4_unicode_ci AS customer_name,
  c.code COLLATE utf8mb4_unicode_ci AS contract_code,
  rp.code COLLATE utf8mb4_unicode_ci AS receivable_plan_code,
  NULLIF(TRIM(ai.invoice_type), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS invoice_type,
  NULLIF(TRIM(ai.invoice_item), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS invoice_item,
  ai.invoice_amount,
  ai.invoice_date,
  CASE
    WHEN ai.status = 'canceled' THEN 'canceled'
    WHEN ai.status = 'draft' THEN 'draft'
    ELSE 'issued'
  END AS status,
  NULLIF(TRIM(ai.taxpayer_name), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS taxpayer_name,
  NULLIF(TRIM(ai.taxpayer_no), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS taxpayer_no,
  NULLIF(TRIM(ai.receiver_name), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS receiver_name,
  JSON_OBJECT(
    'source_app', 'altoc',
    'source_table', 'invoice',
    'altoc_invoice_id', ai.id,
    'altoc_invoice_code', ai.code,
    'altoc_contract_id', ai.contract_id,
    'altoc_receivable_plan_id', ai.receivable_plan_id,
    'altoc_legacy_source', ai.legacy_source,
    'altoc_legacy_id', ai.legacy_id,
    'altoc_legacy_refs_json', ai.legacy_refs_json
  ) AS source_refs_json,
  CASE
    WHEN ai.legacy_source IS NULL OR TRIM(ai.legacy_source) = _utf8mb4'' COLLATE utf8mb4_unicode_ci OR ai.legacy_id IS NULL THEN _utf8mb4'altoc.invoice' COLLATE utf8mb4_unicode_ci
    ELSE ai.legacy_source COLLATE utf8mb4_unicode_ci
  END AS legacy_source,
  CASE
    WHEN ai.legacy_source IS NULL OR TRIM(ai.legacy_source) = _utf8mb4'' COLLATE utf8mb4_unicode_ci OR ai.legacy_id IS NULL THEN ai.id
    ELSE ai.legacy_id
  END AS legacy_id,
  NULLIF(TRIM(ai.remark), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS remark,
  COALESCE(NULLIF(TRIM(ai.created_by), _utf8mb4'' COLLATE utf8mb4_unicode_ci), _utf8mb4'system' COLLATE utf8mb4_unicode_ci) AS created_by,
  NULLIF(TRIM(ai.updated_by), _utf8mb4'' COLLATE utf8mb4_unicode_ci) AS updated_by,
  COALESCE(ai.created_at, NOW()) AS created_at,
  COALESCE(ai.updated_at, ai.created_at, NOW()) AS updated_at,
  ai.deleted_at
FROM tmp_altoc_invoice_source ai
INNER JOIN hzy_altoc.contract c ON c.id = ai.contract_id
LEFT JOIN hzy_altoc.customer cu ON cu.id = c.customer_id
LEFT JOIN hzy_altoc.receivable_plan rp ON rp.id = ai.receivable_plan_id
LEFT JOIN finance_invoice existing_legacy
  ON existing_legacy.legacy_source COLLATE utf8mb4_unicode_ci = CASE
      WHEN ai.legacy_source IS NULL OR TRIM(ai.legacy_source) = _utf8mb4'' COLLATE utf8mb4_unicode_ci OR ai.legacy_id IS NULL THEN _utf8mb4'altoc.invoice' COLLATE utf8mb4_unicode_ci
      ELSE ai.legacy_source COLLATE utf8mb4_unicode_ci
    END
  AND existing_legacy.legacy_id = CASE
      WHEN ai.legacy_source IS NULL OR TRIM(ai.legacy_source) = _utf8mb4'' COLLATE utf8mb4_unicode_ci OR ai.legacy_id IS NULL THEN ai.id
      ELSE ai.legacy_id
    END
LEFT JOIN finance_invoice existing_business
  ON existing_business.deleted_at IS NULL
  AND existing_business.contract_code COLLATE utf8mb4_unicode_ci = c.code COLLATE utf8mb4_unicode_ci
  AND existing_business.invoice_no COLLATE utf8mb4_unicode_ci <=> (NULLIF(TRIM(ai.invoice_no), _utf8mb4'' COLLATE utf8mb4_unicode_ci) COLLATE utf8mb4_unicode_ci)
  AND existing_business.invoice_amount = ai.invoice_amount
  AND existing_business.invoice_date <=> ai.invoice_date
WHERE ai.deleted_at IS NULL
  AND COALESCE(ai.status, '') <> 'canceled'
  AND COALESCE(ai.invoice_amount, 0) > 0
  AND existing_legacy.id IS NULL
  AND existing_business.id IS NULL;

INSERT INTO finance_contract_summary (
  contract_code,
  customer_code,
  project_code,
  invoice_amount,
  received_amount,
  reconciled_amount,
  unreceived_amount,
  unreconciled_amount,
  invoice_count,
  receipt_count,
  latest_invoice_date,
  latest_received_at,
  calculated_at
)
SELECT
  seed.contract_code,
  COALESCE(invoice.customer_code, receipt.customer_code, reconciliation.customer_code) AS customer_code,
  COALESCE(invoice.project_code, receipt.project_code, reconciliation.project_code) AS project_code,
  COALESCE(invoice.invoice_amount, 0) AS invoice_amount,
  COALESCE(receipt.received_amount, 0) AS received_amount,
  COALESCE(reconciliation.reconciled_amount, 0) AS reconciled_amount,
  NULL AS unreceived_amount,
  GREATEST(COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0), 0) AS unreconciled_amount,
  COALESCE(invoice.invoice_count, 0) AS invoice_count,
  COALESCE(receipt.receipt_count, 0) AS receipt_count,
  invoice.latest_invoice_date,
  receipt.latest_received_at,
  NOW() AS calculated_at
FROM tmp_altoc_invoice_contracts seed
LEFT JOIN (
  SELECT
    contract_code COLLATE utf8mb4_unicode_ci AS contract_code,
    MAX(customer_code COLLATE utf8mb4_unicode_ci) AS customer_code,
    MAX(project_code COLLATE utf8mb4_unicode_ci) AS project_code,
    SUM(invoice_amount) AS invoice_amount,
    COUNT(*) AS invoice_count,
    MAX(invoice_date) AS latest_invoice_date
  FROM finance_invoice
  WHERE deleted_at IS NULL
    AND status <> 'canceled'
  GROUP BY contract_code COLLATE utf8mb4_unicode_ci
) invoice ON invoice.contract_code COLLATE utf8mb4_unicode_ci = seed.contract_code COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT
    contract_code COLLATE utf8mb4_unicode_ci AS contract_code,
    MAX(customer_code COLLATE utf8mb4_unicode_ci) AS customer_code,
    MAX(project_code COLLATE utf8mb4_unicode_ci) AS project_code,
    SUM(received_amount) AS received_amount,
    COUNT(*) AS receipt_count,
    MAX(received_at) AS latest_received_at
  FROM finance_receipt
  WHERE deleted_at IS NULL
    AND status <> 'canceled'
  GROUP BY contract_code COLLATE utf8mb4_unicode_ci
) receipt ON receipt.contract_code COLLATE utf8mb4_unicode_ci = seed.contract_code COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT
    contract_code COLLATE utf8mb4_unicode_ci AS contract_code,
    MAX(customer_code COLLATE utf8mb4_unicode_ci) AS customer_code,
    MAX(project_code COLLATE utf8mb4_unicode_ci) AS project_code,
    SUM(reconciled_amount) AS reconciled_amount
  FROM finance_reconciliation
  WHERE status = 'active'
  GROUP BY contract_code COLLATE utf8mb4_unicode_ci
) reconciliation ON reconciliation.contract_code COLLATE utf8mb4_unicode_ci = seed.contract_code COLLATE utf8mb4_unicode_ci
ON DUPLICATE KEY UPDATE
  customer_code = VALUES(customer_code),
  project_code = VALUES(project_code),
  invoice_amount = VALUES(invoice_amount),
  received_amount = VALUES(received_amount),
  reconciled_amount = VALUES(reconciled_amount),
  unreceived_amount = VALUES(unreceived_amount),
  unreconciled_amount = VALUES(unreconciled_amount),
  invoice_count = VALUES(invoice_count),
  receipt_count = VALUES(receipt_count),
  latest_invoice_date = VALUES(latest_invoice_date),
  latest_received_at = VALUES(latest_received_at),
  calculated_at = NOW();

DROP TEMPORARY TABLE IF EXISTS tmp_altoc_invoice_contracts;
DROP TEMPORARY TABLE IF EXISTS tmp_altoc_invoice_source;
