SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result,
  'company_weekly_summaries.draft_content_json exists' AS assertion
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'company_weekly_summaries'
  AND column_name = 'draft_content_json'
  AND data_type = 'json';
