-- Console SQL Verify v1.94: Aims runtime -> Codocs department document list.
-- Expected: one active credential-backed aims.runtime row with the exact
-- capability. has_department_documents_list must be 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(
    scg.`resource_code` = 'codocs:department-documents'
    AND scg.`action` = 'list'
    AND scg.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.semanticScope')) = 'codocs:department-documents:list'
  ) AS `has_department_documents_list`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'aims' AND sc.`client_code` = 'aims.runtime'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;
