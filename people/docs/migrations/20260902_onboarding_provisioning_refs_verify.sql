USE `hzy_people`;

SELECT
  CASE
    WHEN COUNT(*) = 2 THEN 'PASS'
    ELSE CONCAT('FAIL: onboarding provisioning reference columns = ', COUNT(*), ' / 2')
  END AS result
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'people_onboarding_cases'
  AND column_name IN ('reservation_id', 'provision_operation_id');

-- 处于开通中或更后阶段的入职单必须记得它的建号 operation，
-- 否则激活时无法验真账号是否真的创建成功。
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE CONCAT('FAIL: provisioning cases without a provision operation = ', COUNT(*))
  END AS result
FROM people_onboarding_cases
WHERE status IN ('provisioning_account', 'activating_employee', 'projecting_authorization')
  AND provision_operation_id IS NULL;
