SELECT
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS reviewer_role_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'approval_records'
  AND COLUMN_NAME IN ('reviewer_role_code', 'reviewer_role_revision');

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS reviewer_role_index
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'approval_records'
  AND INDEX_NAME = 'idx_approval_reviewer_role';

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS completion_lock_column,
  CASE
    WHEN COUNT(*) = 1 THEN 'v5.6 prerequisite satisfied'
    ELSE 'Run migration_v5.6_project_governance.sql successfully, then rerun v5.9'
  END AS remediation
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'milestones'
  AND COLUMN_NAME = 'completion_lock_request_id';
