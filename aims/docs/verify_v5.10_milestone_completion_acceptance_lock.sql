SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS completion_lock_column,
  CASE
    WHEN COUNT(*) = 1 THEN 'v5.6 prerequisite satisfied'
    ELSE 'Run migration_v5.6_project_governance.sql successfully before v5.10'
  END AS remediation
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'milestones'
  AND COLUMN_NAME = 'completion_lock_request_id';

SELECT trigger_name, event_manipulation, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_schema = DATABASE()
  AND trigger_name IN (
    'trg_milestone_completion_lock_update',
    'trg_milestone_completion_lock_delete',
    'trg_work_item_completion_lock_insert',
    'trg_work_item_completion_lock_update',
    'trg_work_item_completion_lock_delete',
    'trg_deliverable_completion_lock_insert',
    'trg_deliverable_completion_lock_update',
    'trg_deliverable_completion_lock_delete'
  )
ORDER BY trigger_name;

SELECT CASE WHEN COUNT(*) = 8 THEN 'PASS' ELSE 'FAIL' END AS acceptance_lock_triggers
FROM information_schema.triggers
WHERE trigger_schema = DATABASE()
  AND trigger_name IN (
    'trg_milestone_completion_lock_update',
    'trg_milestone_completion_lock_delete',
    'trg_work_item_completion_lock_insert',
    'trg_work_item_completion_lock_update',
    'trg_work_item_completion_lock_delete',
    'trg_deliverable_completion_lock_insert',
    'trg_deliverable_completion_lock_update',
    'trg_deliverable_completion_lock_delete'
  );
