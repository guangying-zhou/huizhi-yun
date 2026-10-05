-- HZY P3/P4 demo-data verification index. DO NOT EXECUTE THIS FILE DIRECTLY.
-- manifest-version: 1
-- key-prefix: DEMO-P3P4-202607-
-- module-order: people,aims,finance,altoc,codocs,assets
-- files:
--   people/verify.sql
--   aims/verify.sql
--   finance/verify.sql
--   altoc/verify.sql
--   codocs/verify.sql
--   assets/verify.sql
-- Every child verifier returns phase/check_code/status/expected/actual/evidence.

SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Index only: execute docs/demo/p3-p4/<module>/verify.sql against each module database; see README.md';
