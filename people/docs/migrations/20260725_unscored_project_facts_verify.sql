USE `hzy_people`;

SELECT
  CASE
    WHEN COUNT(*) = 2 THEN 'PASS'
    ELSE CONCAT('FAIL: expected contribution_score + score_status columns, got ', COUNT(*))
  END AS result
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'people_contribution_snapshots'
  AND (
    (column_name = 'contribution_score' AND is_nullable = 'YES')
    OR
    (column_name = 'score_status' AND column_type = 'enum(''unscored'',''scored'')')
  );

SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE CONCAT('FAIL: invalid unscored rows = ', COUNT(*))
  END AS result
FROM people_contribution_snapshots
WHERE score_status = 'unscored'
  AND contribution_score IS NOT NULL;
