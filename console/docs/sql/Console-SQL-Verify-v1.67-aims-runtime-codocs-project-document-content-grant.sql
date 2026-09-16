-- Console SQL Verify v1.67: Aims runtime -> Codocs exact project-document content read.
-- Expected: one active credential-backed aims.runtime row with the exact grant.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(
    scg.`resource_code` = 'codocs:project-document:content'
    AND scg.`action` = 'read'
    AND scg.`status` = 'active'
  ) AS `has_project_document_content_read`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'aims' AND sc.`client_code` = 'aims.runtime'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;
