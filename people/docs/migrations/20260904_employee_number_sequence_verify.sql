-- 期望返回 0 行；随后一行 sequence 检查应显示 next_value 大于所有已占用自动工号。
SELECT 'people_employee_number_sequences.table' AS missing_item
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'people_employee_number_sequences'
)
UNION ALL
SELECT 'people_employee_number_reassignment_history.table' AS missing_item
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'people_employee_number_reassignment_history'
)
UNION ALL
SELECT 'people_employees.non_numeric_employee_no' AS missing_item
WHERE EXISTS (
  SELECT 1 FROM `people_employees` WHERE `employee_no` NOT REGEXP '^[0-9]+$'
)
UNION ALL
SELECT 'people_employees.sequence_order' AS missing_item
WHERE EXISTS (
  SELECT 1
  FROM (
    SELECT
      ranked.`employee_no`,
      LPAD(
        CAST(ranked.`sequence_value` AS CHAR),
        GREATEST(3, CHAR_LENGTH(CAST(ranked.`sequence_value` AS CHAR))),
        '0'
      ) AS `expected_employee_no`
    FROM (
      SELECT
        employee.`employee_no`,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN employee.`onboard_date` IS NULL THEN 1 ELSE 0 END,
            employee.`onboard_date`,
            employee.`id`
        ) - 1 AS `sequence_value`
      FROM `people_employees` employee
    ) ranked
  ) ranked
  WHERE ranked.`employee_no` <> ranked.`expected_employee_no`
)
UNION ALL
SELECT 'people_onboarding_cases.linked_employee_no' AS missing_item
WHERE EXISTS (
  SELECT 1
  FROM `people_onboarding_cases` onboarding
  INNER JOIN `people_employees` employee ON employee.`employee_uid` = onboarding.`canonical_uid`
  WHERE onboarding.`status` <> 'cancelled'
    AND onboarding.`employee_no` <> employee.`employee_no`
)
UNION ALL
SELECT 'people_employee_number_sequences.next_value' AS missing_item
WHERE NOT EXISTS (
  SELECT 1 FROM `people_employee_number_sequences`
  WHERE `sequence_code` = 'employee_no'
    AND `next_value` >= COALESCE((
      SELECT MAX(CAST(`employee_no` AS UNSIGNED)) + 1 FROM (
        SELECT `employee_no` FROM `people_employees`
        UNION ALL
        SELECT `employee_no` FROM `people_onboarding_cases`
        WHERE `status` <> 'cancelled' AND `employee_no` REGEXP '^[0-9]+$'
      ) occupied_numbers
    ), 0)
);

SELECT `sequence_code`, `next_value`, `updated_at`
FROM `people_employee_number_sequences`
WHERE `sequence_code` = 'employee_no';
