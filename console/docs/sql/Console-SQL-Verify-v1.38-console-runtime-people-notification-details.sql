-- Console SQL Verify v1.38: Console runtime People notification-detail grant.
-- This query returns identifiers/status only. It never reads or prints secret material.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  sc.`current_credential_id`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  vs.`secret_code`,
  vs.`storage_backend`,
  vs.`status` AS `secret_status`,
  COUNT(DISTINCT CASE WHEN scg.`status` = 'active' THEN CONCAT(scg.`resource_code`, ':', scg.`action`) END) AS `active_grant_count`,
  CASE
    WHEN sc.`id` IS NULL THEN 'FAIL_CLIENT_MISSING'
    WHEN sc.`status` <> 'active' OR sc.`app_code` <> 'console' THEN 'FAIL_CLIENT'
    WHEN COALESCE(sc.`current_credential_id`, 0) = 0 THEN 'FAIL_CREDENTIAL_MISSING'
    WHEN scc.`status` <> 'active' OR (scc.`expires_at` IS NOT NULL AND scc.`expires_at` <= UTC_TIMESTAMP()) THEN 'FAIL_CREDENTIAL_INACTIVE'
    WHEN vs.`status` <> 'active' OR vsv.`status` <> 'active' OR vs.`current_version_id` <> vsv.`id` THEN 'FAIL_VAULT_BINDING'
    WHEN COUNT(DISTINCT CASE
      WHEN scg.`status` = 'active' AND CONCAT(scg.`resource_code`, ':', scg.`action`) IN (
        'data-runtime:runtime:update',
        'notification-runtime:send',
        'tenant-runtime:runtime:update',
        'webdev:issue:read',
        'webdev:issue:write',
        'aims:notification-details:authorize',
        'assets:notification-details:authorize',
        'people:notification-details:authorize',
        'workflow:action_defs:sync',
        'workflow:notification-details:authorize',
        'workflow:proxy'
      ) THEN CONCAT(scg.`resource_code`, ':', scg.`action`)
    END) <> 11 THEN 'FAIL_GRANTS'
    ELSE 'PASS'
  END AS `verification_status`
FROM (SELECT 'console.runtime' AS `client_code`) expected
LEFT JOIN `service_clients` sc
  ON sc.`client_code` = expected.`client_code`
LEFT JOIN `service_client_credentials` scc
  ON scc.`id` = sc.`current_credential_id`
 AND scc.`service_client_id` = sc.`id`
LEFT JOIN `vault_secrets` vs
  ON vs.`id` = scc.`secret_id`
LEFT JOIN `vault_secret_versions` vsv
  ON vsv.`id` = vs.`current_version_id`
 AND vsv.`secret_id` = vs.`id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id` = sc.`id`
GROUP BY
  sc.`id`, sc.`client_code`, sc.`app_code`, sc.`status`, sc.`current_credential_id`,
  scc.`client_id`, scc.`status`, scc.`expires_at`,
  vs.`secret_code`, vs.`storage_backend`, vs.`status`, vs.`current_version_id`,
  vsv.`id`, vsv.`status`;
