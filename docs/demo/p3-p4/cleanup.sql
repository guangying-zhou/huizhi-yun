-- HZY P3/P4 demo-data cleanup index. DO NOT EXECUTE THIS FILE DIRECTLY.
-- manifest-version: 1
-- key-prefix: DEMO-P3P4-202607-
-- module-order: finance,codocs,altoc,assets,aims,people
-- files:
--   finance/cleanup.sql
--   codocs/cleanup.sql
--   altoc/cleanup.sql
--   assets/cleanup.sql
--   aims/cleanup.sql
--   people/cleanup.sql
-- Each cleanup is scoped to DEMO-P3P4-202607-* stable keys and keeps FK checks enabled.

SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Index only: execute docs/demo/p3-p4/<module>/cleanup.sql against each module database; see README.md';
