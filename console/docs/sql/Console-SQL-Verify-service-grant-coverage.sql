-- Console 服务授权全量核验
-- 代码中实际请求的每一个 scope，是否在 service_client_grants 中有 active grant
-- 覆盖 117 条 scope 需求，来源：各应用 server/ 目录 `scope: '...'` 与入站桥接契约全量提取
-- 只读脚本；在租户 Console 库执行。

SELECT `app_code`, `required_scope`,
       CASE WHEN `granted`=1 THEN 'OK' ELSE '** MISSING **' END AS `status`
FROM (
  SELECT 'aims' AS `app_code`, 'aims.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:write')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:integration_operation:execute' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:integration_operation:execute')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:notification-details:authorize' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:notification-details:authorize')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:project-management-facts:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:project-management-facts:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:project-management-facts:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:project-management-facts:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:service-ticket:work-item:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:service-ticket:work-item:create' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:service-ticket:work-item:create' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:service-ticket:work-item:create')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:tasks:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:tasks:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:tasks:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:tasks:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'aims:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:write')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'altoc:receivable:mark-billable' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:receivable:mark-billable')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'altoc:service-ticket:delivery-result:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:service-ticket:delivery-result:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'assets:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'assets:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:write')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:write')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs:company-weekly-summary:publish' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:company-weekly-summary:publish')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs:department-documents:list' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:department-documents:list')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs:project-document:content:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:content:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs:project-document:review-content:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:review-content:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs:project-document:review-grant:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:review-grant:create')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'codocs:project-document:version:resolve' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:version:resolve')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'console:authorization-role-holders:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='console:authorization-role-holders:read')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'people:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='people:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:write')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'system_settings:view' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='system_settings:view' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:system_settings:view' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:system_settings:view')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'workflow:action_defs:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:action_defs:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'workflow:callback' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:callback')
    ) AS `granted`
  UNION ALL
  SELECT 'aims' AS `app_code`, 'workflow:instances:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='aims' OR c.`client_code` IN ('aims','aims.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:instances:read')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'aims:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:read')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'aims:project:create-from-opportunity' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:project:create-from-opportunity' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:project:create-from-opportunity' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:project:create-from-opportunity')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:read')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:write')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:contract:admin' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:admin' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:contract:admin' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:contract:admin')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:contract:delivery-asset-status:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:delivery-asset-status:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:contract:delivery-asset-status:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:contract:delivery-asset-status:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:contract:edit' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:contract:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:contract:edit')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:contract:finance-summary:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:finance-summary:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:contract:finance-summary:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:contract:finance-summary:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:contract:view' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:view' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:contract:view' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:contract:view')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:customer:view' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:customer:view' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:customer:view' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:customer:view')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:integration_operation:execute' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:integration_operation:execute')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:lead:assign' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:lead:assign' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:lead:assign' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:lead:assign')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:lead:edit' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:lead:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:lead:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:lead:edit')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:notification-details:authorize' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:notification-details:authorize')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:opportunity:assign' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:opportunity:assign' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:opportunity:assign' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:opportunity:assign')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:opportunity:edit' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:opportunity:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:opportunity:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:opportunity:edit')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:read')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:receivable:edit' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:receivable:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:receivable:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:receivable:edit')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:receivable:mark-billable' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:receivable:mark-billable' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:receivable:mark-billable' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:receivable:mark-billable')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:service-ticket:delivery-result:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:service-ticket:delivery-result:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:service-ticket:delivery-result:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:service-ticket:delivery-result:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:service_ticket:edit' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:service_ticket:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:service_ticket:edit' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:service_ticket:edit')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'altoc:service_ticket:view' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:service_ticket:view' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:altoc:service_ticket:view' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:altoc:service_ticket:view')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'assets:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:read')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'assets:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:write')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'codocs:documents:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:documents:read')
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'finance:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:read')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'aims:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:read')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'altoc:contract:delivery-asset-status:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:delivery-asset-status:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:read')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:write')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets:integration_operation:execute' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:integration_operation:execute')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets:notification-details:authorize' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:notification-details:authorize')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets:offboarding-recovery:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:offboarding-recovery:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:offboarding-recovery:sync' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:offboarding-recovery:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:read')
    ) AS `granted`
  UNION ALL
  SELECT 'assets' AS `app_code`, 'assets:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='assets' OR c.`client_code` IN ('assets','assets.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:assets:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:assets:write')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:write')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:altoc-entity-document:attach' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:altoc-entity-document:attach' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:altoc-entity-document:attach' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:altoc-entity-document:attach')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:altoc-entity-document:content:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:altoc-entity-document:content:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:altoc-entity-document:content:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:altoc-entity-document:content:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:company-weekly-summary:publish' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:company-weekly-summary:publish' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:company-weekly-summary:publish' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:company-weekly-summary:publish')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:department-documents:list' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:department-documents:list' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:department-documents:list' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:department-documents:list')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:documents:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:documents:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:documents:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:documents:write')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-cabinet:delete' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-cabinet:delete' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-cabinet:delete' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-cabinet:delete')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-cabinet:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-cabinet:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-cabinet:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-cabinet:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-cabinet:upload' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-cabinet:upload' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-cabinet:upload' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-cabinet:upload')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-document:content:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:content:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-document:content:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-document:content:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-document:review-content:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:review-content:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-document:review-content:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-document:review-content:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-document:review-grant:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:review-grant:create' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-document:review-grant:create' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-document:review-grant:create')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'codocs:project-document:version:resolve' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='codocs:project-document:version:resolve' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:codocs:project-document:version:resolve' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:codocs:project-document:version:resolve')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'console:directory-project-access:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='console:directory-project-access:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'console:directory-users:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='console:directory-users:read')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'workflow:callback' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:callback')
    ) AS `granted`
  UNION ALL
  SELECT 'codocs' AS `app_code`, 'workflow:document-publish:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='codocs' OR c.`client_code` IN ('codocs','codocs.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:document-publish:create')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'aims.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'altoc:contract:finance-summary:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='altoc:contract:finance-summary:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance.invoices.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:invoices.read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:invoices.read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance.project_accounting.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:project_accounting.read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:project_accounting.read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance.reports.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:reports.read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:reports.read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance.settings.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:settings.read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:settings.read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:write')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance:integration_operation:execute' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='finance:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:integration_operation:execute')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance:invoice-request:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='finance:invoice-request:create' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:invoice-request:create' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:invoice-request:create')
    ) AS `granted`
  UNION ALL
  -- 调用方侧覆盖（Stream B 走查 ISSUE-B-001 / B-010）。
  -- 本脚本原先只校验「目标应用能不能调自己的 runtime」，不校验「调用方能不能
  -- 调目标应用」，因此 altoc -> finance / altoc -> aims 的精确 capability 在生产
  -- 整体缺失却一直没被发现。跨应用 capability 必须两侧都校验。
  SELECT 'altoc' AS `app_code`, 'finance:invoice-request:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND CONCAT(g.`resource_code`,':',g.`action`)='finance:invoice-request:create'
    ) AS `granted`
  UNION ALL
  SELECT 'altoc' AS `app_code`, 'aims:service-ticket:work-item:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='altoc' OR c.`client_code` IN ('altoc','altoc.runtime'))
        AND CONCAT(g.`resource_code`,':',g.`action`)='aims:service-ticket:work-item:create'
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance:notification-details:authorize' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='finance:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:notification-details:authorize')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'finance:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'people.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:read')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'system_settings:view' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='system_settings:view' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:system_settings:view' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:system_settings:view')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'workflow:callback' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:callback')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'workflow:invoice-request:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:invoice-request:create')
    ) AS `granted`
  UNION ALL
  SELECT 'finance' AS `app_code`, 'workflow:proxy' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='finance' OR c.`client_code` IN ('finance','finance.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:proxy' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:proxy' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:proxy')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'aims.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:aims:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:aims:read')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'assets:offboarding-recovery:sync' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='assets:offboarding-recovery:sync')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'console_directory:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='console_directory:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:console_directory:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:console_directory:write')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'finance:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:finance:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:finance:read')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'people.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:read')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'people.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:write')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'people:integration_operation:execute' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='people:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:integration_operation:execute' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:integration_operation:execute')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'people:notification-details:authorize' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='people:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:notification-details:authorize')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'people:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='people:read' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:read')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'people:write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='people:write' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:people:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:people:write')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'system_settings:view' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='system_settings:view' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:system_settings:view' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:system_settings:view')
    ) AS `granted`
  UNION ALL
  SELECT 'people' AS `app_code`, 'workflow:callback' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='people' OR c.`client_code` IN ('people','people.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:callback')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'console:authorization-role-holders:read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='console:authorization-role-holders:read')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'notifications:publish' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='notifications:publish' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:notifications:publish' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:notifications:publish')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'workflow.read' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:read' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:read')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'workflow.write' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:write' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:write')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'workflow:callback' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:callback' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:callback')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'workflow:document-publish:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:document-publish:create' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:document-publish:create' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:document-publish:create')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'workflow:invoice-request:create' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:invoice-request:create' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:invoice-request:create' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:invoice-request:create')
    ) AS `granted`
  UNION ALL
  SELECT 'workflow' AS `app_code`, 'workflow:notification-details:authorize' AS `required_scope`,
    EXISTS(
      SELECT 1 FROM `service_client_grants` g
      JOIN `service_clients` c ON c.`id`=g.`service_client_id`
      WHERE g.`status`='active' AND c.`status`='active'
        AND (c.`app_code`='workflow' OR c.`client_code` IN ('workflow','workflow.runtime'))
        AND (CONCAT(g.`resource_code`,':',g.`action`)='workflow:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='data-runtime:workflow:notification-details:authorize' OR CONCAT(g.`resource_code`,':',g.`action`)='tenant-runtime:workflow:notification-details:authorize')
    ) AS `granted`
) checks
ORDER BY `granted` ASC, `app_code`, `required_scope`;
