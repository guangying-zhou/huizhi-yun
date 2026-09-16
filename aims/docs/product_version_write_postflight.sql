-- READ ONLY: run after applying product-center migrations, before enabling
-- the version write endpoints. Empty result = these structural checks pass.
-- This does not replace service-grant, user-permission or business-data checks.
-- Reports identifiers only; no business rows or credentials are returned.
WITH required_columns AS (
  SELECT 'product_versions' AS table_name, 'revision' AS column_name, 'bigint unsigned' AS column_type, 'NO' AS nullable
  UNION ALL SELECT 'product_versions','scope_revision','bigint unsigned','NO'
  UNION ALL SELECT 'product_versions','id','bigint unsigned','NO'
  UNION ALL SELECT 'work_items','version_id','bigint unsigned','YES'
  UNION ALL SELECT 'work_items','feature_id','bigint unsigned','YES'
  UNION ALL SELECT 'product_version_features','version_id','bigint unsigned','NO'
), required_tables AS (
  SELECT 'product_versions' AS table_name
  UNION ALL SELECT 'work_items'
  UNION ALL SELECT 'product_version_features'
  UNION ALL SELECT 'product_workspaces'
  UNION ALL SELECT 'product_command_receipts'
  UNION ALL SELECT 'product_activity_logs'
)
SELECT 'column_missing_or_incompatible' AS check_code, r.table_name, r.column_name
FROM required_columns r
LEFT JOIN information_schema.COLUMNS c
 ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE c.COLUMN_NAME IS NULL OR LOWER(c.COLUMN_TYPE)<>r.column_type OR c.IS_NULLABLE<>r.nullable
UNION ALL
SELECT 'table_missing_or_not_transactional',r.table_name,NULL
FROM required_tables r
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=r.table_name
WHERE t.TABLE_NAME IS NULL OR t.ENGINE<>'InnoDB';
