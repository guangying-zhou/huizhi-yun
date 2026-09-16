USE `hzy_people`;

SELECT
  CASE
    WHEN COUNT(*) = 1 THEN 'PASS'
    ELSE CONCAT('FAIL: people_employees.mobile column checks passed = ', COUNT(*), ' / 1')
  END AS result
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'people_employees'
  AND column_name = 'mobile'
  AND is_nullable = 'YES';

SELECT
  CASE
    WHEN COUNT(*) = 1 THEN 'PASS'
    ELSE CONCAT('FAIL: people_employees.onboard_date_source column checks passed = ', COUNT(*), ' / 1')
  END AS result
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'people_employees'
  AND column_name = 'onboard_date_source'
  AND REPLACE(LOWER(column_type), ' ', '') = 'enum(''dingtalk'',''manual'')'
  AND is_nullable = 'NO'
  AND column_default = 'dingtalk';

SELECT
  CASE
    WHEN COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '') = 'onboard_date_source,onboard_date' THEN 'PASS'
    ELSE CONCAT('FAIL: idx_people_employee_onboard_date_source columns = ', COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '<missing>'))
  END AS result
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'people_employees'
  AND index_name = 'idx_people_employee_onboard_date_source';

-- 回填完整性：metadata 快照里还有手机号、而一等列仍为空的行不应存在。
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE CONCAT('FAIL: employees with a snapshot mobile but no column value = ', COUNT(*))
  END AS result
FROM people_employees
WHERE mobile IS NULL
  AND metadata IS NOT NULL
  AND JSON_VALID(metadata)
  AND JSON_EXTRACT(metadata, '$.directory_user.mobile') IS NOT NULL
  AND JSON_TYPE(JSON_EXTRACT(metadata, '$.directory_user.mobile')) <> 'NULL'
  AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.directory_user.mobile'))) <> '';
