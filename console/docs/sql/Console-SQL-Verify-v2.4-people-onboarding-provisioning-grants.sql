-- 发布前必须在目标租户执行。只验证 SQL 行存在不足以证明 worker 授权完成：
-- 还需用实际 service client 对全部组合 scope 做一次令牌签发探测。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  CASE
    WHEN COUNT(*) = 2 THEN 'PASS'
    ELSE CONCAT('FAIL: active onboarding provisioning grants = ', COUNT(*), ' / 2')
  END AS result
FROM service_client_grants g
JOIN service_clients sc ON sc.id = g.service_client_id
WHERE g.status = 'active'
  AND sc.status = 'active'
  AND (sc.app_code = 'people' OR sc.client_code IN ('people', 'people.runtime'))
  AND CONCAT(g.resource_code, ':', g.action) IN (
    'console:directory-identity:reserve',
    'console:directory-user:provision'
  );

-- 逐条列出，便于确认是哪一个 capability 缺失或被停用。
SELECT
  sc.client_code,
  CONCAT(g.resource_code, ':', g.action) AS capability,
  g.status
FROM service_client_grants g
JOIN service_clients sc ON sc.id = g.service_client_id
WHERE (sc.app_code = 'people' OR sc.client_code IN ('people', 'people.runtime'))
  AND g.resource_code IN ('console:directory-identity', 'console:directory-user')
ORDER BY sc.client_code, capability;
