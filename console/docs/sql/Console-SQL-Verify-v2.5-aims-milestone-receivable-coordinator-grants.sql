-- Console SQL Verify v2.5: AA-04 Aims milestone receivable coordinator grants.
-- Read-only. Each expected grant is reported as ACTIVE, MISSING, or NOT_ACTIVE.
-- Any non-ACTIVE row means the enabled callback must remain disabled.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`id` AS `service_client_id`, sc.`client_code`, expected.`resource_code`, expected.`action`,
  CASE
    WHEN g.`id` IS NULL THEN 'MISSING'
    WHEN g.`status` <> 'active' THEN 'NOT_ACTIVE'
    WHEN expected.`audience` IS NOT NULL AND (
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.audience')), '') <> expected.`audience`
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.`scope_json`, '$.semanticScope')), '') <> expected.`semantic_scope`)
      THEN 'BINDING_MISMATCH'
    ELSE 'ACTIVE'
  END AS `verification_status`
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:aims' AS `resource_code`, 'write' AS `action`, 'data-runtime' AS `audience`, 'aims.write' AS `semantic_scope`
  UNION ALL SELECT 'tenant-runtime:aims', 'write', 'tenant-runtime', 'aims.write'
  UNION ALL SELECT 'altoc:receivable', 'mark-billable', NULL, NULL
  UNION ALL SELECT 'data-runtime:altoc:receivable', 'mark-billable', 'data-runtime', 'altoc:receivable:mark-billable'
  UNION ALL SELECT 'tenant-runtime:altoc:receivable', 'mark-billable', 'tenant-runtime', 'altoc:receivable:mark-billable'
) expected
LEFT JOIN `service_client_grants` g
  ON g.`service_client_id` = sc.`id`
 AND g.`resource_code` = expected.`resource_code`
 AND g.`action` = expected.`action`
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
ORDER BY sc.`id`, expected.`resource_code`, expected.`action`;
