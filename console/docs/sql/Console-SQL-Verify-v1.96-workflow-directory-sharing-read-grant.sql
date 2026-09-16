-- Console SQL Verify v1.96: Workflow restricted Directory sharing read grant.
-- Expected: one active credential-backed workflow.runtime row with the exact
-- capability. has_directory_users_read must be 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(
    scg.`resource_code` = 'console:directory-users'
    AND scg.`action` = 'read'
    AND scg.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.semanticScope')) = 'console:directory-users:read'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.audience')) = 'console'
  ) AS `has_directory_users_read`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'workflow' AND sc.`client_code` = 'workflow.runtime'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;
