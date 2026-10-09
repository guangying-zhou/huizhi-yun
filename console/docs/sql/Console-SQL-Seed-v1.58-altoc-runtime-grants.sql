-- Console SQL Seed v1.58: Altoc tenant-runtime transport and capability grants.
-- Date: 2026-07-13
--
-- Altoc's BFF requests one short-lived token per runtime call.  The token
-- carries both the read/write transport scope and the exact business
-- capability selected from the server-owned route table.  Console requires
-- every requested scope to be namespaced by its audience, so install the
-- data-runtime and legacy tenant-runtime variants together.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  sc.`id`,
  LEFT(
    CONCAT(audiences.`audience`, ':', scopes.`token_suffix`),
    LENGTH(CONCAT(audiences.`audience`, ':', scopes.`token_suffix`))
      - LENGTH(SUBSTRING_INDEX(CONCAT(audiences.`audience`, ':', scopes.`token_suffix`), ':', -1)) - 1
  ) AS `resource_code`,
  SUBSTRING_INDEX(CONCAT(audiences.`audience`, ':', scopes.`token_suffix`), ':', -1) AS `action`,
  JSON_OBJECT(
    'source', 'seed:v1.58',
    'semanticScope', scopes.`semantic_scope`,
    'purpose', 'altoc-tenant-runtime'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
CROSS JOIN (
  SELECT 'data-runtime' AS `audience`
  UNION ALL SELECT 'tenant-runtime'
) audiences
CROSS JOIN (
  SELECT 'altoc:read' AS `token_suffix`, 'altoc.read' AS `semantic_scope`
  UNION ALL SELECT 'altoc:write', 'altoc.write'
  UNION ALL SELECT 'altoc:dashboard:view', 'altoc:dashboard:view'
  UNION ALL SELECT 'altoc:dashboard:export', 'altoc:dashboard:export'
  UNION ALL SELECT 'altoc:customer:view', 'altoc:customer:view'
  UNION ALL SELECT 'altoc:customer:edit', 'altoc:customer:edit'
  UNION ALL SELECT 'altoc:customer:approve', 'altoc:customer:approve'
  UNION ALL SELECT 'altoc:lead:view', 'altoc:lead:view'
  UNION ALL SELECT 'altoc:lead:edit', 'altoc:lead:edit'
  UNION ALL SELECT 'altoc:lead:assign', 'altoc:lead:assign'
  UNION ALL SELECT 'altoc:lead:disqualify', 'altoc:lead:disqualify'
  UNION ALL SELECT 'altoc:lead:convert', 'altoc:lead:convert'
  UNION ALL SELECT 'altoc:lead:activity', 'altoc:lead:activity'
  UNION ALL SELECT 'altoc:opportunity:view', 'altoc:opportunity:view'
  UNION ALL SELECT 'altoc:opportunity:edit', 'altoc:opportunity:edit'
  UNION ALL SELECT 'altoc:opportunity:assign', 'altoc:opportunity:assign'
  UNION ALL SELECT 'altoc:opportunity:transition', 'altoc:opportunity:transition'
  UNION ALL SELECT 'altoc:opportunity:activity', 'altoc:opportunity:activity'
  UNION ALL SELECT 'altoc:quotation:view', 'altoc:quotation:view'
  UNION ALL SELECT 'altoc:quotation:edit', 'altoc:quotation:edit'
  UNION ALL SELECT 'altoc:quotation:approve', 'altoc:quotation:approve'
  UNION ALL SELECT 'altoc:contract:view', 'altoc:contract:view'
  UNION ALL SELECT 'altoc:contract:edit', 'altoc:contract:edit'
  UNION ALL SELECT 'altoc:contract:approve', 'altoc:contract:approve'
  UNION ALL SELECT 'altoc:contract:finance-summary:sync', 'altoc:contract:finance-summary:sync'
  UNION ALL SELECT 'altoc:contract:delivery-asset-status:sync', 'altoc:contract:delivery-asset-status:sync'
  UNION ALL SELECT 'altoc:receivable:view', 'altoc:receivable:view'
  UNION ALL SELECT 'altoc:receivable:edit', 'altoc:receivable:edit'
  UNION ALL SELECT 'altoc:receivable:confirm', 'altoc:receivable:confirm'
  UNION ALL SELECT 'altoc:receivable:mark-billable', 'altoc:receivable:mark-billable'
  UNION ALL SELECT 'altoc:maintenance_contract:view', 'altoc:maintenance_contract:view'
  UNION ALL SELECT 'altoc:maintenance_contract:edit', 'altoc:maintenance_contract:edit'
  UNION ALL SELECT 'altoc:service_entitlement:view', 'altoc:service_entitlement:view'
  UNION ALL SELECT 'altoc:service_entitlement:edit', 'altoc:service_entitlement:edit'
  UNION ALL SELECT 'altoc:service_ticket:view', 'altoc:service_ticket:view'
  UNION ALL SELECT 'altoc:service_ticket:edit', 'altoc:service_ticket:edit'
  UNION ALL SELECT 'altoc:service_ticket:close', 'altoc:service_ticket:close'
  UNION ALL SELECT 'altoc:service_ticket:delivery-result:sync', 'altoc:service_ticket:delivery-result:sync'
  UNION ALL SELECT 'altoc:renewal_opportunity:view', 'altoc:renewal_opportunity:view'
  UNION ALL SELECT 'altoc:renewal_opportunity:edit', 'altoc:renewal_opportunity:edit'
  UNION ALL SELECT 'altoc:settings:view', 'altoc:settings:view'
  UNION ALL SELECT 'altoc:settings:edit', 'altoc:settings:edit'
  UNION ALL SELECT 'altoc:admin:view', 'altoc:admin:view'
  UNION ALL SELECT 'altoc:admin:edit', 'altoc:admin:edit'
) scopes
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'altoc' OR sc.`client_code` IN ('altoc', 'altoc.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
