-- Console SQL Seed v2.5: AA-04 Aims milestone receivable coordinator grants.
--
-- The enabled callback obtains one Runtime-audience legacy Aims ingress scope
-- plus the fixed Altoc business capability. Both audiences are installed so a
-- tenant-runtime audience migration cannot silently disable the coordinator.
-- Audience-qualified grant records map to the same canonical semantic capability;
-- the unqualified target grant is retained for current Runtime revocation checks.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- The NOT EXISTS predicate intentionally leaves any existing scope_json and
-- status untouched. A revoked or constrained grant requires the explicit
-- authorized management repair path; this preparation script never reactivates it.
INSERT INTO `service_client_grants` (
  `service_client_id`, `resource_code`, `action`, `scope_json`, `status`, `created_at`, `updated_at`
)
SELECT
  sc.`id`, grants.`resource_code`, grants.`action`,
  JSON_OBJECT(
    'source', 'seed:v2.5',
    'purpose', 'aims-milestone-receivable-coordinator',
    'semanticScope', grants.`semantic_scope`,
    'audience', grants.`audience`
  ),
  'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `service_clients` sc
JOIN (
  SELECT 'data-runtime:aims' AS `resource_code`, 'write' AS `action`, 'aims.write' AS `semantic_scope`, 'data-runtime' AS `audience`
  UNION ALL SELECT 'tenant-runtime:aims', 'write', 'aims.write', 'tenant-runtime'
  UNION ALL SELECT 'altoc:receivable', 'mark-billable', 'altoc:receivable:mark-billable', 'altoc'
  UNION ALL SELECT 'data-runtime:altoc:receivable', 'mark-billable', 'altoc:receivable:mark-billable', 'data-runtime'
  UNION ALL SELECT 'tenant-runtime:altoc:receivable', 'mark-billable', 'altoc:receivable:mark-billable', 'tenant-runtime'
) grants
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'aims' OR sc.`client_code` IN ('aims', 'aims.runtime'))
  AND NOT EXISTS (
    SELECT 1
    FROM `service_client_grants` existing
    WHERE existing.`service_client_id` = sc.`id`
      AND existing.`resource_code` = grants.`resource_code`
      AND existing.`action` = grants.`action`
  );
COMMIT;
