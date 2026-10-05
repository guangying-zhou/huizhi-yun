-- Expand only. Historical allocations retain NULL currency, no backfill or FX.
SET @hzy_allocation_currency_ddl = IF(
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_cost_allocation' AND COLUMN_NAME='currency_code')=0,
 'ALTER TABLE project_cost_allocation ADD COLUMN currency_code CHAR(3) DEFAULT NULL COMMENT ''Explicit allocation currency, unknown remains NULL''',
 'SELECT 1');
PREPARE hzy_allocation_currency_stmt FROM @hzy_allocation_currency_ddl;
EXECUTE hzy_allocation_currency_stmt;
DEALLOCATE PREPARE hzy_allocation_currency_stmt;
