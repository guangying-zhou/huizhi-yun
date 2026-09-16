-- Console SQL Verify v1.50: Aims -> Codocs project cabinet service grants.
-- Run only after the v1.50 seed has been approved and applied.
-- Expected active Aims service clients to have all three flags set to 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`, sc.`app_code`, sc.`status` AS `client_status`,
  scc.`client_id`, scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'codocs:project-cabinet' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_project_cabinet_read`,
  MAX(scg.`resource_code` = 'codocs:project-cabinet' AND scg.`action` = 'upload' AND scg.`status` = 'active') AS `has_project_cabinet_upload`,
  MAX(scg.`resource_code` = 'codocs:project-cabinet' AND scg.`action` = 'delete' AND scg.`status` = 'active') AS `has_project_cabinet_delete`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime')
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;
