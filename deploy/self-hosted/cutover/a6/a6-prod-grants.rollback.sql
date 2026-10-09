-- S4 A6 rollback: revoke exactly the grants added by a6-prod-grants.sql.
REVOKE SELECT, INSERT, UPDATE, CREATE, TRIGGER ON `hzy\_aims\_src`.* FROM 'hzy_cutover'@'localhost';
REVOKE SELECT, INSERT, UPDATE, CREATE, TRIGGER ON `hzy\_assets\_src`.* FROM 'hzy_cutover'@'localhost';
REVOKE SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, CREATE VIEW, SHOW VIEW, TRIGGER ON `hzy\_enterprise`.* FROM 'hzy_cutover'@'localhost';
REVOKE SELECT, INSERT, UPDATE, DELETE ON `hzy\_enterprise`.* FROM 'hzy_rt_enterprise'@'localhost';
