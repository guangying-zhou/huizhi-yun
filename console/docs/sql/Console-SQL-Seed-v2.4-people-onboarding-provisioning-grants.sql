-- Console SQL Seed v2.4: People 受控入职的身份预留与 LDAP 开户授权。
--
-- 每个 capability 都必须有独立、精确且 active 的 grant：
-- console:directory-identity:reserve 不蕴含 console:directory-user:provision，
-- 既有的 console:directory-employment:sync 也不能替代二者。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, grant_row.resource_code, grant_row.action,
       JSON_OBJECT('source','seed:v2.4','purpose','people-onboarding-provisioning'),
       'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
CROSS JOIN (
  SELECT 'console:directory-identity' resource_code,'reserve' action
  UNION ALL SELECT 'console:directory-user','provision'
) grant_row
WHERE sc.status='active' AND (sc.app_code='people' OR sc.client_code IN ('people','people.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
COMMIT;
