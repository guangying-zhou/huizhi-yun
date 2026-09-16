-- Console SQL Verify v1.53: Altoc -> Codocs exact entity-document commands.
-- Run only after v1.53 has been approved and applied.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT sc.`client_code`, sc.`app_code`, sc.`status` AS `client_status`, scc.`status` AS `credential_status`,
  MAX(scg.`resource_code` = 'codocs:altoc-entity-document:content' AND scg.`action` = 'read' AND scg.`status` = 'active') AS `has_entity_document_content_read`,
  MAX(scg.`resource_code` = 'codocs:altoc-entity-document' AND scg.`action` = 'attach' AND scg.`status` = 'active') AS `has_entity_document_attach`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'altoc' AND sc.`client_code` = 'altoc'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`status`;
