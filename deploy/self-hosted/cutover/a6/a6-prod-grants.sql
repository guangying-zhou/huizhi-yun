-- S4 A6: production-named schema grants on the self-hosted MySQL. Reviewed file; apply once as MySQL root.
-- Schema-level only. No global privileges. `_` is escaped so it is a literal underscore, not a wildcard.
-- hzy_migrator already holds `hzy\_%` (creates the databases in B5); hzy_backup already holds `hzy\_%` read.

-- Cutover account: source copies (read + fence/probe writes) and the unified target.
GRANT SELECT, INSERT, UPDATE, CREATE, TRIGGER ON `hzy\_aims\_src`.* TO 'hzy_cutover'@'localhost';
GRANT SELECT, INSERT, UPDATE, CREATE, TRIGGER ON `hzy\_assets\_src`.* TO 'hzy_cutover'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, CREATE VIEW, SHOW VIEW, TRIGGER ON `hzy\_enterprise`.* TO 'hzy_cutover'@'localhost';

-- Runtime accounts: DML only on their own production schema (hzy_rt_console/workflow/codocs already hold theirs, verified by read-back).
GRANT SELECT, INSERT, UPDATE, DELETE ON `hzy\_enterprise`.* TO 'hzy_rt_enterprise'@'localhost';
