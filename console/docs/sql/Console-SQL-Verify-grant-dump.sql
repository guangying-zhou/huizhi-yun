-- 直接导出各应用 service client 的全部 active grant（只读）
-- 用途：不再靠猜 scope 形态，直接看每个调用方实际持有什么。
SELECT
  c.`app_code`,
  c.`client_code`,
  CONCAT(g.`resource_code`, ':', g.`action`) AS `granted_scope`,
  JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.source'))   AS `source`,
  JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.audience')) AS `audience`
FROM `service_client_grants` g
JOIN `service_clients` c ON c.`id` = g.`service_client_id`
WHERE g.`status` = 'active'
  AND c.`status` = 'active'
ORDER BY c.`app_code`, c.`client_code`, `granted_scope`;
