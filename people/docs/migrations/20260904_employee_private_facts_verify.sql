-- 期望返回 0 行。
SELECT 'people_employee_private_facts.table' AS missing_item
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'people_employee_private_facts'
)
UNION ALL
SELECT 'people_employee_private_facts.columns' AS missing_item
WHERE (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_employee_private_facts'
    AND COLUMN_NAME IN (
      'employee_uid', 'field_code', 'source_code', 'value_text',
      'source_biz_id', 'source_updated_at', 'created_by', 'updated_by'
    )
) <> 8
UNION ALL
SELECT 'people_employees.onboard_date_source' AS missing_item
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_employees'
    AND COLUMN_NAME = 'onboard_date_source'
    AND IS_NULLABLE = 'YES'
    AND REPLACE(LOWER(COLUMN_TYPE), ' ', '') = 'enum(''dingtalk'',''oa_archive'',''manual'')'
)
UNION ALL
SELECT 'people_employees.empty_onboard_date_source' AS missing_item
WHERE EXISTS (
  SELECT 1 FROM `people_employees`
  WHERE (`onboard_date` IS NULL OR `onboard_date` = '1970-01-01')
    AND `onboard_date_source` IS NOT NULL
);
