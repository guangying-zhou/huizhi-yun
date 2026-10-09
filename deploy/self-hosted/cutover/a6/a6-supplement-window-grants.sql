-- S4 A6 supplement 2/2 (A15 R3 P0-13, WINDOW-TEMPORARY). Reviewed file; apply as MySQL root AFTER B10 and BEFORE B11;
-- revoke with a6-supplement-window-revoke.sql after B12 (drain activate) has completed.
-- hzy-enterprise-drain verify/activate runs SELECT ... FOR SHARE on the provider schemas inside the activation
-- transaction (internal/migrations/unified/external_drain_verifier.go). MySQL requires SELECT plus one of
-- UPDATE/DELETE/LOCK TABLES; LOCK TABLES is the least powerful of the three. The four schemas are the ones the R3
-- verifier actually read. Schema-level only; no global privileges.
GRANT SELECT, LOCK TABLES ON `hzy\_console`.* TO 'hzy_cutover'@'localhost';
GRANT SELECT, LOCK TABLES ON `hzy\_codocs`.* TO 'hzy_cutover'@'localhost';
GRANT SELECT, LOCK TABLES ON `hzy\_finance`.* TO 'hzy_cutover'@'localhost';
GRANT SELECT, LOCK TABLES ON `hzy\_people`.* TO 'hzy_cutover'@'localhost';
