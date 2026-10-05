-- Console SQL Verify v2.3: Altoc -> Aims 商机项目创建双 runtime audience 授权。
-- 三行必须全部返回 granted=1；实际发布前仍需做真实令牌签发探测。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT required.required_scope,
       EXISTS(
         SELECT 1
         FROM service_client_grants g
         JOIN service_clients c ON c.id=g.service_client_id
         WHERE g.status='active' AND c.status='active'
           AND (c.app_code='altoc' OR c.client_code IN ('altoc','altoc.runtime'))
           AND CONCAT(g.resource_code,':',g.action)=required.required_scope
       ) AS granted
FROM (
  SELECT 'aims:project:create-from-opportunity' AS required_scope
  UNION ALL SELECT 'data-runtime:aims:project:create-from-opportunity'
  UNION ALL SELECT 'tenant-runtime:aims:project:create-from-opportunity'
) required;
