-- HZY P3/P4 demo-data seed index. DO NOT EXECUTE THIS FILE AS A DATABASE SEED.
-- manifest-version: 1
-- key-prefix: DEMO-P3P4-202607-
-- module-order: codocs,people,aims,assets,altoc,finance
-- files:
--   codocs/seed.sql
--   people/seed.sql
--   aims/seed.sql
--   assets/seed.sql
--   altoc/seed.sql
--   finance/seed.sql
-- Each child script must be executed against that module's configured database.

SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Index only: execute docs/demo/p3-p4/<module>/seed.sql against each module database; see README.md';
