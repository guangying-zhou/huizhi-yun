-- S4 A6 supplement: revoke the window-temporary provider-schema grants after B12 (drain activate) has completed.
-- The permanent SHOW VIEW grant for hzy_rt_enterprise is NOT touched here.
REVOKE SELECT, LOCK TABLES ON `hzy\_console`.* FROM 'hzy_cutover'@'localhost';
REVOKE SELECT, LOCK TABLES ON `hzy\_codocs`.* FROM 'hzy_cutover'@'localhost';
REVOKE SELECT, LOCK TABLES ON `hzy\_finance`.* FROM 'hzy_cutover'@'localhost';
REVOKE SELECT, LOCK TABLES ON `hzy\_people`.* FROM 'hzy_cutover'@'localhost';
