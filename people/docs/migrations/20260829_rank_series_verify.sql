USE `hzy_people`;

SELECT
  CASE
    WHEN COUNT(*) = 1 THEN 'PASS'
    ELSE CONCAT('FAIL: rank_series metadata checks passed = ', COUNT(*), ' / 1')
  END AS result
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'people_ranks'
  AND column_name = 'rank_series'
  AND REPLACE(LOWER(column_type), ' ', '') = 'enum(''m'',''p'')'
  AND is_nullable = 'NO'
  AND column_default = 'P';

SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE CONCAT('FAIL: ranks without a series = ', COUNT(*))
  END AS result
FROM people_ranks
WHERE rank_series IS NULL;

SELECT
  CASE
    WHEN COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '') = 'rank_series,rank_level,enabled,sort_order' THEN 'PASS'
    ELSE CONCAT('FAIL: idx_people_rank_series_level columns = ', COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '<missing>'))
  END AS result
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'people_ranks'
  AND index_name = 'idx_people_rank_series_level';

SELECT
  CASE
    WHEN COUNT(*) = 2 THEN 'PASS'
    ELSE CONCAT('FAIL: rank dictionary CHECK constraints = ', COUNT(*), ' / 2')
  END AS result
FROM information_schema.table_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'people_ranks'
  AND constraint_name IN ('ck_people_rank_numeric', 'ck_people_rank_enabled')
  AND constraint_type = 'CHECK';
