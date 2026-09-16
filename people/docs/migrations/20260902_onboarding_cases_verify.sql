USE `hzy_people`;

SELECT
  CASE
    WHEN COUNT(*) = 1 THEN 'PASS'
    ELSE CONCAT('FAIL: people_onboarding_cases exists = ', COUNT(*), ' / 1')
  END AS result
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'people_onboarding_cases';

SELECT
  CASE
    WHEN COUNT(*) = 5 THEN 'PASS'
    ELSE CONCAT('FAIL: uniqueness guarantees = ', COUNT(*), ' / 5')
  END AS result
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'people_onboarding_cases'
  AND non_unique = 0
  AND index_name IN (
    'uk_people_onboarding_code',
    'uk_people_onboarding_provider_subject',
    'uk_people_onboarding_canonical_uid',
    'uk_people_onboarding_active_employee_no',
    'uk_people_onboarding_active_email'
  )
  AND seq_in_index = 1;

SELECT
  CASE
    WHEN COUNT(*) = 6 THEN 'PASS'
    ELSE CONCAT('FAIL: onboarding CHECK constraints = ', COUNT(*), ' / 6')
  END AS result
FROM information_schema.table_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'people_onboarding_cases'
  AND constraint_type = 'CHECK'
  AND constraint_name IN (
    'ck_people_onboarding_identity',
    'ck_people_onboarding_uid_not_synthetic',
    'ck_people_onboarding_manager_uid_not_synthetic',
    'ck_people_onboarding_actor',
    'ck_people_onboarding_terminal_audit',
    'ck_people_onboarding_completed_requires_uid'
  );

-- 候选单绝不能持有合成主体：这正是本设计要消除的分叉来源。
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE CONCAT('FAIL: onboarding rows holding a synthetic dt-* uid = ', COUNT(*))
  END AS result
FROM people_onboarding_cases
WHERE LOWER(COALESCE(canonical_uid, '')) LIKE 'dt-%'
   OR LOWER(COALESCE(manager_uid, '')) LIKE 'dt-%';

-- 候选不是员工：两张表不得出现同一个 UID 同时存在的中间态之外的重叠。
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE CONCAT('FAIL: cancelled onboarding cases still holding a canonical uid = ', COUNT(*))
  END AS result
FROM people_onboarding_cases
WHERE status = 'cancelled' AND canonical_uid IS NOT NULL;
