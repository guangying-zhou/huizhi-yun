-- READ ONLY. Run using an approved local administrator connection.
-- Do not reuse the existing app Runtime connection: it cannot read mysql.user.
SELECT @@server_uuid AS instance_id;
SELECT User,Host,account_locked
FROM mysql.user WHERE User='hzy_enterprise_test_runtime' AND Host='localhost';
SELECT TABLE_SCHEMA,PRIVILEGE_TYPE,IS_GRANTABLE
FROM information_schema.SCHEMA_PRIVILEGES
WHERE GRANTEE=CONCAT(CHAR(39),'hzy_enterprise_test_runtime',CHAR(39),'@',CHAR(39),'localhost',CHAR(39)) ORDER BY TABLE_SCHEMA,PRIVILEGE_TYPE;
SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES
WHERE GRANTEE=CONCAT(CHAR(39),'hzy_enterprise_test_runtime',CHAR(39),'@',CHAR(39),'localhost',CHAR(39));
SELECT TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES
WHERE GRANTEE=CONCAT(CHAR(39),'hzy_enterprise_test_runtime',CHAR(39),'@',CHAR(39),'localhost',CHAR(39));
SELECT FROM_USER,FROM_HOST,TO_USER,TO_HOST FROM mysql.role_edges
WHERE TO_USER='hzy_enterprise_test_runtime' AND TO_HOST='localhost';
SELECT PRIV,WITH_GRANT_OPTION FROM mysql.global_grants
WHERE USER='hzy_enterprise_test_runtime' AND HOST='localhost';
-- Expected after provisioning: one unlocked account, exactly four non-grantable
-- schema privileges (DELETE, INSERT, SELECT, UPDATE) on
-- hzy_enterprise_shadow_review_20260913, plus exactly 55 non-grantable TABLE_PRIVILEGES
-- rows with SHOW VIEW for the controlled compatibility views. No schema-level
-- SHOW VIEW, source-schema/object grants, roles, global grants, or GRANT OPTION.
-- This file neither creates an account nor changes privileges.
