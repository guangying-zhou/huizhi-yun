-- Console SQL Verify v1.99: expected one active credential-backed aims.runtime
-- row with both has_* flags equal to 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  credential.`client_id`,
  credential.`status` AS `credential_status`,
  MAX(
    grant_row.`resource_code` = 'data-runtime:codocs'
    AND grant_row.`action` = 'read'
    AND grant_row.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(grant_row.`scope_json`, '$.semanticScope')) = 'codocs.read'
    AND JSON_UNQUOTE(JSON_EXTRACT(grant_row.`scope_json`, '$.audience')) = 'data-runtime'
  ) AS `has_data_runtime_codocs_read`,
  MAX(
    grant_row.`resource_code` = 'tenant-runtime:codocs'
    AND grant_row.`action` = 'read'
    AND grant_row.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(grant_row.`scope_json`, '$.semanticScope')) = 'codocs.read'
    AND JSON_UNQUOTE(JSON_EXTRACT(grant_row.`scope_json`, '$.audience')) = 'tenant-runtime'
  ) AS `has_tenant_runtime_codocs_read`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` credential
  ON credential.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` grant_row
  ON grant_row.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'aims'
  AND sc.`client_code` = 'aims.runtime'
GROUP BY
  sc.`client_code`,
  sc.`app_code`,
  sc.`status`,
  credential.`client_id`,
  credential.`status`
ORDER BY sc.`client_code`;
