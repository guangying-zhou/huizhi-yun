-- Console SQL Seed v1.53: Altoc -> Codocs exact entity-document commands.
-- NOT EXECUTED. Apply only through the approved Console change procedure.
-- Does not create credentials, browser grants, document ACLs, or entity access.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

INSERT INTO `service_client_grants` (`service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`)
SELECT sc.`id`, grants.`resource_code`, grants.`action`, JSON_OBJECT(
  'source', 'seed:v1.53', 'audience', 'codocs', 'purpose', grants.`purpose`, 'endpoints', grants.`endpoints`
), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
CROSS JOIN (
  SELECT 'codocs:altoc-entity-document:content' AS `resource_code`, 'read' AS `action`,
    'altoc-codocs-entity-document-content-read' AS `purpose`, JSON_ARRAY('/api/v1/service/altoc-entity-documents/{uuid}/content') AS `endpoints`
  UNION ALL
  SELECT 'codocs:altoc-entity-document', 'attach',
    'altoc-codocs-entity-document-attach', JSON_ARRAY('/api/v1/service/altoc-entity-documents/{uuid}/attach')
) grants
WHERE sc.`status` = 'active' AND sc.`app_code` = 'altoc' AND sc.`client_code` = 'altoc'
ON DUPLICATE KEY UPDATE `scope_json` = VALUES(`scope_json`), `status` = 'active', `updated_at` = UTC_TIMESTAMP();

COMMIT;
